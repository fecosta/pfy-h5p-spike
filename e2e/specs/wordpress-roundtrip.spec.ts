import fs from 'fs';
import path from 'path';

import { expect, test } from '@playwright/test';

/**
 * Workstream 5, external leg — does a package exported by the Lumi runtime
 * still work in the H5P implementation PFY runs today?
 *
 * The target is a disposable WordPress 7 + "Interactive Content – H5P" 1.17.9
 * container (infra/wordpress). The production PFY site and database are never
 * touched. The H5P plugin registers no wp-cli commands, so the upload is driven
 * through the admin UI, which is also what a human would do.
 *
 * Skipped automatically when the container is not running.
 */
const WP_URL = process.env.E2E_WP_URL ?? 'http://localhost:8090';
const EXPORTS = path.resolve(__dirname, '../../infra/wordpress/exports');

/**
 * The H5P plugin gates its admin screens behind a one-time data-consent prompt;
 * until it is answered the editor form is not rendered at all.
 */
async function dismissH5PConsent(page: import('@playwright/test').Page): Promise<void> {
  const decline = page
    .locator('button[name="consent"][value="0"], input[name="consent"][value="0"]')
    .first();
  if (await decline.count()) {
    await decline.click();
    await page.waitForLoadState('networkidle');
  }
}

async function loginToWordPress(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`${WP_URL}/wp-login.php`);
  await page.locator('#user_login').fill('admin');
  await page.locator('#user_pass').fill('admin');
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible({ timeout: 30_000 });
}

const PACKAGES = [
  {
    file: 'lumi-export-multichoice-141.h5p',
    // A text-bearing question: the Portuguese prompt must survive the trip.
    text: /De acordo com o texto/,
    requiresMedia: false
  },
  {
    file: 'lumi-export-imagehotspots-media-207.h5p',
    // ImageHotspots renders an image with hotspots and no prose, so the
    // meaningful assertion is that its media actually loaded.
    text: null,
    requiresMedia: true
  }
];

test.describe('exported package runs in WordPress H5P', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get(WP_URL, { failOnStatusCode: false }).catch(() => null);
    test.skip(
      !res || !res.ok(),
      `WordPress not reachable at ${WP_URL} — run: docker compose -f infra/wordpress/docker-compose.yml up -d`
    );
  });

  test('log in to the disposable WordPress', async ({ page }) => {
    await loginToWordPress(page);

    // Confirm we are testing against the real plugin, not a stub.
    await page.goto(`${WP_URL}/wp-admin/plugins.php`);
    await expect(page.locator('tr[data-slug="h5p"]')).toContainText('1.17.9');
  });

  for (const pkg of PACKAGES) {
    test(`upload and play ${pkg.file}`, async ({ page }) => {
      const file = path.join(EXPORTS, pkg.file);
      test.skip(!fs.existsSync(file), `missing export: ${file}`);

      await loginToWordPress(page);

      await page.goto(`${WP_URL}/wp-admin/admin.php?page=h5p_new`);
      await dismissH5PConsent(page);

      // The editor offers "Create" and "Upload"; switch to Upload.
      await page.locator('input[name="action"][value="upload"]').check();
      await page.locator('input[type="file"][name="h5p_file"]').setInputFiles(file);
      await page.locator('#h5p-content-form input[type="submit"]').first().click();

      // WordPress redirects to the content view on success.
      await page.waitForLoadState('networkidle');
      const body = await page.locator('body').innerText();
      expect(
        body,
        `WordPress rejected the package: ${body.slice(0, 400)}`
      ).not.toMatch(/not valid|invalid|fail/i);

      // The activity renders in WordPress's own H5P player.
      const h5pFrame = page.locator('iframe.h5p-iframe');
      const inlineContent = page.locator('.h5p-content');
      const rendered =
        (await h5pFrame.count()) > 0
          ? page.frameLocator('iframe.h5p-iframe').locator('.h5p-content')
          : inlineContent;
      await expect(rendered).toBeVisible({ timeout: 30_000 });

      if (pkg.text) {
        await expect(rendered).toContainText(pkg.text, { timeout: 30_000 });
      }

      if (pkg.requiresMedia) {
        // Media survived export -> upload -> WordPress storage and is served
        // successfully: naturalWidth is 0 for an image that failed to load.
        const frame =
          (await h5pFrame.count()) > 0 ? page.frames()[1] ?? page.mainFrame() : page.mainFrame();
        await expect
          .poll(
            async () =>
              frame.evaluate(() => {
                const images = Array.from(document.querySelectorAll('img'));
                return images.filter((i) => i.complete && i.naturalWidth > 0).length;
              }),
            { timeout: 30_000 }
          )
          .toBeGreaterThan(0);
      }

      console.log(`${pkg.file}: rendered in WordPress H5P 1.17.9`);
    });
  }

  test('libraries from the exported package were installed by WordPress', async ({
    page
  }) => {
    await loginToWordPress(page);
    await page.goto(`${WP_URL}/wp-admin/admin.php?page=h5p_libraries`);
    await dismissH5PConsent(page);
    await page.waitForLoadState('networkidle');

    // WordPress started with an empty library set and its Hub disabled, so
    // every row here came out of the uploaded Lumi exports.
    const rows = page.locator('table tr');
    await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThan(5);

    console.log(
      `WordPress lists ${await rows.count()} library rows, all installed from the uploaded packages (Hub disabled)`
    );
  });
});
