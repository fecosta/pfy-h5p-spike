/**
 * Imports one or more .h5p packages server-side and registers each as a PFY
 * activity.  Usage: pnpm import -- <file.h5p> [more.h5p ...]
 */
import fs from 'fs';
import path from 'path';

import { importPackage, installLibrariesOnly, summarizeInstalls } from '../src/adapter/import';
import { db } from '../src/db';
import { createH5PRuntime } from '../src/h5p/createH5PEditor';
import { AUTHOR_USER } from '../src/h5p/user';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const librariesOnly = args.includes('--libraries-only');
  const files = args.filter((a) => !a.startsWith('--'));

  if (files.length === 0) {
    console.error('usage: pnpm import -- <file.h5p> [...] [--libraries-only]');
    process.exit(1);
  }

  db();
  const runtime = await createH5PRuntime();

  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      console.error(`✗ missing: ${resolved}`);
      continue;
    }
    const started = Date.now();
    try {
      if (librariesOnly) {
        const installs = await installLibrariesOnly(runtime.editor, resolved);
        const s = summarizeInstalls(installs);
        console.log(
          `✓ libraries ${path.basename(resolved)} — new:${s.new} patched:${s.patch} skipped:${s.none} (${Date.now() - started}ms)`
        );
        if (s.patched.length) {
          for (const line of s.patched) console.log(`    patched ${line}`);
        }
        continue;
      }

      const result = await importPackage(runtime.editor, resolved, AUTHOR_USER);
      const s = summarizeInstalls(result.installedLibraries);
      console.log(`✓ ${path.basename(resolved)} (${Date.now() - started}ms)`);
      console.log(`    activity  ${result.activity.uuid}`);
      console.log(`    title     ${result.activity.title}`);
      console.log(`    library   ${result.mainLibrary}`);
      console.log(`    legacy WP id ${result.activity.legacy_h5p_content_id ?? '—'}`);
      console.log(`    libraries new:${s.new} patched:${s.patch} skipped:${s.none}`);
      const san = result.sanitization;
      console.log(
        `    sanitization: ${san.changed ? 'params changed' : 'no change'}` +
          (san.findingsBefore.length
            ? ` — removed ${san.findingsBefore.length} unsafe construct(s): ${[...new Set(san.findingsBefore.map((f) => f.rule))].join(', ')}`
            : ' — no unsafe markup found')
      );
      console.log(`    play      http://localhost:8080/play/${result.activity.uuid}`);
    } catch (error: any) {
      console.error(`✗ ${path.basename(resolved)}: ${error?.message ?? error}`);
      if (error?.errorId) console.error(`    errorId: ${error.errorId}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
