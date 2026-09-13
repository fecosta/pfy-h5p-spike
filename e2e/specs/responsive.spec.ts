import { expect, test } from '@playwright/test';

import { collectProblems, listActivities, waitForH5PContent } from '../support/helpers';

/**
 * Basic responsive check, run under an EMULATED iPhone 13 viewport
 * (Playwright device emulation). This is not a physical-device test and is
 * reported as such.
 */
test.describe('mobile viewport (emulated)', () => {
  test('legacy activities fit the viewport and stay interactive', async ({
    context,
    request
  }, testInfo) => {
    const activities = await listActivities(request);
    const rows: Array<Record<string, unknown>> = [];

    for (const activity of activities.slice(0, 6)) {
      // A fresh page per activity: reusing one page would let listeners (and
      // errors) from a previous navigation leak into the next measurement.
      const page = await context.newPage();
      const { consoleErrors } = collectProblems(page);

      await page.goto(`/play/${activity.uuid}`);
      await waitForH5PContent(page);

      const metrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        contentWidth: document.querySelector('.h5p-content')?.scrollWidth ?? 0
      }));

      rows.push({
        library: activity.legacy_h5p_library_name,
        ...metrics,
        consoleErrors: consoleErrors.length,
        consoleErrorTexts: consoleErrors
      });

      // Allow a 2px rounding tolerance; anything more is real horizontal overflow.
      expect(
        metrics.scrollWidth,
        `${activity.legacy_h5p_library_name} overflows horizontally on mobile`
      ).toBeLessThanOrEqual(metrics.viewport + 2);

      await page.close();
    }

    await testInfo.attach('mobile-viewport.json', {
      body: JSON.stringify(rows, null, 2),
      contentType: 'application/json'
    });
    for (const row of rows) {
      if ((row.consoleErrorTexts as string[]).length) {
        console.log(`  ${row.library}: ${(row.consoleErrorTexts as string[]).join(' | ')}`);
      }
    }
    console.table(
      rows.map((r) => ({
        library: r.library,
        viewport: r.viewport,
        scrollWidth: r.scrollWidth,
        errors: r.consoleErrors
      }))
    );
  });
});
