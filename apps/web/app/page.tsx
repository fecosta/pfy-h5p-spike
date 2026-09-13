import Link from 'next/link';

import { fetchActivities, RUNTIME_URL } from '../lib/runtime';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let activities: Awaited<ReturnType<typeof fetchActivities>> = [];
  let error: string | null = null;
  try {
    activities = await fetchActivities();
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  return (
    <main>
      <h1>PFY web (Next.js) — H5P embedded cross-origin</h1>
      <p style={{ color: '#6b7280' }}>
        This app runs on :3000 and the H5P runtime on {RUNTIME_URL}. Nothing here
        imports Lumi on the server; the player is loaded in the browser only.
      </p>
      {error && (
        <p style={{ color: '#b91c1c' }}>
          Could not reach the runtime at {RUNTIME_URL}: {error}
        </p>
      )}
      <ul data-testid="activity-list">
        {activities.map((a) => (
          <li key={a.uuid} style={{ marginBottom: 6 }}>
            <Link href={`/play/${a.uuid}`}>{a.title}</Link>{' '}
            <code style={{ fontSize: 12, color: '#6b7280' }}>
              {a.legacy_h5p_library_name}
            </code>
          </li>
        ))}
      </ul>
    </main>
  );
}
