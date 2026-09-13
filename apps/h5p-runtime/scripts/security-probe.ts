/**
 * Security probe.
 *
 * Builds deliberately hostile .h5p packages, feeds them through the REAL import
 * path, and reports what the runtime does with each. Nothing is disabled or
 * weakened to make anything pass — the point is to record actual behaviour.
 *
 * Usage: npx tsx scripts/security-probe.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import yazl from 'yazl';

import { deleteActivity } from '../src/adapter/contentMap';
import { importPackage } from '../src/adapter/import';
import { db } from '../src/db';
import { createH5PRuntime } from '../src/h5p/createH5PEditor';
import { AUTHOR_USER } from '../src/h5p/user';

const MAIN = { machineName: 'H5P.MultiChoice', majorVersion: '1', minorVersion: '16' };

function baseMetadata(title: string) {
  return {
    title,
    language: 'pt',
    mainLibrary: MAIN.machineName,
    embedTypes: ['div'],
    license: 'U',
    preloadedDependencies: [MAIN]
  };
}

const baseContent = {
  question: '<p>probe</p>',
  answers: [
    { text: '<div>a</div>', correct: true },
    { text: '<div>b</div>', correct: false }
  ],
  behaviour: { enableRetry: true }
};

async function buildPackage(
  dir: string,
  name: string,
  files: Record<string, string>,
  content: Record<string, unknown> = baseContent
): Promise<string> {
  const target = path.join(dir, `${name}.h5p`);
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(baseMetadata(name))), 'h5p.json');
  zip.addBuffer(Buffer.from(JSON.stringify(content)), 'content/content.json');
  for (const [entry, data] of Object.entries(files)) {
    zip.addBuffer(Buffer.from(data), entry);
  }
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(target);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
  return target;
}

interface Probe {
  name: string;
  description: string;
  files: Record<string, string>;
  content?: Record<string, unknown>;
  /** What a safe implementation should do. */
  expectation: 'reject' | 'sanitize';
}

const PROBES: Probe[] = [
  {
    name: 'php-in-content',
    description: 'executable PHP inside content/',
    files: { 'content/evil.php': "<?php system($_GET['c']); ?>" },
    expectation: 'reject'
  },
  {
    name: 'svg-in-content',
    description: 'SVG with an inline script inside content/',
    files: {
      'content/evil.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'
    },
    expectation: 'reject'
  },
  {
    name: 'html-in-content',
    description: 'standalone HTML page inside content/',
    files: { 'content/evil.html': '<html><script>alert(1)</script></html>' },
    expectation: 'reject'
  },
  {
    name: 'php-in-library',
    description: 'a bundled library shipping a PHP backdoor',
    files: {
      'H5P.EvilLib-1.0/library.json': JSON.stringify({
        title: 'Evil',
        machineName: 'H5P.EvilLib',
        majorVersion: 1,
        minorVersion: 0,
        patchVersion: 1,
        runnable: 0,
        coreApi: { majorVersion: 1, minorVersion: 24 },
        preloadedJs: [{ path: 'evil.js' }]
      }),
      'H5P.EvilLib-1.0/evil.js': "alert('library js')",
      'H5P.EvilLib-1.0/backdoor.php': "<?php system($_GET['c']); ?>"
    },
    expectation: 'reject'
  },
  {
    name: 'xss-in-params',
    description: 'script tag and img/onerror inside the content PARAMS',
    files: {},
    content: {
      question: "<p>ok</p><script>alert('xss-question')</script><img src=x onerror=alert('xss-img')>",
      answers: [
        { text: "<div>a</div><script>alert('xss-answer')</script>", correct: true },
        { text: '<div>b</div>', correct: false }
      ],
      behaviour: { enableRetry: true }
    },
    expectation: 'sanitize'
  }
];

async function main(): Promise<void> {
  db();
  const runtime = await createH5PRuntime();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5p-secprobe-'));

  console.log('config in force:');
  console.log(`  contentWhitelist: ${runtime.config.contentWhitelist}`);
  console.log(`  libraryWhitelist: ${runtime.config.libraryWhitelist}`);
  console.log(`  maxFileSize: ${runtime.config.maxFileSize}  maxTotalSize: ${runtime.config.maxTotalSize}`);
  console.log('');

  const created: Array<{ activityUuid: string; contentId: string }> = [];

  for (const probe of PROBES) {
    const file = await buildPackage(dir, probe.name, probe.files, probe.content);
    let verdict: string;
    let detail = '';

    try {
      const result = await importPackage(runtime.editor, file, AUTHOR_USER);
      created.push({
        activityUuid: result.activity.uuid,
        contentId: result.h5pContentId
      });
      verdict = 'IMPORTED';
      detail = `activity ${result.activity.uuid} (h5p content ${result.h5pContentId})`;
    } catch (error: any) {
      verdict = 'REJECTED';
      detail = `${error?.errorId ?? ''} ${String(error?.message ?? error).slice(0, 120)}`;
    }

    const ok =
      (probe.expectation === 'reject' && verdict === 'REJECTED') ||
      (probe.expectation === 'sanitize' && verdict === 'IMPORTED');

    console.log(`${verdict.padEnd(9)} ${probe.name}`);
    console.log(`          ${probe.description}`);
    console.log(`          expected to ${probe.expectation}; ${ok ? 'behaved as expected at this layer' : 'DID NOT'}`);
    if (detail.trim()) console.log(`          ${detail.trim()}`);
    console.log('');
  }

  // Anything that imported here is deliberately hostile content. Leaving it in
  // the datastore would mean an XSS payload sitting in the spike environment
  // (and firing alert() dialogs in every later browser test), so it is removed.
  for (const item of created) {
    try {
      await runtime.editor.deleteContent(item.contentId, AUTHOR_USER);
    } catch {
      // best effort; the PFY row goes regardless
    }
    deleteActivity(item.activityUuid);
  }
  if (created.length) {
    console.log(`cleaned up ${created.length} imported probe activit${created.length === 1 ? 'y' : 'ies'}\n`);
  }

  console.log(
    'NOTE: "xss-in-params" is expected to import — the question is whether the\n' +
      'stored params were sanitized. Inspect the stored content.json; in 10.0.4\n' +
      'the import path does NOT sanitize, while an editor save does.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
