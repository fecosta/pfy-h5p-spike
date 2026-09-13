import path from 'path';

import type * as H5P from '@lumieducation/h5p-server';
import type { ActivityRef } from '@spike/learning-contract';

import type { SpikeUser } from '../h5p/user';
import { registerActivity } from './contentMap';
import { deriveBehavior, parseLegacyWordPressId } from './mapping';
import { sanitizeImportedContent, type SanitizationReport } from './sanitize';

/**
 * "H5P.Blanks 1.14" — whitespace-separated, which is what
 * saveOrUpdateContent expects for mainLibraryUbername. ContentMetadata is not
 * exported from the package index, so this derives the ubername from the
 * metadata's own dependency list rather than deep-importing internals.
 */
export function mainLibraryUbername(metadata: H5P.IContentMetadata): string {
  const dep = metadata.preloadedDependencies?.find(
    (d) => d.machineName === metadata.mainLibrary
  );
  if (!dep) {
    throw new Error(
      `package declares mainLibrary ${metadata.mainLibrary} but does not list it in preloadedDependencies`
    );
  }
  return `${dep.machineName} ${dep.majorVersion}.${dep.minorVersion}`;
}

export interface ImportOutcome {
  activity: ActivityRef;
  h5pContentId: string;
  installedLibraries: H5P.ILibraryInstallResult[];
  mainLibrary: string;
  /** What sanitization found and changed. See adapter/sanitize.ts. */
  sanitization: SanitizationReport;
}

/**
 * Imports a .h5p package server-side (no browser involved) and gives it a PFY
 * identity.
 *
 * Uses packageImporter directly because it is the only entry point that both
 * installs the bundled libraries and stores the content in one step.
 * H5PEditor.uploadPackage would stage the content into per-user temporary
 * storage instead, which is the right shape for a browser upload but not for a
 * migration.
 */
export async function importPackage(
  editor: H5P.H5PEditor,
  packagePath: string,
  user: SpikeUser
): Promise<ImportOutcome> {
  const { id, installedLibraries, metadata, parameters } =
    await editor.packageImporter.addPackageLibrariesAndContent(
      packagePath,
      user
    );

  // FileContentStorage.createContentId() returns a random 32-bit *number* even
  // though ContentId is typed as string. Coerce once, here, so no number ever
  // escapes the adapter.
  const h5pContentId = String(id);
  const filename = path.basename(packagePath);
  const ubername = mainLibraryUbername(metadata);

  // The importer stores params verbatim — it does not sanitize, unlike the
  // editor save path. Do it here, before the content is ever playable.
  const sanitization = await sanitizeImportedContent(editor, {
    contentId: h5pContentId,
    mainLibraryUbername: ubername,
    metadata,
    params: parameters,
    user
  });

  const activity = registerActivity({
    title: metadata.title || filename.replace(/\.h5p$/i, ''),
    mainLibrary: ubername,
    h5pContentId,
    behavior: deriveBehavior(parameters),
    sourcePackage: filename,
    legacyH5pContentId: parseLegacyWordPressId(filename),
    status: 'published'
  });

  return {
    activity,
    h5pContentId,
    installedLibraries,
    mainLibrary: ubername,
    sanitization
  };
}

/**
 * Installs only the libraries from a package, with no content and no user.
 *
 * This path consults no permission system at all, which is what makes it usable
 * for provisioning — and also worth flagging: a caller that can reach it can
 * install arbitrary library JS.
 */
export async function installLibrariesOnly(
  editor: H5P.H5PEditor,
  packagePath: string
): Promise<H5P.ILibraryInstallResult[]> {
  const { installedLibraries } = await editor.uploadPackage(
    packagePath,
    undefined,
    { onlyInstallLibraries: true }
  );
  return installedLibraries;
}

export function summarizeInstalls(results: H5P.ILibraryInstallResult[]): {
  new: number;
  patch: number;
  none: number;
  patched: string[];
} {
  const patched = results
    .filter((r) => r.type === 'patch')
    .map(
      (r) =>
        `${r.oldVersion?.machineName ?? '?'} ${r.oldVersion?.majorVersion}.${r.oldVersion?.minorVersion}.${r.oldVersion?.patchVersion}` +
        ` -> ${r.newVersion?.patchVersion}`
    );
  return {
    new: results.filter((r) => r.type === 'new').length,
    patch: patched.length,
    none: results.filter((r) => r.type === 'none').length,
    patched
  };
}
