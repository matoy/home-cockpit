import { describe, expect, it } from 'vitest';
import {
  buildClimateStatsCsv,
  buildEnergyTimeSeriesCsv,
  escapeCsvCell,
} from '@/lib/csv-export';
import type { DashboardPayload, RoomSummary } from '@/types';

describe('csv-export helpers', () => {
  it('escapes delimiters, quotes, and neutralizes formula injection strings while preserving negative numbers', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
    expect(escapeCsvCell('Salon, Nord')).toBe('"Salon, Nord"');
    expect(escapeCsvCell('Say "Hi"')).toBe('"Say ""Hi"""');
    expect(escapeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell('+cmd')).toBe("'+cmd");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('@RISK')).toBe("'@RISK");
  });

  it('builds UTF-8 BOM CSV for energy time series and climate stats', () => {
    const payload = {
      energyByRoom: [
        {
          id: '1',
          name: 'Salon',
          color: '#6366f1',
          energyKwh: 1.5,
          costEur: 0.3,
          avgPowerW: 100,
          maxPowerW: 200,
          sharePct: 100,
        },
      ],
      timeSeries: [
        {
          bucket: '2026-11-24T10:00',
          label: '10:00',
          totalPowerW: 100,
          totalEnergyKwh: 0.5,
          totalCostEur: 0.1,
          byRoomEnergy: { '1': 0.5 },
          byRoomPower: { '1': 100 },
          byRoomCost: { '1': 0.1 },
          byDeviceEnergy: {},
          byDevicePower: {},
          byDeviceCost: {},
          byRoomTemp: {},
          byRoomHumidity: {},
        },
      ],
    } as unknown as DashboardPayload;

    const energyCsv = buildEnergyTimeSeriesCsv(payload);
    expect(energyCsv.startsWith('\uFEFFBucket,Label,Total_kWh,Total_W,Total_EUR,Salon (kWh)')).toBe(true);
    expect(energyCsv).toContain('2026-11-24T10:00,10:00,0.5,100,0.1,0.5');

    const summaries: RoomSummary[] = [
      {
        room: {
          id: 1,
          name: 'Bureau, 1er',
          icon: 'Laptop',
          color: '#10b981',
          targetTempMin: 19,
          targetTempMax: 22,
          targetHumidityMin: 40,
          targetHumidityMax: 60,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        currentPowerW: 0,
        periodEnergyKwh: 0,
        periodCostEur: 0,
        currentTempC: 20.5,
        currentHumidityPct: 48,
        dewPointC: 9.1,
        avgTempC: 20.1,
        minTempC: 19.2,
        maxTempC: 21.3,
        avgHumidityPct: 47,
        minHumidityPct: 44,
        maxHumidityPct: 50,
        comfort: { label: 'Optimal', tone: 'emerald' },
        devices: [],
      },
    ];

    const climateCsv = buildClimateStatsCsv(summaries);
    expect(
      climateCsv.startsWith(
        '\uFEFFRoom,Current_Temp_C,Min_Temp_C,Max_Temp_C,Avg_Temp_C,Avg_Humidity_Pct,Dew_Point_C,Comfort'
      )
    ).toBe(true);
    expect(climateCsv).toContain('"Bureau, 1er",20.5,19.2,21.3,20.1,47,9.1,Optimal');
  });
});
