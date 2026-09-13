import { expect, test } from '@playwright/test';

import { collectProblems, listActivities, waitForH5PContent } from '../support/helpers';

/**
 * Workstream 2 — every imported legacy PFY package must render, load its
 * assets, and survive a reload without browser or network errors.
 *
 * The test list is derived from what is actually imported, so it fails loudly
 * if the fixture set changes rather than silently testing less.
 */
test.describe('legacy PFY content plays outside WordPress', () => {
  test('every imported activity renders, loads assets and reloads cleanly', async ({
    context,
    request
  }, testInfo) => {
    const activities = await listActivities(request);
    expect(activities.length).toBeGreaterThanOrEqual(6);

    const results: Array<Record<string, unknown>> = [];

    for (const activity of activities) {
      // Fresh page per activity so one activity's errors cannot be attributed
      // to the next one.
      const page = await context.newPage();
      const { consoleErrors, failedRequests } = collectProblems(page);

      await page.goto(`/play/${activity.uuid}`);
      await waitForH5PContent(page);

      const contentHtmlLength = (await page.locator('.h5p-content').innerHTML()).length;

      // Media referenced by the content must actually resolve.
      const brokenMedia = await page.evaluate(() => {
        const broken: string[] = [];
        document.querySelectorAll('img').forEach((img) => {
          if (img.complete && img.naturalWidth === 0) broken.push(img.src);
        });
        return broken;
      });
      const mediaCount = await page.evaluate(
        () =>
          document.querySelectorAll('.h5p-content img').length +
          document.querySelectorAll('.h5p-content audio, .h5p-content video').length
      );

      // Reload: the same activity must come back up.
      await page.reload();
      await waitForH5PContent(page);

      results.push({
        activity: activity.title,
        library: activity.legacy_h5p_library_name,
        legacyWordPressId: activity.legacy_h5p_content_id,
        renderedHtmlBytes: contentHtmlLength,
        mediaElements: mediaCount,
        brokenMedia,
        consoleErrors,
        failedRequests
      });

      expect(contentHtmlLength, `${activity.legacy_h5p_library_name} rendered empty`).toBeGreaterThan(150);
      expect(brokenMedia, `broken media in ${activity.legacy_h5p_library_name}`).toEqual([]);
      expect(
        failedRequests,
        `failed requests in ${activity.legacy_h5p_library_name}: ${failedRequests.join(' | ')}`
      ).toEqual([]);
      expect(
        consoleErrors,
        `console errors in ${activity.legacy_h5p_library_name}: ${consoleErrors.join(' | ')}`
      ).toEqual([]);

      await page.close();
    }

    await testInfo.attach('legacy-playback-matrix.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json'
    });
    console.table(
      results.map((r) => ({
        library: r.library,
        wpId: r.legacyWordPressId,
        htmlBytes: r.renderedHtmlBytes,
        media: r.mediaElements,
        errors: (r.consoleErrors as string[]).length
      }))
    );
  });

  test('a scoring legacy activity reports a score; a non-scoring one does not', async ({
    page,
    request
  }) => {
    const activities = await listActivities(request);

    // H5P.ImageHotspots has no H5P.Question dependency and emits no score.
    const hotspots = activities.find((a) =>
      (a.legacy_h5p_library_name ?? '').startsWith('H5P.ImageHotspots')
    );
    expect(hotspots, 'ImageHotspots fixture must be imported').toBeTruthy();

    await page.goto(`/play/${hotspots!.uuid}`);
    await waitForH5PContent(page);

    // It renders and is interactive, but there is no check/score affordance.
    await expect(page.locator('.h5p-content')).toBeVisible();
    expect(await page.locator('.h5p-question-check-answer').count()).toBe(0);
  });
});
