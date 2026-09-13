import { expect, test } from '@playwright/test';

import { activityByLegacyId, attemptsFor, collectProblems } from '../support/helpers';

/**
 * Cross-origin embedding: Next.js (:3000) hosting the H5P player served by the
 * runtime (:8080).
 *
 * This is the production-shaped risk the spike exists to retire — CORS, asset
 * origin, and loading Lumi's browser bundles from a React 19 app without
 * server-side rendering them.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';

test.describe('Next.js embed (cross-origin)', () => {
  test('the web app lists activities fetched from the runtime', async ({ page }) => {
    await page.goto(WEB_URL);
    await expect(page.getByTestId('activity-list')).toBeVisible();
    await expect(page.getByTestId('activity-list').locator('li')).not.toHaveCount(0);
  });

  test('the player loads, plays and tracks from another origin', async ({
    page,
    request
  }) => {
    const activity = await activityByLegacyId(request, 141);
    const { consoleErrors, failedRequests } = collectProblems(page);

    const before = await attemptsFor(request, activity.uuid);

    await page.goto(`${WEB_URL}/play/${activity.uuid}`);

    // The custom element initialises (proves defineElements + the model fetch
    // + all H5P assets loaded from the other origin).
    await expect(page.getByTestId('embed-status')).toHaveText('ready', {
      timeout: 60_000
    });
    await expect(page.getByTestId('embed-attempt')).toContainText('#');

    // Content renders inside the embed.
    const content = page.locator('.h5p-content');
    await expect(content).toBeVisible();
    await expect(page.locator('.h5p-answer')).toHaveCount(4);

    // Answer correctly and submit.
    for (const index of [0, 3]) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();

    // xAPI relayed from the component to the runtime, cross-origin.
    await expect(page.getByTestId('xapi-log')).toContainText('answered', {
      timeout: 20_000
    });

    await expect
      .poll(
        async () => {
          const rows = await attemptsFor(request, activity.uuid);
          return rows.length > before.length && rows.at(-1)!.is_completed;
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    const attempt = (await attemptsFor(request, activity.uuid)).at(-1)!;
    expect(attempt.score_raw).toBe(2);
    expect(attempt.score_max).toBe(2);
    expect(attempt.is_passed).toBe(true);

    // No CORS failures, no asset 404s: the rewritten absolute URLs hold up.
    const cors = consoleErrors.filter((e) => /CORS|cross-origin/i.test(e));
    expect(cors, `CORS errors: ${cors.join(' | ')}`).toEqual([]);
    expect(
      failedRequests.filter((r) => r.includes('/h5p/')),
      `H5P asset failures: ${failedRequests.join(' | ')}`
    ).toEqual([]);
  });
});
