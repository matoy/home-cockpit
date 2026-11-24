import { DashboardApp } from '@/components/DashboardApp';
import { getCurrentSessionUser } from '@/lib/auth';
import { getDashboardData } from '@/lib/data-service';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [initialData, sessionUser] = await Promise.all([
    getDashboardData('24h', 'all'),
    getCurrentSessionUser(),
  ]);
  return <DashboardApp initialData={initialData} sessionUser={sessionUser} />;
}
