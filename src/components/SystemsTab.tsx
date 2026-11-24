'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Clock,
  Cpu,
  ExternalLink,
  Plug,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { VENDOR_IDS, VENDOR_REGISTRY } from '@/lib/vendors/registry';
import { AlertBanner } from './ui';
import { useI18n } from './I18nProvider';

const CUSTOM_RENDERED_VENDORS = new Set<VendorId>([
  'tuya',
  'kasa',
  'home_connect',
  'somfy',
  'daikin',
  'xsense',
  'xiaomi',
  'google_home',
]);
import type { DashboardPayload, GoogleHomeMode, HomeConnectEnv, VendorId } from '@/types';

interface SystemsTabProps {
  data: DashboardPayload;
  onRefresh: () => Promise<void>;
  onOpenDevicesTab?: () => void;
  onOpenKasaGuide?: () => void;
  onOpenHomeConnectGuide?: () => void;
  onOpenSomfyGuide?: () => void;
  onOpenDaikinGuide?: () => void;
  onOpenXSenseGuide?: () => void;
  onOpenXiaomiGuide?: () => void;
  onOpenGoogleGuide?: () => void;
}

export function SystemsTab({
  data,
  onRefresh,
  onOpenDevicesTab,
  onOpenKasaGuide,
  onOpenHomeConnectGuide,
  onOpenSomfyGuide,
  onOpenDaikinGuide,
  onOpenXSenseGuide,
  onOpenXiaomiGuide,
  onOpenGoogleGuide,
}: SystemsTabProps) {
  const { t, intlLocale } = useI18n();
  const showKasa = data.env.kasaConfigured;
  const showHomeConnect = data.env.homeConnectConfigured;
  const showSomfy = data.env.somfyConfigured;
  const showDaikin = data.env.daikinConfigured;
  const showXSense = data.env.xsenseConfigured || data.env.mode === 'demo';
  const showXiaomi = true;
  const showGoogleHomeApi = data.env.googleHomeApiEnabled;

  const [syncingTuya, setSyncingTuya] = useState(false);
  const [syncingKasa, setSyncingKasa] = useState(false);
  const [syncingHomeConnect, setSyncingHomeConnect] = useState(false);
  const [disconnectingHomeConnect, setDisconnectingHomeConnect] = useState(false);
  const [selectedHomeConnectEnv, setSelectedHomeConnectEnv] = useState<HomeConnectEnv>(
    data.env.homeConnectEnv ?? 'prod'
  );
  const [syncingSomfy, setSyncingSomfy] = useState(false);
  const [syncingDaikin, setSyncingDaikin] = useState(false);
  const [disconnectingDaikin, setDisconnectingDaikin] = useState(false);
  const [showDaikinLocalBox, setShowDaikinLocalBox] = useState(false);
  const [daikinExchangeInput, setDaikinExchangeInput] = useState('');
  const [exchangingDaikin, setExchangingDaikin] = useState(false);
  const [syncingXSense, setSyncingXSense] = useState(false);
  const [syncingXiaomi, setSyncingXiaomi] = useState(false);
  const [disconnectingXiaomi, setDisconnectingXiaomi] = useState(false);
  const [showXiaomiAuthBox, setShowXiaomiAuthBox] = useState(false);
  const [xiaomiQrData, setXiaomiQrData] = useState<{
    qrImageUrl: string;
    loginUrl: string;
    qrStateToken: string;
  } | null>(null);
  const [xiaomiStartingQr, setXiaomiStartingQr] = useState(false);
  const [xiaomiUsername, setXiaomiUsername] = useState('');
  const [xiaomiPassword, setXiaomiPassword] = useState('');
  const [xiaomiRegion, setXiaomiRegion] = useState(data.env.xiaomiRegion || 'de');
  const [xiaomiLoggingIn, setXiaomiLoggingIn] = useState(false);
  const [xiaomi2faToken, setXiaomi2faToken] = useState<string | null>(null);
  const [xiaomi2faCode, setXiaomi2faCode] = useState('');
  const [xiaomiVerifying2fa, setXiaomiVerifying2fa] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);
  const [selectedGoogleMode, setSelectedGoogleMode] = useState<GoogleHomeMode>(
    data.env.googleHomeMode ?? 'mcp'
  );
  const [syncingGenericVendor, setSyncingGenericVendor] = useState<VendorId | null>(null);
  const [disconnectingGenericVendor, setDisconnectingGenericVendor] = useState<VendorId | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const systemCounts = useMemo(() => {
    const counts = Object.fromEntries(VENDOR_IDS.map((id) => [id, 0])) as Record<VendorId, number>;
    for (const dev of data.devices) {
      for (const vendor of dev.systems) {
        counts[vendor] = (counts[vendor] ?? 0) + 1;
      }
    }
    return counts;
  }, [data.devices]);

  useEffect(() => {
    if (!xiaomiQrData) return;
    let active = true;
    const intervalId = setInterval(async () => {
      if (!active) return;
      try {
        const res = await fetch('/api/vendors/xiaomi/auth/qr/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qrStateToken: xiaomiQrData.qrStateToken }),
        });
        const json = (await res.json()) as {
          status?: string;
          message?: string;
          error?: string;
        };
        if (!active) return;
        if (!res.ok) {
          setXiaomiQrData(null);
          setSyncMessage({
            ok: false,
            text: json.error || t('systems.errXiaomiQrScan'),
          });
          return;
        }
        if (json.status === 'expired') {
          setXiaomiQrData(null);
          setSyncMessage({
            ok: false,
            text: json.message || t('systems.errXiaomiQrExpired'),
          });
        } else if (json.status === 'connected') {
          setXiaomiQrData(null);
          setShowXiaomiAuthBox(false);
          setSyncMessage({
            ok: true,
            text: json.message || t('systems.okXiaomiQrConnected'),
          });
          await onRefresh();
        }
      } catch {
        // Continuer la tentative au cycle suivant
      }
    }, 2500);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [xiaomiQrData, onRefresh, t]);

  async function handleSyncTuya() {
    setSyncingTuya(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/tuya/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('systems.errSync', { vendor: 'Tuya' }));
      setSyncMessage({ ok: true, text: json.message || t('systems.okSync', { vendor: 'Tuya' }) });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Tuya' }),
      });
    } finally {
      setSyncingTuya(false);
    }
  }

  async function handleSyncKasa() {
    setSyncingKasa(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/kasa/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('systems.errSync', { vendor: 'Kasa' }));
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Kasa Cloud' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Kasa Cloud' }),
      });
    } finally {
      setSyncingKasa(false);
    }
  }

  async function handleSyncHomeConnect() {
    setSyncingHomeConnect(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/home-connect/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errSync', { vendor: 'Siemens Home Connect' }));
      }
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Siemens Home Connect' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errVendor', { vendor: 'Siemens Home Connect' }),
      });
    } finally {
      setSyncingHomeConnect(false);
    }
  }

  async function handleDisconnectHomeConnect() {
    setDisconnectingHomeConnect(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/home-connect/disconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(
          json.error || t('systems.errDisconnect', { vendor: 'Siemens Home Connect' })
        );
      }
      setSyncMessage({
        ok: true,
        text: t('systems.okDisconnect', { vendor: 'Siemens Home Connect' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errDisconnectGeneric', { vendor: 'Home Connect' }),
      });
    } finally {
      setDisconnectingHomeConnect(false);
    }
  }

  async function handleSyncSomfy() {
    setSyncingSomfy(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/somfy/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('systems.errSync', { vendor: 'Somfy Cloud' }));
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Somfy Cloud' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Somfy Cloud' }),
      });
    } finally {
      setSyncingSomfy(false);
    }
  }

  async function handleSyncDaikin() {
    setSyncingDaikin(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/daikin/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errSync', { vendor: 'Daikin Onecta' }));
      }
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Daikin Onecta' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Daikin Onecta' }),
      });
    } finally {
      setSyncingDaikin(false);
    }
  }

  async function handleExchangeDaikinCode() {
    if (!daikinExchangeInput.trim()) return;
    setExchangingDaikin(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/daikin/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: daikinExchangeInput.trim() }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('systems.errExchangeDaikin'));
      setDaikinExchangeInput('');
      setShowDaikinLocalBox(false);
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okConnectedDaikin'),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errExchangeDaikin'),
      });
    } finally {
      setExchangingDaikin(false);
    }
  }

  async function handleDisconnectDaikin() {
    setDisconnectingDaikin(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/daikin/disconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errDisconnect', { vendor: 'Daikin Onecta' }));
      }
      setSyncMessage({ ok: true, text: t('systems.okDisconnect', { vendor: 'Daikin Onecta' }) });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errDisconnectGeneric', { vendor: 'Daikin Onecta' }),
      });
    } finally {
      setDisconnectingDaikin(false);
    }
  }

  async function handleSyncXSense() {
    setSyncingXSense(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/xsense/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errSync', { vendor: 'X-Sense Security' }));
      }
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'X-Sense Security' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errVendor', { vendor: 'X-Sense Security' }),
      });
    } finally {
      setSyncingXSense(false);
    }
  }

  async function handleStartXiaomiQr() {
    setXiaomiStartingQr(true);
    setSyncMessage(null);
    setXiaomi2faToken(null);
    try {
      const res = await fetch('/api/vendors/xiaomi/auth/qr/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: xiaomiRegion }),
      });
      const json = (await res.json()) as {
        qrImageUrl?: string;
        loginUrl?: string;
        qrStateToken?: string;
        error?: string;
      };
      if (!res.ok || !json.qrImageUrl || !json.qrStateToken) {
        throw new Error(json.error || t('systems.errXiaomiQrStart'));
      }
      setXiaomiQrData({
        qrImageUrl: json.qrImageUrl,
        loginUrl: json.loginUrl ?? json.qrImageUrl,
        qrStateToken: json.qrStateToken,
      });
      setShowXiaomiAuthBox(true);
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errXiaomiQrStart'),
      });
    } finally {
      setXiaomiStartingQr(false);
    }
  }

  async function handleXiaomiCredentialLogin() {
    setXiaomiLoggingIn(true);
    setSyncMessage(null);
    setXiaomiQrData(null);
    try {
      const res = await fetch('/api/vendors/xiaomi/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(xiaomiUsername.trim() ? { username: xiaomiUsername.trim() } : {}),
          ...(xiaomiPassword ? { password: xiaomiPassword } : {}),
          region: xiaomiRegion,
        }),
      });
      const json = (await res.json()) as {
        status?: string;
        verifyStateToken?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || t('systems.errXiaomiLogin'));
      if (json.status === 'requires_2fa' && json.verifyStateToken) {
        setXiaomi2faToken(json.verifyStateToken);
        setShowXiaomiAuthBox(true);
        setSyncMessage({
          ok: true,
          text: json.message || t('systems.okXiaomi2faRequired'),
        });
        return;
      }
      setXiaomi2faToken(null);
      setShowXiaomiAuthBox(false);
      setXiaomiPassword('');
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okXiaomiConnected'),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errXiaomiLogin'),
      });
    } finally {
      setXiaomiLoggingIn(false);
    }
  }

  async function handleXiaomiVerify2fa() {
    if (!xiaomi2faToken || !xiaomi2faCode.trim()) return;
    setXiaomiVerifying2fa(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/xiaomi/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifyStateToken: xiaomi2faToken,
          code: xiaomi2faCode.trim(),
        }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || t('systems.errXiaomi2faInvalid'));
      setXiaomi2faToken(null);
      setXiaomi2faCode('');
      setShowXiaomiAuthBox(false);
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okXiaomiConnected'),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : t('systems.errXiaomi2faInvalid'),
      });
    } finally {
      setXiaomiVerifying2fa(false);
    }
  }

  async function handleSyncXiaomi() {
    setSyncingXiaomi(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/xiaomi/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errSync', { vendor: 'Xiaomi Home' }));
      }
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Xiaomi Home' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Xiaomi Home' }),
      });
    } finally {
      setSyncingXiaomi(false);
    }
  }

  async function handleDisconnectXiaomi() {
    setDisconnectingXiaomi(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/xiaomi/disconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errDisconnect', { vendor: 'Xiaomi Home' }));
      }
      setXiaomiQrData(null);
      setXiaomi2faToken(null);
      setSyncMessage({ ok: true, text: t('systems.okDisconnect', { vendor: 'Xiaomi Home' }) });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errDisconnectGeneric', { vendor: 'Xiaomi Home' }),
      });
    } finally {
      setDisconnectingXiaomi(false);
    }
  }

  async function handleSyncGoogleHome() {
    setSyncingGoogle(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/google-home/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errSync', { vendor: 'Google Home' }));
      }
      setSyncMessage({
        ok: true,
        text: json.message || t('systems.okSync', { vendor: 'Google Home' }),
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error ? err.message : t('systems.errVendor', { vendor: 'Google Home' }),
      });
    } finally {
      setSyncingGoogle(false);
    }
  }

  async function handleDisconnectGoogleHome() {
    setDisconnectingGoogle(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/vendors/google-home/disconnect', { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || t('systems.errDisconnect', { vendor: 'Google Home' }));
      }
      setSyncMessage({ ok: true, text: t('systems.okDisconnect', { vendor: 'Google Home' }) });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errDisconnectGeneric', { vendor: 'Google Home' }),
      });
    } finally {
      setDisconnectingGoogle(false);
    }
  }

  const tuyaVendor = data.vendors.find((v) => v.vendor === 'tuya');
  const kasaVendor = data.vendors.find((v) => v.vendor === 'kasa');
  const hcVendor = data.vendors.find((v) => v.vendor === 'home_connect');
  const isHcConnected = Boolean(hcVendor?.connected);
  const somfyVendor = data.vendors.find((v) => v.vendor === 'somfy');
  const daikinVendor = data.vendors.find((v) => v.vendor === 'daikin');
  const isDkConnected = Boolean(daikinVendor?.connected);
  const xsenseVendor = data.vendors.find((v) => v.vendor === 'xsense');
  const xiaomiVendor = data.vendors.find((v) => v.vendor === 'xiaomi');
  const isXiaomiConnected = Boolean(xiaomiVendor?.connected || data.env.xiaomiConnected);
  const ghVendor = data.vendors.find((v) => v.vendor === 'google_home');
  const isGhConnected = Boolean(ghVendor?.connected);

  const extraGenericVendorIds = VENDOR_IDS.filter((id) => !CUSTOM_RENDERED_VENDORS.has(id));
  const visibleGenericVendors = extraGenericVendorIds.filter((id) => {
    const summary = data.vendors.find((v) => v.vendor === id);
    return (
      Boolean(summary?.configured) ||
      Boolean(summary?.connected) ||
      data.env.mode === 'demo' ||
      (systemCounts[id] ?? 0) > 0
    );
  });
  const unconfiguredGenericVendors = extraGenericVendorIds.filter(
    (id) => !visibleGenericVendors.includes(id)
  );

  async function handleSyncGenericVendor(vendorId: VendorId) {
    const meta = VENDOR_REGISTRY[vendorId];
    setSyncingGenericVendor(vendorId);
    setSyncMessage(null);
    try {
      const res = await fetch(meta.syncEndpoint, { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setSyncMessage({
          ok: false,
          text: json.error || t('systems.errSync', { vendor: meta.label }),
        });
      } else {
        setSyncMessage({
          ok: true,
          text: json.message || t('systems.okSync', { vendor: meta.label }),
        });
        await onRefresh();
      }
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errSync', { vendor: meta.label }),
      });
    } finally {
      setSyncingGenericVendor(null);
    }
  }

  async function handleDisconnectGenericVendor(vendorId: VendorId) {
    const meta = VENDOR_REGISTRY[vendorId];
    if (!meta.disconnectEndpoint) return;
    setDisconnectingGenericVendor(vendorId);
    setSyncMessage(null);
    try {
      const res = await fetch(meta.disconnectEndpoint, { method: 'POST' });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSyncMessage({
          ok: false,
          text: json.error || t('systems.errDisconnectGeneric', { vendor: meta.label }),
        });
      } else {
        setSyncMessage({
          ok: true,
          text: t('systems.okDisconnect', { vendor: meta.label }),
        });
        await onRefresh();
      }
    } catch (err) {
      setSyncMessage({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : t('systems.errDisconnectGeneric', { vendor: meta.label }),
      });
    } finally {
      setDisconnectingGenericVendor(null);
    }
  }

  const visibleSyncCardsCount =
    1 +
    (showKasa ? 1 : 0) +
    (showHomeConnect ? 1 : 0) +
    (showSomfy ? 1 : 0) +
    (showDaikin ? 1 : 0) +
    (showXSense ? 1 : 0) +
    (showXiaomi ? 1 : 0) +
    (showGoogleHomeApi ? 1 : 0) +
    visibleGenericVendors.length;

  const syncGridClass =
    visibleSyncCardsCount === 1
      ? 'grid grid-cols-1 gap-4'
      : visibleSyncCardsCount === 2
        ? 'grid grid-cols-1 lg:grid-cols-2 gap-4'
        : visibleSyncCardsCount === 3
          ? 'grid grid-cols-1 lg:grid-cols-3 gap-4'
          : 'grid grid-cols-1 md:grid-cols-2 gap-4';

  const hcModeEnvLabel = (
    hcVendor?.mode === 'oauth_simulator'
      ? 'SIMULATOR'
      : hcVendor?.mode === 'oauth_cn'
        ? 'CN'
        : hcVendor?.mode === 'oauth_prod'
          ? 'PROD'
          : selectedHomeConnectEnv
  )
    .toString()
    .toUpperCase();

  const connectedSystemsCount = data.vendors.filter((v) => v.connected).length;

  const availableUnconfiguredSystems: Array<{
    vendor: VendorId;
    scope: string;
    onOpenGuide?: () => void;
  }> = [
      ...(!showKasa
        ? [
          {
            vendor: 'kasa' as const,
            scope: t('systems.scopeKasa'),
            onOpenGuide: onOpenKasaGuide,
          },
        ]
        : []),
      ...(!showHomeConnect
        ? [
          {
            vendor: 'home_connect' as const,
            scope: t('systems.scopeHc'),
            onOpenGuide: onOpenHomeConnectGuide,
          },
        ]
        : []),
      ...(!showSomfy
        ? [
          {
            vendor: 'somfy' as const,
            scope: t('systems.scopeSomfy'),
            onOpenGuide: onOpenSomfyGuide,
          },
        ]
        : []),
      ...(!showDaikin
        ? [
          {
            vendor: 'daikin' as const,
            scope: t('systems.scopeDaikin'),
            onOpenGuide: onOpenDaikinGuide,
          },
        ]
        : []),
      ...(!showXSense
        ? [
          {
            vendor: 'xsense' as const,
            scope: t('systems.scopeXSense'),
            onOpenGuide: onOpenXSenseGuide,
          },
        ]
        : []),
      ...(!showGoogleHomeApi
        ? [
          {
            vendor: 'google_home' as const,
            scope: t('systems.scopeGh'),
            onOpenGuide: onOpenGoogleGuide,
          },
        ]
        : []),
      ...unconfiguredGenericVendors.map((id) => {
        const meta = VENDOR_REGISTRY[id];
        const envHint = meta.envVars.length > 0 ? ` (${meta.envVars.join(', ')})` : '';
        return {
          vendor: id,
          scope: `${meta.description}${envHint}`,
        };
      }),
    ];

  return (
    <div className="space-y-6">
      {/* En-tête synthétique Systèmes */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shrink-0">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">
              {t('systems.headerTitle')}
            </h2>
            <p className="text-xs text-slate-400">
              {t('systems.headerSub', {
                connected: connectedSystemsCount,
                active: visibleSyncCardsCount,
                devices: data.devices.length,
              })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${data.env.mode === 'live'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
          >
            {data.env.mode === 'live' ? t('common.liveModeReadOnly') : t('common.demoMode')}
          </span>

          {onOpenDevicesTab && (
            <button
              type="button"
              onClick={onOpenDevicesTab}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
            >
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              {t('systems.viewDevicesBtn')}
            </button>
          )}
        </div>
      </div>

      {/* Synchronisation Multi-Vendors */}
      <div className={syncGridClass}>
        {/* Tuya Cloud */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.tuya.badgeClass}`}
                >
                  {VENDOR_REGISTRY.tuya.label}
                </span>
                <span className="text-xs text-slate-400">
                  {t('common.devicesCount', { count: tuyaVendor?.devicesCount ?? systemCounts.tuya })}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.env.tuyaConfigured || data.env.mode === 'demo'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {data.env.mode === 'demo'
                    ? t('common.demoMode')
                    : data.env.tuyaConfigured
                      ? `${t('common.connected')} (${data.env.tuyaRegion.toUpperCase()})`
                      : t('common.notConfigured')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {VENDOR_REGISTRY.tuya.description}. {t('systems.tuyaDesc')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500">
              {tuyaVendor?.lastSyncedAt
                ? t('common.syncedAt', {
                  date: new Date(tuyaVendor.lastSyncedAt).toLocaleString(intlLocale),
                })
                : t('common.noRecentSync')}
            </span>
            <button
              type="button"
              onClick={handleSyncTuya}
              disabled={syncingTuya}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingTuya ? 'animate-spin' : ''}`} />
              {syncingTuya ? t('common.syncing') : t('systems.syncTuyaBtn')}
            </button>
          </div>
        </div>

        {/* TP-Link Kasa Cloud (masqué si non configuré) */}
        {showKasa && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.kasa.badgeClass}`}
                  >
                    {VENDOR_REGISTRY.kasa.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t('common.devicesCount', { count: kasaVendor?.devicesCount ?? systemCounts.kasa })}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.env.kasaConfigured || data.env.mode === 'demo'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                      }`}
                  >
                    {data.env.mode === 'demo'
                      ? t('common.demoMode')
                      : data.env.kasaConfigured
                        ? `${t('common.connected')} (${data.env.kasaRegion.toUpperCase()})`
                        : t('common.notConfigured')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.kasa.description}. {t('systems.kasaDesc')}
                </p>
                {kasaVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1.5">{kasaVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {kasaVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(kasaVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : data.env.mode === 'live' && !data.env.kasaConfigured
                    ? t('systems.kasaMissingEnv')
                    : t('common.cloudZeroCmd')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenKasaGuide && (
                  <button
                    type="button"
                    onClick={onOpenKasaGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title={t('common.setupGuideBtn')}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-teal-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSyncKasa}
                  disabled={syncingKasa}
                  className="flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingKasa ? 'animate-spin' : ''}`} />
                  {syncingKasa ? t('common.syncing') : t('systems.syncKasaBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Siemens Home Connect (masqué si non configuré) */}
        {showHomeConnect && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.home_connect.badgeClass}`}
                    >
                      {VENDOR_REGISTRY.home_connect.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {t('common.devicesCount', {
                        count: hcVendor?.devicesCount ?? systemCounts.home_connect,
                      })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isHcConnected || data.env.mode === 'demo'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                        }`}
                    >
                      {data.env.mode === 'demo'
                        ? t('common.demoMode')
                        : isHcConnected
                          ? `${t('common.connected')} (${hcModeEnvLabel})`
                          : t('common.readyOAuth')}
                    </span>
                  </div>

                  {!isHcConnected && data.env.mode === 'live' && (
                    <select
                      value={selectedHomeConnectEnv}
                      onChange={(e) => setSelectedHomeConnectEnv(e.target.value as HomeConnectEnv)}
                      aria-label={t('systems.hcEnvAria')}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="prod">{t('systems.hcEnvProd')}</option>
                      <option value="simulator">{t('systems.hcEnvSim')}</option>
                      <option value="cn">{t('systems.hcEnvCn')}</option>
                    </select>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.home_connect.description}. {t('systems.hcDesc')}
                </p>

                {hcVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1.5">{hcVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {hcVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(hcVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : t('systems.hcFooterDefault')}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenHomeConnectGuide && (
                  <button
                    type="button"
                    onClick={onOpenHomeConnectGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title={t('common.setupGuideBtn')}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}

                {data.env.mode === 'live' && !isHcConnected ? (
                  <a
                    href={`/api/vendors/home-connect/oauth/start?env=${selectedHomeConnectEnv}&returnTab=systems`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('systems.hcConnectBtn', { env: selectedHomeConnectEnv.toUpperCase() })}
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleSyncHomeConnect}
                      disabled={syncingHomeConnect || disconnectingHomeConnect}
                      className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${syncingHomeConnect ? 'animate-spin' : ''}`}
                      />
                      {syncingHomeConnect ? t('common.syncing') : t('systems.syncHcBtn')}
                    </button>
                    {data.env.mode === 'live' && isHcConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectHomeConnect}
                        disabled={disconnectingHomeConnect || syncingHomeConnect}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        {t('common.disconnect')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Somfy Cloud (masqué si non configuré) */}
        {showSomfy && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.somfy.badgeClass}`}
                  >
                    {VENDOR_REGISTRY.somfy.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t('common.devicesCount', {
                      count: somfyVendor?.devicesCount ?? systemCounts.somfy,
                    })}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.env.somfyConfigured || data.env.mode === 'demo'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                      }`}
                  >
                    {data.env.mode === 'demo'
                      ? t('common.demoMode')
                      : data.env.somfyConfigured
                        ? t('rooms.somfyReady', { region: data.env.somfyRegion.toUpperCase() })
                        : t('common.notConfigured')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {t('systems.somfyDesc')}
                </p>
                {somfyVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1">{somfyVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {somfyVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(somfyVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : t('common.cloudZeroCmd')}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenSomfyGuide && (
                  <button
                    type="button"
                    onClick={onOpenSomfyGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title={t('common.setupGuideBtn')}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-amber-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSyncSomfy}
                  disabled={syncingSomfy}
                  className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSomfy ? 'animate-spin' : ''}`} />
                  {syncingSomfy ? t('common.syncing') : t('systems.syncSomfyBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Daikin Onecta Cloud (masqué si non configuré) */}
        {showDaikin && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.daikin.badgeClass}`}
                >
                  {VENDOR_REGISTRY.daikin.label}
                </span>
                <span className="text-xs text-slate-400">
                  {t('common.devicesCount', {
                    count: daikinVendor?.devicesCount ?? systemCounts.daikin,
                  })}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isDkConnected || data.env.mode === 'demo'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {data.env.mode === 'demo'
                    ? t('common.demoMode')
                    : isDkConnected
                      ? t('systems.daikinConnectedOAuth')
                      : t('common.readyOAuth')}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {VENDOR_REGISTRY.daikin.description}. {t('systems.daikinDesc')}
              </p>
              {daikinVendor?.lastError && (
                <p className="text-[11px] text-amber-300">{daikinVendor.lastError}</p>
              )}
              {data.env.mode === 'live' && !isDkConnected && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowDaikinLocalBox((v) => !v)}
                    className="text-[11px] font-medium text-blue-300 hover:text-blue-200 underline underline-offset-2"
                  >
                    {showDaikinLocalBox
                      ? t('systems.daikinLocalHide')
                      : t('systems.daikinLocalShow')}
                  </button>
                  {showDaikinLocalBox && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
                      <input
                        type="text"
                        value={daikinExchangeInput}
                        onChange={(e) => setDaikinExchangeInput(e.target.value)}
                        placeholder={t('systems.daikinExchangePlaceholder')}
                        className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={exchangingDaikin || !daikinExchangeInput.trim()}
                        onClick={() => void handleExchangeDaikinCode()}
                        className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                      >
                        {exchangingDaikin ? t('common.validating') : t('common.validate')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {daikinVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(daikinVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : t('systems.daikinFooterDefault')}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenDaikinGuide && (
                  <button
                    type="button"
                    onClick={onOpenDaikinGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title={t('common.setupGuideBtn')}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-blue-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}

                {data.env.mode === 'live' && !isDkConnected ? (
                  <a
                    href="/api/vendors/daikin/oauth/start?returnTab=systems"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('systems.daikinConnectBtn')}
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleSyncDaikin}
                      disabled={syncingDaikin || disconnectingDaikin}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${syncingDaikin ? 'animate-spin' : ''}`}
                      />
                      {syncingDaikin ? t('common.syncing') : t('systems.syncDaikinBtn')}
                    </button>
                    {data.env.mode === 'live' && isDkConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectDaikin}
                        disabled={disconnectingDaikin || syncingDaikin}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        {t('common.disconnect')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* X-Sense Home Security */}
        {showXSense && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.xsense.badgeClass}`}
                >
                  {VENDOR_REGISTRY.xsense.label}
                </span>
                <span className="text-xs text-slate-400">
                  {t('common.devicesCount', {
                    count: xsenseVendor?.devicesCount ?? systemCounts.xsense,
                  })}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.env.mode === 'demo' || xsenseVendor?.connected || data.env.xsenseConfigured
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {data.env.mode === 'demo'
                    ? t('common.demoMode')
                    : xsenseVendor?.connected || data.env.xsenseConfigured
                      ? t('systems.xsenseActive')
                      : t('common.notConfigured')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                {t('systems.xsenseDesc')}
              </p>
              {xsenseVendor?.lastError && (
                <p className="text-[11px] text-amber-300 mt-1">{xsenseVendor.lastError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {xsenseVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(xsenseVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : t('systems.xsenseFooterDefault')}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenXSenseGuide && (
                  <button
                    type="button"
                    onClick={onOpenXSenseGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-rose-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSyncXSense()}
                  disabled={syncingXSense}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingXSense ? 'animate-spin' : ''}`} />
                  {syncingXSense ? t('common.syncing') : t('systems.syncXSenseBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Xiaomi Home (Mi Cloud : QR Code ou compte .env + 2FA) */}
        {showXiaomi && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.xiaomi.badgeClass}`}
                >
                  {VENDOR_REGISTRY.xiaomi.label}
                </span>
                <span className="text-xs text-slate-400">
                  {t('common.devicesCount', {
                    count: xiaomiVendor?.devicesCount ?? systemCounts.xiaomi,
                  })}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${data.env.mode === 'demo' || isXiaomiConnected
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : data.env.xiaomiConfigured
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {data.env.mode === 'demo'
                    ? t('common.demoMode')
                    : isXiaomiConnected
                      ? `${t('common.connected')} (${xiaomiRegion.toUpperCase()})`
                      : data.env.xiaomiConfigured
                        ? t('systems.xiaomiReqAuth')
                        : t('systems.xiaomiQrOrEnv')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                {t('systems.xiaomiDesc')}
              </p>
              {xiaomiVendor?.lastError && (
                <p className="text-[11px] text-amber-300 mt-1">{xiaomiVendor.lastError}</p>
              )}

              {/* Panneau interactif QR Code / Identifiants + 2FA */}
              {(showXiaomiAuthBox || !isXiaomiConnected) && data.env.mode === 'live' && (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={xiaomiRegion}
                      onChange={(e) => setXiaomiRegion(e.target.value)}
                      aria-label={t('systems.xiaomiServerAria')}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-orange-500 focus:outline-none"
                    >
                      <option value="de">{t('systems.xiaomiRegionDe')}</option>
                      <option value="cn">{t('systems.xiaomiRegionCn')}</option>
                      <option value="us">{t('systems.xiaomiRegionUs')}</option>
                      <option value="sg">{t('systems.xiaomiRegionSg')}</option>
                      <option value="ru">{t('systems.xiaomiRegionRu')}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleStartXiaomiQr()}
                      disabled={xiaomiStartingQr}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/15 hover:bg-orange-500/25 px-2.5 py-1 text-[11px] font-medium text-orange-200 transition"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      {xiaomiStartingQr ? t('systems.xiaomiQrGenerating') : t('systems.xiaomiQrScanBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowXiaomiAuthBox((v) => !v)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
                    >
                      {showXiaomiAuthBox ? t('systems.xiaomiHideOpts') : t('systems.xiaomiAccountOpts')}
                    </button>
                  </div>

                  {xiaomiQrData && (
                    <div className="rounded-xl border border-orange-500/30 bg-slate-950/80 p-3 flex flex-wrap items-center gap-3">
                      <img
                        src={xiaomiQrData.qrImageUrl}
                        alt="QR Code Xiaomi Home"
                        className="h-28 w-28 rounded-lg bg-white p-1"
                      />
                      <div className="space-y-1.5 text-[11px] text-slate-300 flex-1 min-w-[180px]">
                        <p className="font-medium text-orange-200">
                          {t('systems.xiaomiQrTitle')}
                        </p>
                        <p className="text-slate-400">
                          {t('systems.xiaomiQrHelp')}
                        </p>
                        <button
                          type="button"
                          onClick={() => setXiaomiQrData(null)}
                          className="text-slate-400 hover:text-white underline"
                        >
                          {t('systems.xiaomiQrCancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {showXiaomiAuthBox && !xiaomiQrData && (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 space-y-2">
                      {!xiaomi2faToken ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={xiaomiUsername}
                            onChange={(e) => setXiaomiUsername(e.target.value)}
                            placeholder={t('systems.xiaomiUserPlaceholder')}
                            className="flex-1 min-w-[150px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <input
                            type="password"
                            value={xiaomiPassword}
                            onChange={(e) => setXiaomiPassword(e.target.value)}
                            placeholder={t('systems.xiaomiPassPlaceholder')}
                            className="flex-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <button
                            type="button"
                            disabled={xiaomiLoggingIn}
                            onClick={() => void handleXiaomiCredentialLogin()}
                            className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                          >
                            {xiaomiLoggingIn ? t('systems.xiaomiConnecting') : t('systems.xiaomiConnectBtn')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={xiaomi2faCode}
                            onChange={(e) => setXiaomi2faCode(e.target.value)}
                            placeholder={t('systems.xiaomi2faPlaceholder')}
                            className="flex-1 min-w-[180px] rounded-lg border border-orange-500/40 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <button
                            type="button"
                            disabled={xiaomiVerifying2fa || !xiaomi2faCode.trim()}
                            onClick={() => void handleXiaomiVerify2fa()}
                            className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                          >
                            {xiaomiVerifying2fa ? t('common.validating') : t('systems.xiaomi2faValidateBtn')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {xiaomiVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(xiaomiVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : t('systems.xiaomiFooterDefault')}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenXiaomiGuide && (
                  <button
                    type="button"
                    onClick={onOpenXiaomiGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-orange-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}
                {(data.env.mode === 'demo' || isXiaomiConnected) && (
                  <button
                    type="button"
                    onClick={() => void handleSyncXiaomi()}
                    disabled={syncingXiaomi || disconnectingXiaomi}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${syncingXiaomi ? 'animate-spin' : ''}`}
                    />
                    {syncingXiaomi ? t('common.syncing') : t('systems.syncXiaomiBtn')}
                  </button>
                )}
                {data.env.mode === 'live' && isXiaomiConnected && (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectXiaomi()}
                    disabled={disconnectingXiaomi || syncingXiaomi}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                  >
                    {t('common.disconnect')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Google Home (masqué si GOOGLE_HOME_MODE=off ou non défini) */}
        {showGoogleHomeApi && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="w-full">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${VENDOR_REGISTRY.google_home.badgeClass}`}
                    >
                      {VENDOR_REGISTRY.google_home.label}
                    </span>
                    <span className="text-xs text-slate-400">
                      {t('common.devicesCount', {
                        count: ghVendor?.devicesCount ?? systemCounts.google_home,
                      })}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isGhConnected
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                        }`}
                    >
                      {data.env.mode === 'demo'
                        ? t('common.demoMode')
                        : isGhConnected
                          ? `${t('common.connected')} (${(ghVendor?.mode ?? selectedGoogleMode).toString().toUpperCase()})`
                          : data.env.googleHomeConfigured
                            ? t('common.readyOAuth')
                            : t('common.oauthNotConfigured')}
                    </span>
                  </div>

                  {!isGhConnected && data.env.mode === 'live' && (
                    <select
                      value={selectedGoogleMode}
                      onChange={(e) => setSelectedGoogleMode(e.target.value as GoogleHomeMode)}
                      aria-label={t('systems.ghModeAria')}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="mcp">{t('systems.ghModeMcp')}</option>
                      <option value="sdm">{t('systems.ghModeSdm')}</option>
                    </select>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.google_home.description}. {t('systems.ghDesc')}
                </p>

                {ghVendor?.lastError && (
                  <p className="text-[11px] text-rose-300 mt-1.5">{ghVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {ghVendor?.lastSyncedAt
                  ? t('common.syncedAt', {
                    date: new Date(ghVendor.lastSyncedAt).toLocaleString(intlLocale),
                  })
                  : data.env.mode === 'live' && !data.env.googleHomeConfigured
                    ? t('systems.ghMissingEnv')
                    : t('common.readOnlyZeroCmd')}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenGoogleGuide && (
                  <button
                    type="button"
                    onClick={onOpenGoogleGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title={t('common.setupGuideBtn')}
                  >
                    <BookOpen className="h-3.5 w-3.5 text-sky-400" />
                    {t('common.setupGuideBtn')}
                  </button>
                )}
                {data.env.mode === 'live' && !isGhConnected ? (
                  <a
                    href={`/api/vendors/google-home/oauth/start?mode=${selectedGoogleMode}&returnTab=systems`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('systems.ghConnectBtn', { mode: selectedGoogleMode.toUpperCase() })}
                  </a>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleSyncGoogleHome}
                      disabled={syncingGoogle || disconnectingGoogle}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncingGoogle ? 'animate-spin' : ''}`} />
                      {syncingGoogle ? t('common.syncing') : t('systems.syncGhBtn')}
                    </button>
                    {data.env.mode === 'live' && isGhConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogleHome}
                        disabled={disconnectingGoogle || syncingGoogle}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        {t('common.disconnect')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {visibleGenericVendors.map((vendorId) => {
          const meta = VENDOR_REGISTRY[vendorId];
          const vendorSummary = data.vendors.find((v) => v.vendor === vendorId);
          const isConnected = Boolean(vendorSummary?.connected);
          const isSyncing = syncingGenericVendor === vendorId;
          const isDisconnecting = disconnectingGenericVendor === vendorId;
          return (
            <div
              key={vendorId}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${isConnected
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-slate-950/60 text-slate-400'
                      }`}
                  >
                    {isConnected ? t('common.connected') : t('common.configured')}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                    {t('common.devicesCount', { count: systemCounts[vendorId] ?? 0 })}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{meta.description}</p>
                {vendorSummary?.lastError && (
                  <p className="text-[11px] text-rose-300">{vendorSummary.lastError}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-slate-500">
                  {vendorSummary?.lastSyncedAt
                    ? t('common.syncedAt', {
                      date: new Date(vendorSummary.lastSyncedAt).toLocaleString(intlLocale),
                    })
                    : t('common.readOnlyZeroCmd')}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSyncGenericVendor(vendorId)}
                    disabled={isSyncing || isDisconnecting}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing
                      ? t('common.syncing')
                      : t('systems.syncVendorBtn', { vendor: meta.shortLabel })}
                  </button>
                  {data.env.mode === 'live' &&
                    isConnected &&
                    meta.capabilities.supportsDisconnect &&
                    meta.disconnectEndpoint && (
                      <button
                        type="button"
                        onClick={() => void handleDisconnectGenericVendor(vendorId)}
                        disabled={isDisconnecting || isSyncing}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        {t('common.disconnect')}
                      </button>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {syncMessage && (
        <AlertBanner tone={syncMessage.ok ? 'success' : 'error'}>
          {syncMessage.text}
        </AlertBanner>
      )}

      {/* Autres systèmes disponibles (non encore configurés dans .env) */}
      {availableUnconfiguredSystems.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">{t('systems.otherTitle')}</h3>
              <p className="text-xs text-slate-400">
                {t('systems.otherSub')}
              </p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-[11px] text-slate-300">
              {t('systems.otherCount', { count: availableUnconfiguredSystems.length })}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableUnconfiguredSystems.map((item) => {
              const meta = VENDOR_REGISTRY[item.vendor];
              return (
                <div
                  key={item.vendor}
                  className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {t('common.notConfigured')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{item.scope}</p>
                  </div>

                  {item.onOpenGuide && (
                    <button
                      type="button"
                      onClick={item.onOpenGuide}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white transition"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-indigo-400" />
                      {t('systems.configureGuideBtn')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Journal des collectes */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          {t('systems.logsTitle')}
        </h3>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {data.logs.map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2 w-2 rounded-full ${log.status === 'success' ? 'bg-emerald-400' : 'bg-rose-400'
                    }`}
                />
                <span className="font-mono text-slate-300">
                  {new Date(log.executedAt).toLocaleString(intlLocale)}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                  {log.trigger}
                </span>
              </div>
              <div className="text-slate-400">
                {log.status === 'success' ? (
                  <span>
                    {t('systems.logReadingsRow', {
                      readings: log.readingsInserted,
                      devices: log.devicesCount,
                      ms: log.durationMs ?? 0,
                    })}
                  </span>
                ) : (
                  <span className="text-rose-300">{log.errorMessage}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
