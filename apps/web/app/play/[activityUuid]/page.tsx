import Link from 'next/link';

import { fetchActivity } from '../../../lib/runtime';
import H5PPlayerEmbed from './H5PPlayerEmbed';

export const dynamic = 'force-dynamic';

export default async function PlayPage({
  params
}: {
  params: Promise<{ activityUuid: string }>;
}) {
  const { activityUuid } = await params;
  const activity = await fetchActivity(activityUuid);

  if (!activity) {
    return (
      <main>
        <p>Unknown activity.</p>
        <Link href="/">back</Link>
      </main>
    );
  }

  return (
    <main>
      <p>
        <Link href="/">← activities</Link>
      </p>
      <h1 data-testid="activity-title">{activity.title}</h1>
      <p style={{ color: '#6b7280' }}>
        PFY activity <code>{activity.uuid}</code> · pass{' '}
        {activity.behavior.pass_percentage}%
      </p>
      <H5PPlayerEmbed activityUuid={activity.uuid} />
    </main>
  );
}
