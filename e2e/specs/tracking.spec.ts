import { expect, test } from '@playwright/test';

import { activityByLegacyId, attemptsFor, collectProblems, waitForH5PContent } from '../support/helpers';

/**
 * Workstream 3 — the eight tracking behaviours the spike must prove.
 *
 * The fixture is the legacy PFY MultiChoice (WordPress id 141). It has two
 * correct answers out of four and `singlePoint: false`, so a fully correct
 * response scores 2/2, and `passPercentage: 100` means anything less fails.
 */
const MULTI_CHOICE_WP_ID = 141;
const CORRECT = [0, 3];
const INCORRECT = [1];

test.describe('tracking: xAPI -> PFY attempt/result', () => {
  test('1-5: attempt starts, completion/score/success/duration are captured', async ({
    page,
    request
  }) => {
    const activity = await activityByLegacyId(request, MULTI_CHOICE_WP_ID);
    const { consoleErrors } = collectProblems(page);

    const before = await attemptsFor(request, activity.uuid);

    await page.goto(`/play/${activity.uuid}`);
    await waitForH5PContent(page);

    // (1) navigating to the activity started exactly one new attempt
    const after = await attemptsFor(request, activity.uuid);
    expect(after.length).toBe(before.length + 1);
    const attempt = after[after.length - 1];
    expect(attempt.attempt_number).toBe(before.length + 1);
    expect(attempt.started_at).toBeTruthy();
    expect(attempt.is_completed).toBe(false);
    expect(attempt.completed_at).toBeNull();

    // Answer correctly and submit.
    for (const index of CORRECT) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();

    // (2) completion is detected
    await expect
      .poll(
        async () => {
          const rows = await attemptsFor(request, activity.uuid);
          return rows[rows.length - 1].is_completed;
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    const completed = (await attemptsFor(request, activity.uuid)).at(-1)!;

    // (3) score and max score captured
    expect(completed.score_raw).toBe(2);
    expect(completed.score_max).toBe(2);
    expect(completed.score_scaled).toBe(1);

    // (4) success / completion captured
    expect(completed.is_passed).toBe(true);
    expect(completed.verb).toBe('passed');
    expect(completed.completed_at).toBeTruthy();

    // (5) duration captured
    expect(completed.duration_seconds).not.toBeNull();
    expect(completed.duration_seconds).toBeGreaterThanOrEqual(0);

    // Provenance is explicit: this score came from the browser, not a server
    // recomputation, because PFY has no server-side scorer for H5P.
    expect(completed.score_provenance).toBe('client_reported');

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('8: reloading an attempt does not create a duplicate completion', async ({
    page,
    request
  }) => {
    const activity = await activityByLegacyId(request, MULTI_CHOICE_WP_ID);

    await page.goto(`/play/${activity.uuid}`);
    await waitForH5PContent(page);
    const attemptUrl = page.url();
    expect(attemptUrl).toContain('?t=');

    for (const index of CORRECT) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();

    await expect
      .poll(async () => (await attemptsFor(request, activity.uuid)).at(-1)!.is_completed, {
        timeout: 20_000
      })
      .toBe(true);

    const beforeReload = await attemptsFor(request, activity.uuid);
    const completedBefore = beforeReload.at(-1)!;

    // Reload the SAME attempt url twice.
    await page.reload();
    await waitForH5PContent(page);
    await page.reload();
    await waitForH5PContent(page);
    await page.waitForTimeout(2000);

    const afterReload = await attemptsFor(request, activity.uuid);
    expect(afterReload.length).toBe(beforeReload.length);

    const completedAfter = afterReload.at(-1)!;
    expect(completedAfter.uuid).toBe(completedBefore.uuid);
    expect(completedAfter.completed_at).toBe(completedBefore.completed_at);
    expect(completedAfter.score_raw).toBe(completedBefore.score_raw);
  });

  test('6-7: a second attempt is distinct and the first result is preserved', async ({
    page,
    request
  }) => {
    const activity = await activityByLegacyId(request, MULTI_CHOICE_WP_ID);

    // Attempt A — fully correct.
    await page.goto(`/play/${activity.uuid}`);
    await waitForH5PContent(page);
    for (const index of CORRECT) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();
    await expect
      .poll(async () => (await attemptsFor(request, activity.uuid)).at(-1)!.is_completed, {
        timeout: 20_000
      })
      .toBe(true);

    const afterFirst = await attemptsFor(request, activity.uuid);
    const first = afterFirst.at(-1)!;
    expect(first.score_raw).toBe(2);

    // Attempt B — deliberately wrong, started explicitly.
    await page.goto(`/play/${activity.uuid}?newAttempt=1`);
    await waitForH5PContent(page);

    const afterSecondStart = await attemptsFor(request, activity.uuid);
    expect(afterSecondStart.length).toBe(afterFirst.length + 1);
    const second = afterSecondStart.at(-1)!;
    expect(second.uuid).not.toBe(first.uuid);
    expect(second.attempt_number).toBe(first.attempt_number + 1);

    // A fresh attempt must not resume the previous attempt's answers: the
    // runtime gives each attempt its own contentUserData contextId.
    await expect(page.locator('.h5p-question-check-answer')).toBeVisible();

    for (const index of INCORRECT) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();

    await expect
      .poll(async () => (await attemptsFor(request, activity.uuid)).at(-1)!.is_completed, {
        timeout: 20_000
      })
      .toBe(true);

    const final = await attemptsFor(request, activity.uuid);
    const secondDone = final.find((a) => a.uuid === second.uuid)!;
    const firstAfter = final.find((a) => a.uuid === first.uuid)!;

    // (6) distinct attempt with its own result
    expect(secondDone.score_raw).toBeLessThan(2);
    expect(secondDone.is_passed).toBe(false);
    expect(secondDone.verb).toBe('failed');

    // (7) the first result is untouched
    expect(firstAfter.score_raw).toBe(2);
    expect(firstAfter.is_passed).toBe(true);
    expect(firstAfter.completed_at).toBe(first.completed_at);
  });

  test('result writes are idempotent: a replayed statement is ignored', async ({
    request
  }) => {
    const activity = await activityByLegacyId(request, MULTI_CHOICE_WP_ID);

    const started = await request.post(`/api/activities/${activity.uuid}/attempts`);
    expect(started.ok()).toBeTruthy();
    const { token, attempt } = (await started.json()).data;

    const statement = {
      verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
      object: {
        definition: {
          extensions: { 'http://h5p.org/x-api/h5p-local-content-id': '1' }
        }
      },
      result: {
        score: { raw: 2, max: 2, min: 0, scaled: 1 },
        success: true,
        completion: true,
        duration: 'PT12.5S'
      }
    };

    const first = await request.post('/api/xapi', { data: { token, statement } });
    expect((await first.json()).status).toBe('recorded');

    // H5P's own offline queue retries failed posts, and a restored page can
    // re-emit completion, so the same statement arriving twice must not
    // rewrite a finished attempt.
    const second = await request.post('/api/xapi', { data: { token, statement } });
    const secondBody = await second.json();
    expect(secondBody.status).toBe('duplicate_ignored');

    const rows = await attemptsFor(request, activity.uuid);
    const row = rows.find((a) => a.uuid === attempt.uuid)!;
    expect(row.score_raw).toBe(2);
    expect(row.duration_seconds).toBe(13); // PT12.5S, rounded
  });

  test('an unknown attempt token is rejected', async ({ request }) => {
    const res = await request.post('/api/xapi', {
      data: { token: 'not-a-real-token', statement: { verb: { id: 'x' } } }
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).status).toBe('rejected');
  });
});
