/**
 * Installs content types from the H5P Hub.
 *
 * Exists to prove the dependency-resolution path for legacy packages that ship
 * no libraries of their own.
 *
 * Usage: npx tsx scripts/hub-install.ts H5P.DocumentationTool [...]
 *        npx tsx scripts/hub-install.ts --list
 */
import { summarizeInstalls } from '../src/adapter/import';
import { db } from '../src/db';
import { createH5PRuntime } from '../src/h5p/createH5PEditor';
import { AUTHOR_USER } from '../src/h5p/user';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  db();
  const runtime = await createH5PRuntime();

  console.log(`hub endpoint: ${runtime.config.hubContentTypesEndpoint}`);
  console.log(`site uuid:    ${runtime.config.uuid || '(empty)'}`);

  const cache = await runtime.editor.getContentTypeCache(AUTHOR_USER, 'pt-BR');
  const installable = cache.libraries.filter((l: any) => l.canInstall);
  const local = cache.libraries.filter((l: any) => l.installed);
  console.log(
    `content-type cache: ${cache.libraries.length} entries ` +
      `(${local.length} installed locally, ${installable.length} installable from hub), outdated=${cache.outdated}`
  );

  if (args.includes('--list') || args.length === 0) {
    for (const lib of cache.libraries.slice(0, 12)) {
      console.log(
        `  ${lib.installed ? '[installed]' : '[hub]      '} ${lib.machineName} ${lib.majorVersion}.${lib.minorVersion}.${lib.patchVersion ?? '?'}`
      );
    }
    if (args.length === 0) return;
  }

  for (const machineName of args.filter((a) => !a.startsWith('--'))) {
    try {
      const installs = await runtime.editor.installLibraryFromHub(
        machineName,
        AUTHOR_USER
      );
      const s = summarizeInstalls(installs);
      console.log(
        `✓ ${machineName}: new:${s.new} patched:${s.patch} skipped:${s.none}`
      );
      for (const install of installs.filter((i) => i.type === 'new')) {
        console.log(
          `    + ${install.newVersion?.machineName} ${install.newVersion?.majorVersion}.${install.newVersion?.minorVersion}.${install.newVersion?.patchVersion}`
        );
      }
    } catch (error: any) {
      console.error(`✗ ${machineName}: ${error?.errorId ?? ''} ${error?.message ?? error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
