import path from 'path';

import i18next, { type TFunction } from 'i18next';
import Backend from 'i18next-fs-backend';

/**
 * h5p-server ships its own server-side translations and expects the host to
 * supply a translation function. Passing `undefined` is not a safe default:
 * with `enableHubLocalization: true` the built-in SimpleTranslator has no 'hub'
 * namespace loaded and throws
 *   TypeError: Cannot read properties of undefined (reading '...summary')
 * from ContentTypeInformationRepository.localizeHubInfo — a crash, not a
 * fallback. So i18next is wired up properly.
 *
 * Portuguese coverage as shipped in 10.0.4 (measured, not assumed):
 *   pt.json     — all 9 namespaces
 *   pt_BR.json  — only 'client' and 'storage-file-implementations'
 * Note the underscore. i18next resolves the language tag 'pt-BR' to the file
 * 'pt-BR.json', which does not exist, so those two pt_BR files are never
 * loaded and every namespace falls back to 'pt'.
 */
export const NAMESPACES = [
  'client',
  'copyright-semantics',
  'hub',
  'library-metadata',
  'metadata-semantics',
  'mongo-s3-content-storage',
  's3-temporary-storage',
  'server',
  'storage-file-implementations'
] as const;

export async function createTranslationFunction(): Promise<
  (key: string, language: string) => string
> {
  const serverPackage = path.dirname(
    require.resolve('@lumieducation/h5p-server/package.json')
  );

  const t: TFunction = await i18next.use(Backend).init({
    backend: {
      loadPath: path.join(
        serverPackage,
        'build/assets/translations/{{ns}}/{{lng}}.json'
      )
    },
    defaultNS: 'server',
    fallbackLng: 'en',
    ns: [...NAMESPACES],
    // Without a language detector every language in use must be preloaded.
    preload: ['en', 'pt', 'pt-BR']
  });

  return (key: string, language: string) => t(key, { lng: language }) as string;
}
