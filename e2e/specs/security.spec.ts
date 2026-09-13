import fs from 'fs/promises';
import path from 'path';

import { expect, test } from '@playwright/test';
import yazl from 'yazl';

import { waitForH5PContent } from '../support/helpers';

/**
 * Regression test for the import-path sanitization gap.
 *
 * h5p-server 10.0.4 sanitizes content params when the EDITOR saves them, but
 * not when a package is imported. Left alone, importing a crafted .h5p stores
 * `<script>` and `onerror` handlers verbatim and they execute in the learner's
 * browser. The adapter closes that gap (src/adapter/sanitize.ts); this test
 * proves it stays closed, in a real browser rather than by reading the file.
 *
 * The hostile package is built in memory on purpose — no malicious fixture is
 * committed to the repository.
 */
async function buildHostilePackage(): Promise<Buffer> {
  const metadata = {
    title: 'xss regression probe',
    language: 'pt',
    mainLibrary: 'H5P.MultiChoice',
    embedTypes: ['div'],
    license: 'U',
    preloadedDependencies: [
      { machineName: 'H5P.MultiChoice', majorVersion: '1', minorVersion: '16' }
    ]
  };
  const content = {
    question:
      "<p>pergunta</p><script>window.__xss=(window.__xss||0)+1</script>" +
      "<img src=x onerror=\"window.__xss=(window.__xss||0)+1\">",
    answers: [
      {
        text: "<div>alternativa a</div><script>window.__xss=(window.__xss||0)+1</script>",
        correct: true
      },
      { text: '<div>alternativa b</div>', correct: false }
    ],
    behaviour: { enableRetry: true }
  };

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(metadata)), 'h5p.json');
  zip.addBuffer(Buffer.from(JSON.stringify(content)), 'content/content.json');

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

test.describe('import-path sanitization', () => {
  test('a crafted package cannot execute script in a learner browser', async ({
    page,
    request
  }) => {
    const buffer = await buildHostilePackage();

    const imported = await request.post('/api/import', {
      multipart: {
        h5p: { name: 'xss.h5p', mimeType: 'application/zip', buffer }
      }
    });
    expect(imported.ok(), `import failed: ${await imported.text()}`).toBeTruthy();
    const activity = (await imported.json()).data.activity;

    // Count any execution of the injected payloads, however it happens.
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });

    await page.goto(`/play/${activity.uuid}`);
    await waitForH5PContent(page);
    await page.waitForTimeout(1500);

    const executions = await page.evaluate(
      () => (window as unknown as { __xss?: number }).__xss ?? 0
    );
    const html = await page.locator('.h5p-content').innerHTML();

    expect(executions, 'injected script executed in the learner page').toBe(0);
    expect(dialogs, 'injected payload opened a dialog').toEqual([]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);

    // The activity must still be usable — sanitizing is not the same as breaking.
    expect(html).toContain('pergunta');
    await expect(page.locator('.h5p-answer')).toHaveCount(2);

    // Clean up: never leave probe content in the environment.
    await request.delete(`/api/activities/${activity.uuid}`);
  });

  test('legitimate Portuguese markup survives import unchanged', async ({
    request
  }) => {
    // Guards the other direction: sanitizing must not mangle real content.
    // Imports its own copy so it never depends on an activity another spec
    // may have edited.
    const file = path.resolve(
      __dirname,
      '../../fixtures/sample-h5p/verdadeiro-ou-falso-a-85.h5p'
    );
    const imported = await request.post('/api/import', {
      multipart: {
        h5p: {
          name: 'verdadeiro-ou-falso-a-85.h5p',
          mimeType: 'application/zip',
          buffer: await fs.readFile(file)
        }
      }
    });
    expect(imported.ok(), `import failed: ${await imported.text()}`).toBeTruthy();
    const { activity } = (await imported.json()).data;

    const list = await request.get('/api/activities');
    const row = (await list.json()).data.find((a: any) => a.uuid === activity.uuid);

    const res = await request.get(`/h5p/params/${row.h5p_content_id}`);
    expect(res.ok()).toBeTruthy();
    const question: string = (await res.json()).params.params.question;

    // Text, tags and the non-breaking space all survive; only the entity
    // encoding is normalised (&nbsp; -> U+00A0).
    expect(question).toContain('farofa');
    expect(question).toContain('portugueses colonizadores');
    expect(question).toMatch(/^<p>/);
    expect(question).toContain('\u00a0');
    expect(question).not.toContain('&nbsp;');

    await request.delete(`/api/activities/${activity.uuid}`);
  });
});
