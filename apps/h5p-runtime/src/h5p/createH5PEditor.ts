import fs from 'fs';

import * as H5P from '@lumieducation/h5p-server';
import SvgSanitizer from '@lumieducation/h5p-svg-sanitizer';

import { paths } from '../paths';
import { createTranslationFunction } from './i18n';
import { SpikePermissionSystem } from './user';

export interface ContentSavedHooks {
  created: (contentId: string, metadata: H5P.IContentMetadata, params: unknown) => Promise<void>;
  updated: (contentId: string, metadata: H5P.IContentMetadata, params: unknown) => Promise<void>;
  deleted: (contentId: string) => Promise<void>;
}

export interface H5PRuntime {
  /** Renders complete HTML pages using Lumi's own default renderer. */
  editor: H5P.H5PEditor;
  /**
   * Same storages, but its renderer is a pass-through so it yields the raw
   * IEditorModel that @lumieducation/h5p-webcomponents needs. Two instances
   * rather than one because the renderer is instance-level state, and swapping
   * it per request would race between the page route and the API route.
   */
  editorApi: H5P.H5PEditor;
  player: H5P.H5PPlayer;
  config: H5P.IH5PConfig;
}

export async function createH5PRuntime(
  hooks?: ContentSavedHooks
): Promise<H5PRuntime> {
  for (const dir of [
    paths.libraries,
    paths.content,
    paths.temp,
    paths.userData,
    paths.exports
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(paths.core) || !fs.existsSync(paths.editor)) {
    throw new Error(
      'H5P core/editor client files are missing. Run: pnpm setup:core'
    );
  }

  const config = await new H5P.H5PConfig(
    new H5P.fsImplementations.JsonStorage(paths.config)
  ).load();

  const translationCallback = await createTranslationFunction();
  const permissionSystem = new SpikePermissionSystem();
  // One lock provider instance shared by both editors: concurrent library
  // installs must serialise even when they arrive through different routes.
  const lockProvider = new H5P.SimpleLockProvider();

  const libraryStorage = new H5P.fsImplementations.FileLibraryStorage(paths.libraries);
  const contentStorage = new H5P.fsImplementations.FileContentStorage(paths.content);
  const temporaryStorage = new H5P.fsImplementations.DirectoryTemporaryFileStorage(paths.temp);
  const contentUserDataStorage =
    new H5P.fsImplementations.FileContentUserDataStorage(paths.userData);

  // IH5PEditorOptions is not part of the package's index exports, so the type
  // is taken from the constructor itself rather than re-declared by hand.
  type EditorOptions = NonNullable<ConstructorParameters<typeof H5P.H5PEditor>[7]>;
  type PlayerOptions = NonNullable<ConstructorParameters<typeof H5P.H5PPlayer>[6]>;

  const editorOptions: EditorOptions = {
    permissionSystem,
    lockProvider,
    enableHubLocalization: true,
    enableLibraryNameLocalization: true,
    // Kept ON deliberately: uploaded SVGs are an XSS vector. No security
    // mechanism is disabled anywhere in this spike to make a fixture work.
    fileSanitizers: [new SvgSanitizer()],
    hooks: hooks
      ? {
          contentWasCreated: async (contentId, metadata, parameters) =>
            hooks.created(String(contentId), metadata, parameters),
          contentWasUpdated: async (contentId, metadata, parameters) =>
            hooks.updated(String(contentId), metadata, parameters),
          contentWasDeleted: async (contentId) => hooks.deleted(String(contentId))
        }
      : undefined
  };

  const build = (): H5P.H5PEditor =>
    new H5P.H5PEditor(
      new H5P.fsImplementations.InMemoryStorage(),
      config,
      libraryStorage,
      contentStorage,
      temporaryStorage,
      translationCallback,
      undefined, // urlGenerator
      editorOptions,
      contentUserDataStorage
    );

  const editor = build();
  const editorApi = build();
  editorApi.setRenderer((model) => model);

  const player = new H5P.H5PPlayer(
    libraryStorage,
    contentStorage,
    config,
    undefined, // integrationObjectDefaults
    undefined, // urlGenerator
    translationCallback,
    { permissionSystem } as PlayerOptions,
    contentUserDataStorage
  );
  // We render the play page ourselves so the attempt token and the xAPI
  // listener can be injected; Lumi's integration object is used verbatim.
  player.setRenderer((model) => model);

  return { editor, editorApi, player, config };
}

/**
 * Temporary files are NOT removed when content is saved — upstream is explicit
 * that scheduling this is the host's job. Without it every abandoned media
 * upload stays on disk indefinitely.
 */
export function scheduleTemporaryFileCleanup(
  editor: H5P.H5PEditor,
  intervalMs = 5 * 60 * 1000
): NodeJS.Timeout {
  const timer = setInterval(() => {
    editor.temporaryFileManager
      .cleanUp()
      .catch((error) => console.error('[h5p] temp cleanup failed:', error));
  }, intervalMs);
  timer.unref();
  return timer;
}
