import { describe, expect, it } from 'vitest';
import {
  autoDetectDpConfig,
  extractMetricsFromStatus,
  formatMacAddress,
} from '@/lib/tuya-client';
import { extractCodeFromRedirectInput } from '@/lib/vendors/daikin-client';

describe('vendor clients deterministic helpers', () => {
  it('formats MAC addresses consistently across raw formats', () => {
    expect(formatMacAddress('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
    expect(formatMacAddress('aa-bb-cc-11-22-33')).toBe('AA:BB:CC:11:22:33');
    expect(formatMacAddress('   ')).toBeNull();
    expect(formatMacAddress(undefined)).toBeNull();
  });

  it('auto-detects DP config and extracts scaled Tuya telemetry metrics', () => {
    const rawStatus = [
      { code: 'cur_power', value: 1254 },
      { code: 'cur_voltage', value: 2305 },
      { code: 'add_ele', value: 1234 },
      { code: 'va_temperature', value: 215 },
      { code: 'humidity_value', value: 48 },
      { code: 'doorcontact_state', value: true },
    ];

    const detected = autoDetectDpConfig(rawStatus, {}, 'cz');
    expect(detected.category).toBe('hybrid');
    expect(detected.dpConfig.power?.code).toBe('cur_power');
    expect(detected.dpConfig.voltage?.code).toBe('cur_voltage');

    const metrics = extractMetricsFromStatus(rawStatus, detected.dpConfig);
    expect(metrics.powerW).toBeCloseTo(125.4, 2);
    expect(metrics.voltageV).toBeCloseTo(230.5, 2);
    expect(metrics.contactOpen).toBe(true);
  });

  it('extracts authorization code and optional state from Daikin redirect URLs', () => {
    const fromFullUrl = extractCodeFromRedirectInput(
      'https://cockpit.local/api/vendors/daikin/oauth/callback?code=auth_code_123&state=st_abc'
    );
    expect(fromFullUrl).toEqual({ code: 'auth_code_123', state: 'st_abc' });

    const fromRawCode = extractCodeFromRedirectInput('direct_code_xyz');
    expect(fromRawCode).toEqual({ code: 'direct_code_xyz', state: null });

    expect(() => extractCodeFromRedirectInput('   ')).toThrow();
  });
});
