import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface ActivitySummary {
  uuid: string;
  title: string;
  status: 'draft' | 'published';
  legacy_h5p_library_name: string | null;
  legacy_h5p_content_id: number | null;
  h5p_content_id: string;
  behavior: { pass_percentage: number };
}

export async function listActivities(
  request: APIRequestContext
): Promise<ActivitySummary[]> {
  const res = await request.get('/api/activities');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

export async function activityByLibrary(
  request: APIRequestContext,
  machineName: string
): Promise<ActivitySummary> {
  const all = await listActivities(request);
  const matching = all.filter((a) =>
    (a.legacy_h5p_library_name ?? '').startsWith(machineName)
  );
  // Prefer an actually-imported WordPress activity over one authored during a
  // test run: they differ in ways tests care about (embedTypes, answer counts).
  const found =
    matching.find((a) => a.legacy_h5p_content_id !== null) ?? matching[0];
  if (!found) {
    throw new Error(
      `no imported activity for ${machineName}; have: ${all
        .map((a) => a.legacy_h5p_library_name)
        .join(', ')}`
    );
  }
  return found;
}

/**
 * Resolves the exact fixture by its original WordPress content id.
 *
 * Fixture-specific assertions (how many answers, which are correct) must pin
 * the precise package: once the full 185-package corpus is imported there are
 * 17 MultiChoice activities, and "the first MultiChoice" is no longer stable.
 */
export async function activityByLegacyId(
  request: APIRequestContext,
  legacyWordPressId: number
): Promise<ActivitySummary> {
  const all = await listActivities(request);
  const found = all.find((a) => a.legacy_h5p_content_id === legacyWordPressId);
  if (!found) {
    throw new Error(
      `no imported activity with WordPress id ${legacyWordPressId}; ` +
        'run: pnpm --filter @spike/h5p-runtime import -- ../../fixtures/sample-h5p/*.h5p'
    );
  }
  return found;
}

export async function attemptsFor(
  request: APIRequestContext,
  activityUuid: string
): Promise<any[]> {
  const res = await request.get(`/api/activities/${activityUuid}/attempts`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

/** Collects browser console errors and failed network responses. */
export function collectProblems(page: Page): {
  consoleErrors: string[];
  failedRequests: string[];
} {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  return { consoleErrors, failedRequests };
}

/** Waits for the H5P content root to be attached and non-empty. */
export async function waitForH5PContent(page: Page): Promise<void> {
  const content = page.locator('.h5p-content');
  await expect(content).toBeVisible();
  await expect
    .poll(async () => (await content.innerHTML()).length, { timeout: 30_000 })
    .toBeGreaterThan(200);
}
