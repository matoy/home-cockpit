import { DashboardApp } from '@/components/DashboardApp';
import { getDashboardData } from '@/lib/data-service';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const initialData = await getDashboardData('24h', 'all');
  return <DashboardApp initialData={initialData} />;
}
