import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { expect, test } from '@playwright/test';
import yauzl from 'yauzl-promise';

import { activityByLegacyId, collectProblems, listActivities, waitForH5PContent } from '../support/helpers';

/** Reads a zip into { path -> Buffer } so assertions are structural, not visual. */
async function readZip(file: string): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  const zip = await yauzl.open(file);
  try {
    for await (const entry of zip) {
      if (entry.filename.endsWith('/')) continue;
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      entries.set(entry.filename, Buffer.concat(chunks));
    }
  } finally {
    await zip.close();
  }
  return entries;
}

test.describe('package round-trip', () => {
  test('export -> structural assertions -> reimport -> render', async ({
    page,
    request
  }, testInfo) => {
    const source = await activityByLegacyId(request, 141);

    // ── export ──────────────────────────────────────────────────────────────
    const download = await request.get(
      `/h5p/download/${source.h5p_content_id}`
    );
    expect(download.ok()).toBeTruthy();
    expect(download.headers()['content-disposition']).toContain('.h5p');

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfy-h5p-'));
    const exported = path.join(dir, 'exported.h5p');
    await fs.writeFile(exported, await download.body());
    const exportedSize = (await fs.stat(exported)).size;

    // ── structural assertions on the archive itself ────────────────────────
    const entries = await readZip(exported);
    const names = [...entries.keys()];

    expect(entries.has('h5p.json'), 'h5p.json missing from export').toBe(true);
    expect(entries.has('content/content.json'), 'content.json missing').toBe(true);

    const h5pJson = JSON.parse(entries.get('h5p.json')!.toString('utf-8'));
    expect(h5pJson.mainLibrary).toBe('H5P.MultiChoice');
    expect(h5pJson.title).toBe(source.title);
    expect(Array.isArray(h5pJson.preloadedDependencies)).toBe(true);
    expect(
      h5pJson.preloadedDependencies.some(
        (d: any) => d.machineName === 'H5P.MultiChoice'
      ),
      'main library must be listed in preloadedDependencies'
    ).toBe(true);

    // Libraries are written at the archive ROOT (H5P.Name-major.minor/...),
    // not under a libraries/ directory.
    const libraryDirs = new Set(
      names
        .filter((n) => !n.startsWith('content/') && n.includes('/'))
        .map((n) => n.split('/')[0])
    );
    expect(libraryDirs.size, 'no library directories in export').toBeGreaterThan(0);
    expect([...libraryDirs].some((d) => d.startsWith('H5P.MultiChoice-'))).toBe(true);

    // Scoring behaviour must survive: these are the fields PFY maps from.
    const contentJson = JSON.parse(
      entries.get('content/content.json')!.toString('utf-8')
    );
    expect(contentJson.answers).toHaveLength(4);
    expect(contentJson.answers.filter((a: any) => a.correct)).toHaveLength(2);
    expect(contentJson.behaviour.singlePoint).toBe(false);
    expect(contentJson.behaviour.passPercentage).toBe(100);

    // ── reimport into the runtime ──────────────────────────────────────────
    const reimport = await request.post('/api/import', {
      multipart: {
        h5p: {
          name: 'exported.h5p',
          mimeType: 'application/zip',
          buffer: await fs.readFile(exported)
        }
      }
    });
    expect(reimport.ok(), `reimport failed: ${await reimport.text()}`).toBeTruthy();
    const reimported = (await reimport.json()).data;

    expect(reimported.activity.uuid).not.toBe(source.uuid);
    expect(reimported.main_library).toBe('H5P.MultiChoice 1.16');

    // ── the reimported copy renders and scores ─────────────────────────────
    const { consoleErrors, failedRequests } = collectProblems(page);
    await page.goto(`/play/${reimported.activity.uuid}`);
    await waitForH5PContent(page);

    await expect(page.locator('.h5p-answer')).toHaveCount(4);
    for (const index of [0, 3]) {
      await page.locator('.h5p-answer').nth(index).click();
    }
    await page.locator('.h5p-question-check-answer').click();

    await expect
      .poll(async () => {
        const res = await request.get(
          `/api/activities/${reimported.activity.uuid}/attempts`
        );
        const rows = (await res.json()).data;
        return rows.at(-1)?.score_raw ?? null;
      })
      .toBe(2);

    expect(failedRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);

    // Both copies remain independently playable.
    const all = await listActivities(request);
    expect(all.find((a) => a.uuid === source.uuid)).toBeTruthy();

    await testInfo.attach('round-trip.json', {
      body: JSON.stringify(
        {
          sourceActivity: source.uuid,
          exportedBytes: exportedSize,
          zipEntries: names.length,
          libraryDirectories: [...libraryDirs].sort(),
          contentEntries: names.filter((n) => n.startsWith('content/')),
          reimportedActivity: reimported.activity.uuid,
          reimportedScore: '2/2'
        },
        null,
        2
      ),
      contentType: 'application/json'
    });

    console.log(
      `exported ${exportedSize} bytes, ${names.length} entries, ${libraryDirs.size} libraries -> reimported as ${reimported.activity.uuid}`
    );
  });

  test('export of a media-bearing activity preserves its media bytes', async ({
    request
  }) => {
    const hotspots = await activityByLegacyId(request, 207);

    const download = await request.get(`/h5p/download/${hotspots.h5p_content_id}`);
    expect(download.ok()).toBeTruthy();

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfy-h5p-media-'));
    const file = path.join(dir, 'media.h5p');
    await fs.writeFile(file, await download.body());

    const entries = await readZip(file);
    const contentFiles = [...entries.keys()].filter(
      (n) => n.startsWith('content/') && n !== 'content/content.json'
    );

    const audio = contentFiles.filter((n) => /\.(mp3|m4a|wav|ogg)$/i.test(n));
    const images = contentFiles.filter((n) => /\.(png|jpe?g|gif)$/i.test(n));

    // The fixture is the only corpus package carrying both image and audio.
    expect(audio.length, 'audio files missing from export').toBeGreaterThan(0);
    expect(images.length, 'image files missing from export').toBeGreaterThan(0);

    for (const name of [...audio, ...images]) {
      expect(entries.get(name)!.length, `${name} exported empty`).toBeGreaterThan(0);
    }

    console.log(
      `media export: ${images.length} images, ${audio.length} audio files, ${contentFiles.length} content files total`
    );
  });
});
