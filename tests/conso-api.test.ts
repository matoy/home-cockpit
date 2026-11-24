import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  shouldRunScheduledConsoApiSync,
} from '@/lib/services/vendors/conso-api-sync';
import {
  isValidPrm,
  maskPrm,
  parseConsoApiResponse,
  parseSubscribedKva,
} from '@/lib/vendors/conso-api-client';

describe('conso-api client helpers & parsers', () => {
  it('validates 14-digit PRM, masks PRM, and parses subscribed kVA cleanly', () => {
    expect(isValidPrm('12345678901234')).toBe(true);
    expect(isValidPrm(' 12345678901234 ')).toBe(true);
    expect(isValidPrm('1234567890123')).toBe(false);
    expect(isValidPrm('1234567890123a')).toBe(false);
    expect(isValidPrm('')).toBe(false);

    expect(maskPrm('12345678901234')).toBe('••••••••••1234');
    expect(maskPrm('')).toBeNull();

    expect(parseSubscribedKva('9')).toBe(9);
    expect(parseSubscribedKva(12)).toBe(12);
    expect(parseSubscribedKva('2')).toBeNull();
    expect(parseSubscribedKva('45')).toBeNull();
    expect(parseSubscribedKva('')).toBeNull();
  });

  it('parses Enedis V2 JSON payloads for daily_kwh, load_curve_30m, and max_power_daily', () => {
    const dailyV2 = {
      idPrm: '12345678901234',
      pas: 'P1D',
      grandeur: [
        {
          unite: 'Wh',
          points: [
            { d: '2026-11-22', v: '6250' },
            { d: '2026-11-23', v: 4800 },
          ],
        },
      ],
    };
    const daily = parseConsoApiResponse(dailyV2, 'daily_kwh');
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({
      pointId: '12345678901234',
      granularity: 'daily_kwh',
      dateKey: '2026-11-22',
      energyKwh: 6.25,
      powerW: null,
    });
    expect(daily[1].energyKwh).toBe(4.8);

    const curveV2 = {
      idPrm: '12345678901234',
      grandeur: [
        {
          unite: 'W',
          points: [
            { d: '2026-11-23 02:30:00', v: '600' },
            { d: '2026-11-23 12:00:00', v: 1800 },
          ],
        },
      ],
    };
    const curve = parseConsoApiResponse(curveV2, 'load_curve_30m');
    expect(curve).toHaveLength(2);
    expect(curve[0]).toMatchObject({
      dateKey: '2026-11-23',
      powerW: 600,
      energyKwh: 0.3,
    });
    expect(curve[1]).toMatchObject({
      dateKey: '2026-11-23',
      powerW: 1800,
      energyKwh: 0.9,
    });

    const maxV2 = {
      idPrm: '12345678901234',
      grandeur: [
        {
          unite: 'VA',
          points: [{ d: '2026-11-23 19:12:00', v: '5420' }],
        },
      ],
    };
    const maxPts = parseConsoApiResponse(maxV2, 'max_power_daily');
    expect(maxPts).toHaveLength(1);
    expect(maxPts[0]).toMatchObject({
      granularity: 'max_power_daily',
      dateKey: '2026-11-23',
      powerW: 5420,
      energyKwh: null,
    });
  });

  it('parses legacy V5 interval_reading JSON format as fallback', () => {
    const legacyV5 = {
      meter_reading: {
        usage_point_id: '99887766554433',
        reading_type: { unit: 'Wh' },
        interval_reading: [
          { date: '2026-11-20', value: '5100' },
          { date: '2026-11-21', value: '4900' },
        ],
      },
    };
    const daily = parseConsoApiResponse(legacyV5, 'daily_kwh');
    expect(daily).toHaveLength(2);
    expect(daily[0].pointId).toBe('99887766554433');
    expect(daily[0].energyKwh).toBe(5.1);
  });

  it('enforces anti-ban schedule guardrails (after 08h Paris, J-1 missing, cooldowns)', () => {
    // 06:30 Paris -> blocked
    const earlyMorning = new Date('2026-11-24T05:30:00.000Z');
    expect(
      shouldRunScheduledConsoApiSync({
        now: earlyMorning,
        hasYesterdayDaily: false,
        hasYesterdayLoadCurve: false,
      })
    ).toEqual({ shouldRun: false, reason: 'before_08h_paris' });

    // 09:00 Paris, J-1 already present -> skipped
    const morning = new Date('2026-11-24T08:00:00.000Z');
    expect(
      shouldRunScheduledConsoApiSync({
        now: morning,
        hasYesterdayDaily: true,
        hasYesterdayLoadCurve: true,
      })
    ).toEqual({ shouldRun: false, reason: 'yesterday_already_synced' });

    // 09:00 Paris, J-1 missing, 403/429 backoff active -> skipped
    expect(
      shouldRunScheduledConsoApiSync({
        now: morning,
        hasYesterdayDaily: false,
        hasYesterdayLoadCurve: false,
        cooldownUntil: '2026-11-25T07:00:00.000Z',
      })
    ).toEqual({ shouldRun: false, reason: 'rate_limit_backoff' });

    // 09:00 Paris, J-1 missing, recent attempt 2h ago -> skipped
    expect(
      shouldRunScheduledConsoApiSync({
        now: morning,
        hasYesterdayDaily: false,
        hasYesterdayLoadCurve: false,
        lastAttemptAt: '2026-11-24T06:00:00.000Z',
      })
    ).toEqual({ shouldRun: false, reason: 'attempt_cooldown' });

    // 09:00 Paris, J-1 missing, old attempt -> allowed
    expect(
      shouldRunScheduledConsoApiSync({
        now: morning,
        hasYesterdayDaily: false,
        hasYesterdayLoadCurve: false,
        lastAttemptAt: '2026-11-23T08:00:00.000Z',
      })
    ).toEqual({ shouldRun: true, reason: 'due' });

    expect(addDaysYmd('2026-11-24', -1)).toBe('2026-11-23');
  });
});
