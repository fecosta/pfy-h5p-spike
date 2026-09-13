import path from 'path';

/** Everything Lumi writes lives under apps/h5p-runtime/h5p (all gitignored). */
const appRoot = path.resolve(__dirname, '..');
const h5pRoot = path.join(appRoot, 'h5p');

export const paths = {
  appRoot,
  h5pRoot,
  /** H5P core client files (h5p-php-library), served at config.coreUrl. */
  core: path.join(h5pRoot, 'core'),
  /** H5P editor client files (h5p-editor-php-library), served at config.editorLibraryUrl. */
  editor: path.join(h5pRoot, 'editor'),
  /** Installed libraries: <librariesDirectory>/<Machine.Name-major.minor>/ */
  libraries: path.join(h5pRoot, 'libraries'),
  /** Content: <contentPath>/<contentId>/{h5p.json,content.json,...assets} */
  content: path.join(h5pRoot, 'content'),
  /** Temporary uploads: <temp>/<userId>/<filename> + <filename>.metadata */
  temp: path.join(h5pRoot, 'temp'),
  /** User state + completion: <dir>/<contentId>-userdata.json / -finished.json */
  userData: path.join(h5pRoot, 'user-data'),
  config: path.join(appRoot, 'h5p-config.json'),
  db: path.join(h5pRoot, 'spike.db'),
  exports: path.join(h5pRoot, 'exports'),
  reports: path.join(appRoot, 'out')
} as const;

export const PORT = Number(process.env.PORT ?? 8080);
/** apps/web runs here; the runtime must be reachable cross-origin. */
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
