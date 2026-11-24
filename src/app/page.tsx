import { DashboardApp } from '@/components/DashboardApp';
import { getCurrentSessionUser } from '@/lib/auth';
import { getDashboardData } from '@/lib/data-service';
import { VENDOR_IDS } from '@/lib/vendors/registry';
import type { SystemFilter, TabId, TimeRange } from '@/types';

export const dynamic = 'force-dynamic';

const VALID_TABS = new Set<TabId>([
  'overview',
  'health',
  'energy',
  'climate',
  'contacts',
  'covers',
  'hvac',
  'security',
  'automations',
  'devices',
  'rooms',
  'systems',
  'tariffs',
  'guide',
]);
const VALID_RANGES = new Set<TimeRange>(['24h', '7d', '30d', '365d', 'custom']);
const VALID_SYSTEMS = new Set<SystemFilter>(['all', ...VENDOR_IDS]);

function firstParam(val: string | string[] | undefined): string | undefined {
  return Array.isArray(val) ? val[0] : val;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawTab = firstParam(params.tab) as TabId | undefined;
  const initialTab: TabId = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'overview';

  const rawRange = (firstParam(params.range) ?? '24h') as TimeRange;
  const fromParam = firstParam(params.from);
  const toParam = firstParam(params.to);
  const hasValidCustom =
    rawRange === 'custom' &&
    Boolean(fromParam) &&
    Boolean(toParam) &&
    !Number.isNaN(new Date(fromParam!).getTime()) &&
    !Number.isNaN(new Date(toParam!).getTime());

  const range: TimeRange =
    rawRange === 'custom'
      ? hasValidCustom
        ? 'custom'
        : '24h'
      : VALID_RANGES.has(rawRange)
        ? rawRange
        : '24h';

  const roomId = firstParam(params.roomId) ?? 'all';
  const rawSystem = (firstParam(params.system) ?? 'all') as SystemFilter;
  const system: SystemFilter = VALID_SYSTEMS.has(rawSystem) ? rawSystem : 'all';

  const [initialData, sessionUser] = await Promise.all([
    getDashboardData(
      range,
      roomId,
      hasValidCustom ? fromParam : null,
      hasValidCustom ? toParam : null,
      system
    ),
    getCurrentSessionUser(),
  ]);

  return (
    <DashboardApp
      initialData={initialData}
      initialTab={initialTab}
      sessionUser={sessionUser}
    />
  );
}
