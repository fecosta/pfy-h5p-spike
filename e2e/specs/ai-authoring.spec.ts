import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { listActivities, waitForH5PContent } from '../support/helpers';

/**
 * Workstream 6 — AI-assisted authoring proof of concept.
 *
 * The success criterion is not autonomous publishing. It is that structured
 * (notionally AI-generated) content becomes editable H5P content which a human
 * author reviews before publication. So the test asserts three things:
 * the generated content opens in the REAL editor, a human edit to it sticks,
 * and it plays and scores like any other activity.
 *
 * Prerequisite: `pnpm --filter @spike/h5p-runtime create:from-draft`.
 */
const EDITOR_IFRAME = 'iframe.h5p-editor-iframe';

async function fillRichText(
  frame: FrameLocator,
  selector: string,
  value: string
): Promise<void> {
  const field = frame.locator(selector);
  await expect(field).toBeVisible();
  await field.evaluate((node) => {
    (node as HTMLElement).innerHTML = '';
  });
  await field.evaluate(
    (node, text) => {
      (node as HTMLElement).innerHTML = `<p>${text}</p>`;
    },
    value
  );
}

test.describe('AI draft -> editable H5P content', () => {
  test('generated activities exist as drafts awaiting human review', async ({
    request
  }) => {
    const activities = await listActivities(request);
    const generated = activities.filter((a) => a.title.startsWith('Por ou para?'));

    expect(
      generated.length,
      'run `pnpm --filter @spike/h5p-runtime create:from-draft` first'
    ).toBeGreaterThanOrEqual(2);

    for (const activity of generated) {
      // A generated activity is never auto-published.
      expect(activity.status).toBe('draft');
      expect(activity.legacy_h5p_library_name).toContain('H5P.MultiChoice');
      // It is PFY-native content, not a migrated WordPress activity.
      expect(activity.legacy_h5p_content_id).toBeNull();
    }
  });

  test('a generated activity opens in the stock editor and can be revised', async ({
    page,
    request
  }) => {
    const activities = await listActivities(request);
    const generated = activities.find((a) => a.title === 'Por ou para? (1/2)')!;
    expect(generated).toBeTruthy();

    await page.goto(`/author/${generated.uuid}`);
    const frame = page.frameLocator(EDITOR_IFRAME);

    // The generated params load into the real MultiChoice form — i.e. the
    // transformer produced content H5P itself understands, field by field.
    await expect(frame.locator('.field-name-question .ckeditor')).toBeVisible({
      timeout: 60_000
    });
    await expect(frame.locator('.field-name-question .ckeditor')).toContainText(
      'Eu vou ___ São Paulo amanhã.'
    );

    const answers = frame.locator('.h5p-li');
    await expect(answers).toHaveCount(2);
    await expect(answers.nth(0).locator('.field-name-text .ckeditor')).toContainText(
      'para'
    );

    // The human reviewer edits the generated prompt and saves.
    const revised = `Eu vou ___ São Paulo amanhã. (revisado ${Date.now()})`;
    await fillRichText(frame, '.field-name-question .ckeditor', revised);

    await Promise.all([
      page.waitForURL(/\/play\//, { timeout: 60_000 }),
      page.locator('#save-h5p').click()
    ]);
    await waitForH5PContent(page);
    await expect(page.locator('.h5p-content')).toContainText('revisado');
  });

  test('a generated activity plays and scores through the same tracking path', async ({
    page,
    request
  }) => {
    const activities = await listActivities(request);
    const generated = activities.find((a) => a.title === 'Por ou para? (2/2)')!;
    expect(generated).toBeTruthy();

    await page.goto(`/play/${generated.uuid}`);
    await waitForH5PContent(page);

    // "por" is the correct answer in the draft for this question.
    await expect(page.locator('.h5p-answer')).toHaveCount(2);
    const correct = page.locator('.h5p-answer').filter({ hasText: 'por' }).first();
    await correct.click();
    await page.locator('.h5p-question-check-answer').click();

    await expect
      .poll(
        async () => {
          const res = await request.get(
            `/api/activities/${generated.uuid}/attempts`
          );
          const rows = (await res.json()).data;
          return rows.at(-1)?.is_completed ?? false;
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    const res = await request.get(`/api/activities/${generated.uuid}/attempts`);
    const attempt = (await res.json()).data.at(-1);

    expect(attempt.score_raw).toBe(1);
    expect(attempt.score_max).toBe(1);
    expect(attempt.is_passed).toBe(true);
    expect(attempt.verb).toBe('passed');
    expect(attempt.score_provenance).toBe('client_reported');
  });

  test('the Portuguese UI strings from the transformer reach the learner', async ({
    page,
    request
  }) => {
    const activities = await listActivities(request);
    const generated = activities.find((a) => a.title.startsWith('Por ou para?'))!;

    await page.goto(`/play/${generated.uuid}`);
    await waitForH5PContent(page);

    // UI labels live inside the content, not the platform: this is why an
    // imported activity keeps its own language. The button's text node carries
    // the visible label and its aria-label carries the a11y description, both
    // of which come from the transformer.
    const checkButton = page.locator('.h5p-question-check-answer');
    await expect(checkButton).toContainText('Verificar');
    await expect(checkButton).toHaveAttribute(
      'aria-label',
      'Verificar as respostas. As respostas serão marcadas como corretas, incorretas ou não respondidas.'
    );
  });
});
