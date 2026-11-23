'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  Plug,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { VENDOR_REGISTRY } from '@/lib/vendors/registry';
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
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const systemCounts = useMemo(() => {
    const counts: Record<VendorId, number> = {
      tuya: 0,
      kasa: 0,
      home_connect: 0,
      somfy: 0,
      daikin: 0,
      xsense: 0,
      xiaomi: 0,
      google_home: 0,
    };
    for (const dev of data.devices) {
      if (dev.systems.includes('tuya')) counts.tuya += 1;
      if (dev.systems.includes('kasa')) counts.kasa += 1;
      if (dev.systems.includes('home_connect')) counts.home_connect += 1;
      if (dev.systems.includes('somfy')) counts.somfy += 1;
      if (dev.systems.includes('daikin')) counts.daikin += 1;
      if (dev.systems.includes('xsense')) counts.xsense += 1;
      if (dev.systems.includes('xiaomi')) counts.xiaomi += 1;
      if (dev.systems.includes('google_home')) counts.google_home += 1;
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
            text: json.error || 'Échec lors du scan QR Xiaomi Home.',
          });
          return;
        }
        if (json.status === 'expired') {
          setXiaomiQrData(null);
          setSyncMessage({
            ok: false,
            text: json.message || 'QR Code Xiaomi expiré.',
          });
        } else if (json.status === 'connected') {
          setXiaomiQrData(null);
          setShowXiaomiAuthBox(false);
          setSyncMessage({
            ok: true,
            text: json.message || 'Xiaomi Home connecté via QR Code et synchronisé.',
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
  }, [xiaomiQrData, onRefresh]);

  async function handleSyncTuya() {
    setSyncingTuya(true);
    setSyncMessage(null);
    try {
      const res = await fetch('/api/tuya/sync', { method: 'POST' });
      const json = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Tuya');
      setSyncMessage({ ok: true, text: json.message || 'Synchronisation Tuya terminée.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Tuya',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Kasa');
      setSyncMessage({ ok: true, text: json.message || 'Synchronisation Kasa Cloud terminée.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Kasa Cloud',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Siemens Home Connect');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation Siemens Home Connect terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Siemens Home Connect',
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
      if (!res.ok) throw new Error(json.error || 'Échec de déconnexion Siemens Home Connect');
      setSyncMessage({ ok: true, text: 'Siemens Home Connect déconnecté.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur déconnexion Home Connect',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Somfy Cloud');
      setSyncMessage({ ok: true, text: json.message || 'Synchronisation Somfy Cloud terminée.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Somfy Cloud',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Daikin Onecta');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation Daikin Onecta terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Daikin Onecta',
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
      if (!res.ok) throw new Error(json.error || 'Échec échange OAuth Daikin');
      setDaikinExchangeInput('');
      setShowDaikinLocalBox(false);
      setSyncMessage({
        ok: true,
        text: json.message || 'Daikin Onecta connecté et synchronisé.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur échange OAuth Daikin',
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
      if (!res.ok) throw new Error(json.error || 'Échec de déconnexion Daikin Onecta');
      setSyncMessage({ ok: true, text: 'Daikin Onecta déconnecté.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur déconnexion Daikin Onecta',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation X-Sense Security');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation X-Sense Security terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur X-Sense Security',
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
        throw new Error(json.error || 'Impossible de générer le QR Code Xiaomi Home.');
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
        text: err instanceof Error ? err.message : 'Erreur génération QR Xiaomi',
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
      if (!res.ok) throw new Error(json.error || 'Échec connexion Xiaomi Home');
      if (json.status === 'requires_2fa' && json.verifyStateToken) {
        setXiaomi2faToken(json.verifyStateToken);
        setShowXiaomiAuthBox(true);
        setSyncMessage({
          ok: true,
          text: json.message || 'Code de vérification 2FA requis.',
        });
        return;
      }
      setXiaomi2faToken(null);
      setShowXiaomiAuthBox(false);
      setXiaomiPassword('');
      setSyncMessage({
        ok: true,
        text: json.message || 'Xiaomi Home connecté et synchronisé.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur connexion Xiaomi Home',
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
      if (!res.ok) throw new Error(json.error || 'Code 2FA Xiaomi invalide');
      setXiaomi2faToken(null);
      setXiaomi2faCode('');
      setShowXiaomiAuthBox(false);
      setSyncMessage({
        ok: true,
        text: json.message || 'Xiaomi Home connecté et synchronisé.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur validation 2FA Xiaomi',
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
      if (!res.ok) throw new Error(json.error || 'Échec synchronisation Xiaomi Home');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation Xiaomi Home terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Xiaomi Home',
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
      if (!res.ok) throw new Error(json.error || 'Échec déconnexion Xiaomi Home');
      setXiaomiQrData(null);
      setXiaomi2faToken(null);
      setSyncMessage({ ok: true, text: 'Xiaomi Home déconnecté.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur déconnexion Xiaomi Home',
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
      if (!res.ok) throw new Error(json.error || 'Échec de synchronisation Google Home');
      setSyncMessage({
        ok: true,
        text: json.message || 'Synchronisation Google Home terminée.',
      });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur Google Home',
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
      if (!res.ok) throw new Error(json.error || 'Échec de déconnexion Google Home');
      setSyncMessage({ ok: true, text: 'Google Home déconnecté.' });
      await onRefresh();
    } catch (err) {
      setSyncMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur déconnexion',
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

  const visibleSyncCardsCount =
    1 +
    (showKasa ? 1 : 0) +
    (showHomeConnect ? 1 : 0) +
    (showSomfy ? 1 : 0) +
    (showDaikin ? 1 : 0) +
    (showXSense ? 1 : 0) +
    (showXiaomi ? 1 : 0) +
    (showGoogleHomeApi ? 1 : 0);

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
            scope: 'Prises, multiprises & mesures kWh (100 % cloud TP-Link)',
            onOpenGuide: onOpenKasaGuide,
          },
        ]
      : []),
    ...(!showHomeConnect
      ? [
          {
            vendor: 'home_connect' as const,
            scope: 'Électroménager Bosch / Siemens (lecture seule OAuth)',
            onOpenGuide: onOpenHomeConnectGuide,
          },
        ]
      : []),
    ...(!showSomfy
      ? [
          {
            vendor: 'somfy' as const,
            scope: 'Volets roulants io/RTS, stores & capteurs Overkiz',
            onOpenGuide: onOpenSomfyGuide,
          },
        ]
      : []),
    ...(!showDaikin
      ? [
          {
            vendor: 'daikin' as const,
            scope: 'Climatisations & pompes à chaleur Daikin Onecta (OAuth)',
            onOpenGuide: onOpenDaikinGuide,
          },
        ]
      : []),
    ...(!showXSense
      ? [
          {
            vendor: 'xsense' as const,
            scope: 'Détecteurs fumée/CO, fuite d’eau & station SBS50',
            onOpenGuide: onOpenXSenseGuide,
          },
        ]
      : []),
    ...(!showGoogleHomeApi
      ? [
          {
            vendor: 'google_home' as const,
            scope: 'Passerelle Google Home MCP / Nest SDM (OAuth)',
            onOpenGuide: onOpenGoogleGuide,
          },
        ]
      : []),
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
              Connexions &amp; Synchronisation des systèmes
            </h2>
            <p className="text-xs text-slate-400">
              {connectedSystemsCount} système(s) connecté(s) · {visibleSyncCardsCount} intégration(s)
              active(s) · {data.devices.length} appareil(s) inventorié(s)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              data.env.mode === 'live'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            {data.env.mode === 'live' ? 'Mode Live · Lecture seule' : 'Mode Démo'}
          </span>

          {onOpenDevicesTab && (
            <button
              type="button"
              onClick={onOpenDevicesTab}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition"
            >
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              Voir les appareils
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
                  {tuyaVendor?.devicesCount ?? systemCounts.tuya} appareil(s)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    data.env.tuyaConfigured || data.env.mode === 'demo'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {data.env.mode === 'demo'
                    ? 'Mode Démo'
                    : data.env.tuyaConfigured
                      ? `Connecté (${data.env.tuyaRegion.toUpperCase()})`
                      : 'Non configuré'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {VENDOR_REGISTRY.tuya.description}. Mesures prioritaires : W, kWh, tension, piles,
                IP/MAC.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500">
              {tuyaVendor?.lastSyncedAt
                ? `Synchro : ${new Date(tuyaVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                : 'Aucune synchronisation manuelle récente'}
            </span>
            <button
              type="button"
              onClick={handleSyncTuya}
              disabled={syncingTuya}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingTuya ? 'animate-spin' : ''}`} />
              {syncingTuya ? 'Synchronisation...' : 'Synchroniser Tuya'}
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
                    {kasaVendor?.devicesCount ?? systemCounts.kasa} appareil(s)
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      data.env.kasaConfigured || data.env.mode === 'demo'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.env.mode === 'demo'
                      ? 'Mode Démo'
                      : data.env.kasaConfigured
                        ? `Connecté (${data.env.kasaRegion.toUpperCase()})`
                        : 'Non configuré'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.kasa.description}. Relevés W, tension et kWh en lecture seule sans
                  accès LAN.
                </p>
                {kasaVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1.5">{kasaVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {kasaVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(kasaVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : data.env.mode === 'live' && !data.env.kasaConfigured
                    ? 'Ajoutez KASA_EMAIL & KASA_PASSWORD (voir Guide Setup)'
                    : '100 % cloud · zéro commande envoyée'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenKasaGuide && (
                  <button
                    type="button"
                    onClick={onOpenKasaGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le guide de configuration TP-Link Kasa Cloud"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-teal-400" />
                    Déroulé setup
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSyncKasa}
                  disabled={syncingKasa}
                  className="flex items-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingKasa ? 'animate-spin' : ''}`} />
                  {syncingKasa ? 'Synchronisation...' : 'Synchroniser Kasa'}
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
                      {hcVendor?.devicesCount ?? systemCounts.home_connect} appareil(s)
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isHcConnected || data.env.mode === 'demo'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {data.env.mode === 'demo'
                        ? 'Mode Démo'
                        : isHcConnected
                          ? `Connecté (${hcModeEnvLabel})`
                          : 'Prêt (OAuth requis)'}
                    </span>
                  </div>

                  {!isHcConnected && data.env.mode === 'live' && (
                    <select
                      value={selectedHomeConnectEnv}
                      onChange={(e) => setSelectedHomeConnectEnv(e.target.value as HomeConnectEnv)}
                      aria-label="Environnement Siemens Home Connect"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="prod">Production (api.home-connect.com)</option>
                      <option value="simulator">Simulateur (simulator.home-connect.com)</option>
                      <option value="cn">Chine (.cn)</option>
                    </select>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.home_connect.description}. Lecture seule · programme, temps
                  restant, porte &amp; températures internes.
                </p>

                {hcVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1.5">{hcVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {hcVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(hcVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : '100 % lecture seule · sans Control'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenHomeConnectGuide && (
                  <button
                    type="button"
                    onClick={onOpenHomeConnectGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le guide de configuration Siemens Home Connect"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
                    Déroulé setup
                  </button>
                )}

                {data.env.mode === 'live' && !isHcConnected ? (
                  <a
                    href={`/api/vendors/home-connect/oauth/start?env=${selectedHomeConnectEnv}&returnTab=systems`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connecter Home Connect ({selectedHomeConnectEnv.toUpperCase()})
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
                      {syncingHomeConnect ? 'Synchronisation...' : 'Synchroniser Home Connect'}
                    </button>
                    {data.env.mode === 'live' && isHcConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectHomeConnect}
                        disabled={disconnectingHomeConnect || syncingHomeConnect}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        Déconnecter
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
                    {somfyVendor?.devicesCount ?? systemCounts.somfy} appareil(s)
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      data.env.somfyConfigured || data.env.mode === 'demo'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {data.env.mode === 'demo'
                      ? 'Mode Démo'
                      : data.env.somfyConfigured
                        ? `Prêt (${data.env.somfyRegion.toUpperCase()})`
                        : 'Non configuré'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Kit de connectivité Overkiz Cloud (volets io/RTS, stores, capteurs · 100 %
                  lecture seule, session chiffrée).
                </p>
                {somfyVendor?.lastError && (
                  <p className="text-[11px] text-amber-300 mt-1">{somfyVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {somfyVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(somfyVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : '100 % cloud · zéro commande envoyée'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {onOpenSomfyGuide && (
                  <button
                    type="button"
                    onClick={onOpenSomfyGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le guide de configuration Somfy Kit de connectivité"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-amber-400" />
                    Déroulé setup
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSyncSomfy}
                  disabled={syncingSomfy}
                  className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSomfy ? 'animate-spin' : ''}`} />
                  {syncingSomfy ? 'Synchronisation...' : 'Synchroniser Somfy'}
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
                  {daikinVendor?.devicesCount ?? systemCounts.daikin} appareil(s)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    isDkConnected || data.env.mode === 'demo'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {data.env.mode === 'demo'
                    ? 'Mode Démo'
                    : isDkConnected
                      ? 'Connecté (OAuth)'
                      : 'Prêt (OAuth requis)'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {VENDOR_REGISTRY.daikin.description}. Quota 200 req/jour respecté (1 appel /
                collecte).
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
                      ? 'Masquer la validation manuelle (localhost)'
                      : 'Tester en local (http://localhost) : coller l’URL ou le code OAuth'}
                  </button>
                  {showDaikinLocalBox && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
                      <input
                        type="text"
                        value={daikinExchangeInput}
                        onChange={(e) => setDaikinExchangeInput(e.target.value)}
                        placeholder="Collez l'URL complète de retour (?code=...) ou le code"
                        className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={exchangingDaikin || !daikinExchangeInput.trim()}
                        onClick={() => void handleExchangeDaikinCode()}
                        className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                      >
                        {exchangingDaikin ? 'Validation...' : 'Valider'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {daikinVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(daikinVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : '100 % lecture seule · 1 requête/cycle'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenDaikinGuide && (
                  <button
                    type="button"
                    onClick={onOpenDaikinGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le déroulé pas-à-pas Daikin Onecta"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-blue-400" />
                    Déroulé setup
                  </button>
                )}

                {data.env.mode === 'live' && !isDkConnected ? (
                  <a
                    href="/api/vendors/daikin/oauth/start?returnTab=systems"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connecter Daikin (OAuth)
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
                      {syncingDaikin ? 'Synchronisation...' : 'Synchroniser Daikin'}
                    </button>
                    {data.env.mode === 'live' && isDkConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectDaikin}
                        disabled={disconnectingDaikin || syncingDaikin}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        Déconnecter
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
                  {xsenseVendor?.devicesCount ?? systemCounts.xsense} appareil(s)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    data.env.mode === 'demo' || xsenseVendor?.connected || data.env.xsenseConfigured
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {data.env.mode === 'demo'
                    ? 'Mode Démo'
                    : xsenseVendor?.connected || data.env.xsenseConfigured
                      ? 'Cloud actif'
                      : 'Non configuré'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Détecteurs fumée/CO, capteurs fuite d&apos;eau, stations SBS50 &amp; thermo-hygromètres
                X-Sense (100 % lecture seule · compte invité conseillé).
              </p>
              {xsenseVendor?.lastError && (
                <p className="text-[11px] text-amber-300 mt-1">{xsenseVendor.lastError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {xsenseVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(xsenseVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : '100 % lecture seule'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenXSenseGuide && (
                  <button
                    type="button"
                    onClick={onOpenXSenseGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-rose-400" />
                    Déroulé setup
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSyncXSense()}
                  disabled={syncingXSense}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingXSense ? 'animate-spin' : ''}`} />
                  {syncingXSense ? 'Synchronisation...' : 'Synchroniser X-Sense'}
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
                  {xiaomiVendor?.devicesCount ?? systemCounts.xiaomi} appareil(s)
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    data.env.mode === 'demo' || isXiaomiConnected
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : data.env.xiaomiConfigured
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {data.env.mode === 'demo'
                    ? 'Mode Démo'
                    : isXiaomiConnected
                      ? `Connecté (${xiaomiRegion.toUpperCase()})`
                      : data.env.xiaomiConfigured
                        ? 'Connexion requise (2FA/QR)'
                        : 'QR Code ou .env'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Synchronise capteurs climat/fuite/ouverture, prises, purificateurs PM2.5 et pièces
                Xiaomi Home en 100 % lecture seule.
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
                      aria-label="Serveur Mi Cloud"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-orange-500 focus:outline-none"
                    >
                      <option value="de">Europe (de)</option>
                      <option value="cn">Chine (cn)</option>
                      <option value="us">États-Unis (us)</option>
                      <option value="sg">Singapour (sg)</option>
                      <option value="ru">Russie (ru)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleStartXiaomiQr()}
                      disabled={xiaomiStartingQr}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/15 hover:bg-orange-500/25 px-2.5 py-1 text-[11px] font-medium text-orange-200 transition"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      {xiaomiStartingQr ? 'Génération...' : 'Scanner QR Code Xiaomi'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowXiaomiAuthBox((v) => !v)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 underline underline-offset-2"
                    >
                      {showXiaomiAuthBox ? 'Masquer options' : 'Connexion compte / 2FA'}
                    </button>
                  </div>

                  {xiaomiQrData && (
                    <div className="rounded-xl border border-orange-500/30 bg-slate-950/80 p-3 flex flex-wrap items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={xiaomiQrData.qrImageUrl}
                        alt="QR Code Xiaomi Home"
                        className="h-28 w-28 rounded-lg bg-white p-1"
                      />
                      <div className="space-y-1.5 text-[11px] text-slate-300 flex-1 min-w-[180px]">
                        <p className="font-medium text-orange-200">
                          Scannez avec l&apos;application mobile Xiaomi Home
                        </p>
                        <p className="text-slate-400">
                          Dans Xiaomi Home : <strong>Profil → Scanner</strong> (en haut à droite),
                          puis confirmez la connexion. Attente automatique…
                        </p>
                        <button
                          type="button"
                          onClick={() => setXiaomiQrData(null)}
                          className="text-slate-400 hover:text-white underline"
                        >
                          Annuler le QR
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
                            placeholder="E-mail / ID Xiaomi (ou .env)"
                            className="flex-1 min-w-[150px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <input
                            type="password"
                            value={xiaomiPassword}
                            onChange={(e) => setXiaomiPassword(e.target.value)}
                            placeholder="Mot de passe (ou .env)"
                            className="flex-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <button
                            type="button"
                            disabled={xiaomiLoggingIn}
                            onClick={() => void handleXiaomiCredentialLogin()}
                            className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                          >
                            {xiaomiLoggingIn ? 'Connexion...' : 'Connecter'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={xiaomi2faCode}
                            onChange={(e) => setXiaomi2faCode(e.target.value)}
                            placeholder="Code 2FA reçu par e-mail / SMS"
                            className="flex-1 min-w-[180px] rounded-lg border border-orange-500/40 bg-slate-900 px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500"
                          />
                          <button
                            type="button"
                            disabled={xiaomiVerifying2fa || !xiaomi2faCode.trim()}
                            onClick={() => void handleXiaomiVerify2fa()}
                            className="rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-3 py-1.5 text-[11px] font-medium text-white transition"
                          >
                            {xiaomiVerifying2fa ? 'Validation...' : 'Valider 2FA'}
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
                  ? `Synchro : ${new Date(xiaomiVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : '100 % lecture seule · QR / 2FA'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenXiaomiGuide && (
                  <button
                    type="button"
                    onClick={onOpenXiaomiGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-orange-400" />
                    Déroulé setup
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
                    {syncingXiaomi ? 'Synchronisation...' : 'Synchroniser Xiaomi'}
                  </button>
                )}
                {data.env.mode === 'live' && isXiaomiConnected && (
                  <button
                    type="button"
                    onClick={() => void handleDisconnectXiaomi()}
                    disabled={disconnectingXiaomi || syncingXiaomi}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                  >
                    Déconnecter
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
                      {ghVendor?.devicesCount ?? systemCounts.google_home} appareil(s)
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isGhConnected
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {data.env.mode === 'demo'
                        ? 'Mode Démo'
                        : isGhConnected
                          ? `Connecté (${(ghVendor?.mode ?? selectedGoogleMode).toString().toUpperCase()})`
                          : data.env.googleHomeConfigured
                            ? 'Prêt (OAuth requis)'
                            : 'OAuth non configuré'}
                    </span>
                  </div>

                  {!isGhConnected && data.env.mode === 'live' && (
                    <select
                      value={selectedGoogleMode}
                      onChange={(e) => setSelectedGoogleMode(e.target.value as GoogleHomeMode)}
                      aria-label="Mode API Google Home"
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 focus:border-sky-500 focus:outline-none"
                    >
                      <option value="mcp">Mode Home MCP (tous appareils)</option>
                      <option value="sdm">Mode Nest SDM (Nest)</option>
                    </select>
                  )}
                </div>

                <p className="text-xs text-slate-400 mt-2">
                  {VENDOR_REGISTRY.google_home.description}. Fusionnez les doublons Tuya sans
                  duplication.
                </p>

                {ghVendor?.lastError && (
                  <p className="text-[11px] text-rose-300 mt-1.5">{ghVendor.lastError}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-500">
                {ghVendor?.lastSyncedAt
                  ? `Synchro : ${new Date(ghVendor.lastSyncedAt).toLocaleString('fr-FR')}`
                  : data.env.mode === 'live' && !data.env.googleHomeConfigured
                    ? 'Ajoutez GOOGLE_CLIENT_ID / SECRET (voir Guide Setup)'
                    : 'Lecture seule · zéro commande envoyée'}
              </span>

              <div className="flex flex-wrap items-center gap-2">
                {onOpenGoogleGuide && (
                  <button
                    type="button"
                    onClick={onOpenGoogleGuide}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
                    title="Afficher le déroulé opératoire pas-à-pas Google Home"
                  >
                    <BookOpen className="h-3.5 w-3.5 text-sky-400" />
                    Déroulé setup
                  </button>
                )}
                {data.env.mode === 'live' && !isGhConnected ? (
                  <a
                    href={`/api/vendors/google-home/oauth/start?mode=${selectedGoogleMode}&returnTab=systems`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-medium text-white transition"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Connecter Google Home ({selectedGoogleMode.toUpperCase()})
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
                      {syncingGoogle ? 'Synchronisation...' : 'Synchroniser Google Home'}
                    </button>
                    {data.env.mode === 'live' && isGhConnected && (
                      <button
                        type="button"
                        onClick={handleDisconnectGoogleHome}
                        disabled={disconnectingGoogle || syncingGoogle}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 px-3 py-2 text-xs text-slate-300 transition"
                      >
                        Déconnecter
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {syncMessage && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${
            syncMessage.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {syncMessage.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{syncMessage.text}</span>
        </div>
      )}

      {/* Autres systèmes disponibles (non encore configurés dans .env) */}
      {availableUnconfiguredSystems.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">Autres systèmes disponibles</h3>
              <p className="text-xs text-slate-400">
                Ces intégrations optionnelles ne sont pas encore configurées dans{' '}
                <code className="text-slate-300">.env.local</code> / variables d’environnement.
              </p>
            </div>
            <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2.5 py-0.5 text-[11px] text-slate-300">
              {availableUnconfiguredSystems.length} système(s) disponible(s)
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
                        Non configuré
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
                      Configurer (Guide Setup)
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
          Historique récent des collectes (toutes les 30 min)
        </h3>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {data.logs.map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2 text-xs"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    log.status === 'success' ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span className="font-mono text-slate-300">
                  {new Date(log.executedAt).toLocaleString('fr-FR')}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                  {log.trigger}
                </span>
              </div>
              <div className="text-slate-400">
                {log.status === 'success' ? (
                  <span>
                    {log.readingsInserted} mesures enregistrées ({log.devicesCount} appareils) ·{' '}
                    {log.durationMs ?? 0} ms
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
