import fs from 'fs/promises';
import path from 'path';

import { expect, test, type APIRequestContext, type FrameLocator, type Page } from '@playwright/test';

import { collectProblems, listActivities, waitForH5PContent } from '../support/helpers';

const FIXTURES = path.resolve(__dirname, '../../fixtures/sample-h5p');

/** Imports a fixture so each run works on its own copy of the legacy package. */
async function importFixture(
  request: APIRequestContext,
  filename: string
): Promise<{ uuid: string; legacy_h5p_content_id: number | null }> {
  const buffer = await fs.readFile(path.join(FIXTURES, filename));
  const res = await request.post('/api/import', {
    multipart: {
      h5p: { name: filename, mimeType: 'application/zip', buffer }
    }
  });
  expect(res.ok(), `import of ${filename} failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()).data.activity;
}

/**
 * Workstream 4 — authoring through the real H5P editor.
 *
 * Editor mechanics that these tests encode (all verified against the running
 * editor, not assumed):
 *  - the editor lives in `iframe.h5p-editor-iframe`; the save button
 *    (`#save-h5p`) is in the OUTER document, not the iframe;
 *  - clicking a content-type tile (`#h5p-multichoice`) loads its form —
 *    the "Usar" button next to it is `aria-hidden` and never visible;
 *  - fields are addressed by their semantics name (`.field-name-<name>`),
 *    rich text is a contenteditable `.ckeditor`;
 *  - `.field-name-extraTitle input` is the main title, and H5P refuses to save
 *    without it.
 */

const EDITOR_IFRAME = 'iframe.h5p-editor-iframe';

async function openEditorFrame(page: Page): Promise<FrameLocator> {
  const frame = page.frameLocator(EDITOR_IFRAME);
  await expect(page.locator(EDITOR_IFRAME)).toBeVisible();
  return frame;
}

/**
 * Replaces the contents of a rich-text field.
 *
 * H5P's Html widget reads its value as
 *   ckeditor.getData() when a CKEditor instance is attached, else $input.html()
 * (h5p-editor-php-library/scripts/h5peditor-html.js:591), and CKEditor only
 * attaches once the field is focused. Writing innerHTML on an unfocused field
 * is therefore the value H5P will save.
 *
 * Two things that do NOT work and would silently weaken these tests:
 *  - Playwright's .fill() does not clear the field, so an "edit" prepends and
 *    the original text survives;
 *  - clicking the field first activates CKEditor, which then swallows
 *    synthetic keystrokes.
 */
async function fillRichText(
  _page: Page,
  frame: FrameLocator,
  selector: string,
  value: string
): Promise<void> {
  const field = frame.locator(selector);
  await expect(field).toBeVisible();
  await field.evaluate(
    (node, text) => {
      (node as HTMLElement).innerHTML = `<p>${text}</p>`;
    },
    value
  );
  await expect(field).toHaveText(value, { timeout: 15_000 });
}

async function saveAndWaitForPlay(page: Page): Promise<string> {
  await expect(page.locator('#save-h5p')).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/play\//, { timeout: 60_000 }),
    page.locator('#save-h5p').click()
  ]);
  return page.url();
}

test.describe('authoring in the stock H5P editor', () => {
  test('create: choose a content type, author it, save, play', async ({ page, request }) => {
    const { consoleErrors } = collectProblems(page);
    const before = await listActivities(request);

    await page.goto('/h5p/new');
    const frame = await openEditorFrame(page);

    // Content-type picker (Hub tiles, localised to pt-BR).
    await expect(frame.locator('.h5p-hub-media')).not.toHaveCount(0);
    await frame.locator('#h5p-multichoice').click();

    // The content-type form replaces the picker.
    await expect(frame.locator('.field-name-question .ckeditor')).toBeVisible({
      timeout: 60_000
    });

    const title = `Spike MC ${Date.now()}`;
    const question = 'Qual é a capital do Brasil?';

    await frame.locator('.field-name-extraTitle input').fill(title);
    await fillRichText(page, frame, '.field-name-question .ckeditor', question);

    // Two answer rows exist by default; fill both and mark the first correct.
    const answers = frame.locator('.h5p-li');
    await expect(answers).toHaveCount(2);
    await fillRichText(page, frame, '.h5p-li >> nth=0 >> .field-name-text .ckeditor', 'Brasília');
    await fillRichText(page, frame, '.h5p-li >> nth=1 >> .field-name-text .ckeditor', 'Rio de Janeiro');
    await answers.nth(0).locator('input[type="checkbox"]').first().check();

    const playUrl = await saveAndWaitForPlay(page);
    await waitForH5PContent(page);

    // The authored content plays.
    await expect(page.locator('.h5p-content')).toContainText('capital do Brasil');
    await expect(page.locator('.h5p-answer')).toHaveCount(2);

    // ...and the adapter registered it as a PFY activity via Lumi's save hook,
    // without the caller ever handling a Lumi content id.
    const after = await listActivities(request);
    expect(after.length).toBe(before.length + 1);
    const created = after.find((a) => !before.some((b) => b.uuid === a.uuid))!;
    expect(created.title).toBe(title);
    expect(created.legacy_h5p_library_name).toContain('H5P.MultiChoice');
    expect(playUrl).toContain(created.uuid);

    expect(consoleErrors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  test('edit + reopen: changes persist and the updated version plays', async ({
    page,
    request
  }) => {
    // A freshly authored activity, so the legacy fixtures stay pristine.
    const activities = await listActivities(request);
    const target = activities.find((a) => a.title.startsWith('Spike MC'));
    expect(target, 'create test must run first').toBeTruthy();

    const edited = `Qual é a capital de Portugal? (${Date.now()})`;

    await page.goto(`/author/${target!.uuid}`);
    const frame = await openEditorFrame(page);
    await expect(frame.locator('.field-name-question .ckeditor')).toBeVisible({
      timeout: 60_000
    });

    await fillRichText(page, frame, '.field-name-question .ckeditor', edited);
    await saveAndWaitForPlay(page);
    await waitForH5PContent(page);

    // Updated version plays.
    await expect(page.locator('.h5p-content')).toContainText('capital de Portugal');

    // Reopen the editor: the change was persisted, not just rendered once.
    await page.goto(`/author/${target!.uuid}`);
    const reopened = await openEditorFrame(page);
    await expect(reopened.locator('.field-name-question .ckeditor')).toBeVisible({
      timeout: 60_000
    });
    await expect(reopened.locator('.field-name-question .ckeditor')).toContainText(
      'capital de Portugal'
    );
  });

  test('legacy edit: open an imported WordPress package, change it, save, play', async ({
    page,
    request
  }) => {
    // Import a fresh copy so this test is repeatable and never mutates an
    // activity another test depends on.
    const legacy = await importFixture(request, 'verdadeiro-ou-falso-a-85.h5p');
    const marker = `PFY spike edit ${Date.now()}`;

    await page.goto(`/author/${legacy.uuid}`);
    const frame = await openEditorFrame(page);

    // The legacy package opens straight into its own content-type form — no
    // library had to be fetched, because the .h5p carried its editor libraries.
    await expect(frame.locator('.field-name-question .ckeditor')).toBeVisible({
      timeout: 60_000
    });
    const original = await frame.locator('.field-name-question .ckeditor').innerText();
    expect(original.trim().length).toBeGreaterThan(0);

    await fillRichText(page, frame, '.field-name-question .ckeditor', marker);
    await saveAndWaitForPlay(page);
    await waitForH5PContent(page);

    await expect(page.locator('.h5p-content')).toContainText(marker);
    // A true replacement: the original question text is gone, not prepended to.
    await expect(page.locator('.h5p-content')).not.toContainText(original.trim().slice(0, 20));

    // The PFY activity kept its identity and its WordPress provenance.
    const after = await listActivities(request);
    const same = after.find((a) => a.uuid === legacy.uuid)!;
    expect(same).toBeTruthy();
    expect(same.legacy_h5p_content_id).toBe(legacy.legacy_h5p_content_id);
  });
});
