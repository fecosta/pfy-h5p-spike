/**
 * The Next.js app talks to the H5P runtime only over HTTP, and only in PFY
 * terms (activity uuids, attempts). It never imports @lumieducation/* on the
 * server and never handles an H5P content id.
 */
export const RUNTIME_URL =
  process.env.NEXT_PUBLIC_H5P_RUNTIME_URL ?? 'http://localhost:8080';

export interface Activity {
  uuid: string;
  title: string;
  activity_type: string;
  status: string;
  legacy_h5p_library_name: string | null;
  legacy_h5p_content_id: number | null;
  behavior: { pass_percentage: number };
}

export async function fetchActivities(): Promise<Activity[]> {
  const res = await fetch(`${RUNTIME_URL}/api/activities`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`runtime returned ${res.status}`);
  return (await res.json()).data;
}

export async function fetchActivity(uuid: string): Promise<Activity | null> {
  const res = await fetch(`${RUNTIME_URL}/api/activities/${uuid}`, {
    cache: 'no-store'
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`runtime returned ${res.status}`);
  return (await res.json()).data;
}

export async function startAttempt(
  activityUuid: string
): Promise<{ token: string; attempt: { uuid: string; attempt_number: number } }> {
  const res = await fetch(`${RUNTIME_URL}/api/activities/${activityUuid}/attempts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`could not start attempt: ${res.status}`);
  return (await res.json()).data;
}
