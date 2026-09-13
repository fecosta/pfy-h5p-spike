/**
 * Bulk import probe.
 *
 * Runs every .h5p package in a directory through the real import path and
 * records the outcome per package, so the spike can report a measured
 * compatibility rate over PFY's whole legacy corpus rather than a sample.
 *
 * Usage: pnpm probe:bulk-import -- <dir-with-h5p-files> [--limit N]
 */
import fs from 'fs';
import path from 'path';

import { importPackage } from '../src/adapter/import';
import { summarizeInstalls } from '../src/adapter/import';
import { db, nowIso } from '../src/db';
import { createH5PRuntime } from '../src/h5p/createH5PEditor';
import { AUTHOR_USER } from '../src/h5p/user';
import { paths } from '../src/paths';

interface Row {
  package: string;
  mainLibrary: string | null;
  ok: boolean;
  contentId: string | null;
  libNew: number;
  libPatch: number;
  libNone: number;
  ms: number;
  errorKind: string | null;
  errorMessage: string | null;
  patched: string[];
}

function classify(error: any): string {
  const id = error?.errorId ?? '';
  if (id) return String(id);
  const msg = String(error?.message ?? error);
  if (/install-missing-libraries/i.test(msg)) return 'install-missing-libraries';
  if (/unable-to-unzip/i.test(msg)) return 'unable-to-unzip';
  if (/not-in-whitelist/i.test(msg)) return 'not-in-whitelist';
  if (/invalid-h5p-json/i.test(msg)) return 'invalid-h5p-json';
  return 'unknown';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  if (!dir || !fs.existsSync(dir)) {
    console.error('usage: pnpm probe:bulk-import -- <dir> [--limit N]');
    process.exit(1);
  }

  db();
  const runtime = await createH5PRuntime();

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.h5p'))
    .sort()
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  console.log(`probing ${files.length} packages from ${dir}\n`);

  const rows: Row[] = [];
  const insert = db().prepare(
    `INSERT OR REPLACE INTO import_probe
       (package, main_library, ok, h5p_content_id, libraries_new, libraries_patch,
        libraries_none, duration_ms, error_kind, error_message, ran_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const [index, file] of files.entries()) {
    const full = path.join(dir, file);
    const started = Date.now();
    let row: Row;
    try {
      const result = await importPackage(runtime.editor, full, AUTHOR_USER);
      const s = summarizeInstalls(result.installedLibraries);
      row = {
        package: file,
        mainLibrary: result.mainLibrary,
        ok: true,
        contentId: result.h5pContentId,
        libNew: s.new,
        libPatch: s.patch,
        libNone: s.none,
        ms: Date.now() - started,
        errorKind: null,
        errorMessage: null,
        patched: s.patched
      };
      process.stdout.write(
        `[${index + 1}/${files.length}] ok   ${file} (${row.ms}ms, +${s.new} libs${s.patch ? `, ${s.patch} patched` : ''})\n`
      );
      if (s.patched.length) {
        for (const line of s.patched) console.log(`            patched ${line}`);
      }
    } catch (error: any) {
      row = {
        package: file,
        mainLibrary: null,
        ok: false,
        contentId: null,
        libNew: 0,
        libPatch: 0,
        libNone: 0,
        ms: Date.now() - started,
        errorKind: classify(error),
        errorMessage: String(error?.message ?? error).slice(0, 500),
        patched: []
      };
      process.stdout.write(
        `[${index + 1}/${files.length}] FAIL ${file} — ${row.errorKind}: ${row.errorMessage}\n`
      );
    }

    insert.run(
      row.package,
      row.mainLibrary,
      row.ok ? 1 : 0,
      row.contentId,
      row.libNew,
      row.libPatch,
      row.libNone,
      row.ms,
      row.errorKind,
      row.errorMessage,
      nowIso()
    );
    rows.push(row);
  }

  const ok = rows.filter((r) => r.ok);
  const failed = rows.filter((r) => !r.ok);
  const patchedTotal = rows.reduce((sum, r) => sum + r.libPatch, 0);

  const byLibrary = new Map<string, { ok: number; fail: number }>();
  for (const row of rows) {
    const key = row.mainLibrary?.split(' ')[0] ?? '(unknown)';
    const entry = byLibrary.get(key) ?? { ok: 0, fail: 0 };
    if (row.ok) entry.ok += 1;
    else entry.fail += 1;
    byLibrary.set(key, entry);
  }

  fs.mkdirSync(paths.reports, { recursive: true });
  const reportPath = path.join(paths.reports, 'bulk-import-probe.md');
  const lines: string[] = [
    '# Bulk import probe',
    '',
    `- source directory: \`${dir}\``,
    `- packages attempted: **${rows.length}**`,
    `- imported: **${ok.length}**`,
    `- failed: **${failed.length}**`,
    `- library patch-upgrades triggered during the run: **${patchedTotal}**`,
    `- total wall time: ${(rows.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)}s`,
    '',
    '## By main library',
    '',
    '| main library | imported | failed |',
    '| --- | --- | --- |',
    ...[...byLibrary.entries()]
      .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
      .map(([lib, v]) => `| \`${lib}\` | ${v.ok} | ${v.fail} |`),
    ''
  ];

  if (failed.length) {
    lines.push('## Failures (recorded individually, not worked around)', '');
    lines.push('| package | error id | message |', '| --- | --- | --- |');
    for (const row of failed) {
      lines.push(
        `| \`${row.package}\` | \`${row.errorKind}\` | ${row.errorMessage?.replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }

  const patchedRows = rows.filter((r) => r.patched.length);
  if (patchedRows.length) {
    lines.push(
      '## Library patch-upgrades during import',
      '',
      'Lumi upgrades a library in place when a package carries a higher patch',
      'version, and never downgrades. Packages imported earlier therefore end up',
      'running against library code they were not authored against.',
      '',
      '| package | upgrade |',
      '| --- | --- |'
    );
    for (const row of patchedRows) {
      for (const line of row.patched) {
        lines.push(`| \`${row.package}\` | ${line} |`);
      }
    }
    lines.push('');
  }

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');

  console.log(`\nimported ${ok.length}/${rows.length}, failed ${failed.length}`);
  console.log(`library patch-upgrades: ${patchedTotal}`);
  console.log(`report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
