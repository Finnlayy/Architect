import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  DataProviderId,
  TimeframeId,
  TradeDirectionMode,
  ExitModeId,
  StrategyDefinition,
  BacktestResult,
  ScreenerTickerRow,
  ChronicleAnomalyEvent,
  ScreenerScheduleStatus,
  OHLCVCandle,
  ProviderAttemptTrace,
} from './types/terminal';
import {
  INITIAL_CLIENT_STRATEGIES,
  loadLocalStore,
  saveLocalStore,
  fetchStrategyStore,
  persistStrategyToBackend,
  deleteStrategyFromBackend,
  executeBacktestJob,
  fetchScreenerSchedule,
  updateScreenerSchedule,
  triggerScreenerRunNow,
  triggerEmergencyFlatten,
  exportTradesToCsv,
  exportStrategyAndResultToJson,
  exportPineScriptFile,
} from './services/terminalClient';
import {
  fetchPaperBridgeStatus,
  executePaperBridgeOrder,
  paperReset,
  PaperBridgeStatus,
} from './services/krakenCliProxyRegistry';
import { useKrakenStream } from './hooks/useKrakenStream';
import { TerminalPipelineStrip } from './components/TerminalPipelineStrip';
import { TerminalWorkspaceChart } from './components/TerminalWorkspaceChart';
import { TerminalDiagnosticsDrawer } from './components/TerminalDiagnosticsDrawer';
import { DriveBlueprintModal } from './components/DriveBlueprintModal';
import { initAuth, googleSignIn, logout, getAccessToken } from './services/firebase';
import { searchDriveFiles, fetchFileContent } from './services/googleDrive';
import { User } from 'firebase/auth';
import { DriveBlueprintItem } from './types/trading';
import {
  Play,
  Square,
  Save,
  Plus,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Terminal,
  Sliders,
  Code2,
  HardDrive,
  Search,
  Zap,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  RotateCcw,
} from 'lucide-react';

const PROVIDER_BADGE_STYLES: Record<DataProviderId, string> = {
  KRAKEN: 'text-[#00E5FF] border-[#00E5FF]/40 bg-[#00E5FF]/10',
  CCXT: 'text-[#10B981] border-[#10B981]/40 bg-[#10B981]/10',
  GAINIUM: 'text-[#A855F7] border-[#A855F7]/40 bg-[#A855F7]/10',
  BINANCE: 'text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10',
  ALPACA: 'text-[#3B82F6] border-[#3B82F6]/40 bg-[#3B82F6]/10',
  ALPHAVANTAGE: 'text-[#EC4899] border-[#EC4899]/40 bg-[#EC4899]/10',
};

const TIMEFRAMES: TimeframeId[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

type BottomDockTab = 'TRADES' | 'METRICS' | 'EXECUTION' | 'PINE';
type LeftPaneMode = 'CONFIG' | 'SCREENER';

export function App() {
  // 1. Persistent Store Initialization
  const initialLocal = useMemo(() => loadLocalStore(), []);
  const [strategies, setStrategies] = useState<StrategyDefinition[]>(
    initialLocal?.strategies?.length ? initialLocal.strategies : INITIAL_CLIENT_STRATEGIES
  );
  const [activeStrategy, setActiveStrategy] = useState<StrategyDefinition>(() => {
    if (initialLocal?.strategies?.length) {
      const found = initialLocal.strategies.find((s) => s.id === initialLocal.activeStrategyId);
      return found || initialLocal.strategies[0];
    }
    return INITIAL_CLIENT_STRATEGIES[0];
  });

  // 2. Backtest & Market Data State
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    initialLocal?.lastResults?.[activeStrategy.id] || null
  );
  const [candles, setCandles] = useState<OHLCVCandle[]>(
    initialLocal?.lastResults?.[activeStrategy.id]?.candles || []
  );
  const [activeProvider, setActiveProvider] = useState<DataProviderId>(
    initialLocal?.lastResults?.[activeStrategy.id]?.activeProvider || 'KRAKEN'
  );
  const [cascadeTrace, setCascadeTrace] = useState<ProviderAttemptTrace[]>(
    initialLocal?.lastResults?.[activeStrategy.id]?.cascadeTrace || []
  );
  const [lastDataTimestamp, setLastDataTimestamp] = useState<number>(
    initialLocal?.lastResults?.[activeStrategy.id]?.executedAt || Date.now()
  );

  // 3. Job Lifecycle, Validation & Error State
  const [isJobRunning, setIsJobRunning] = useState<boolean>(false);
  const [jobStageLabel, setJobStageLabel] = useState<string>('BEREIT');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 4. Screener & Chronicle State (6 Providers)
  const [screenerStatus, setScreenerStatus] = useState<ScreenerScheduleStatus | null>(null);
  const [screenerFilter, setScreenerFilter] = useState<'ALL' | 'ANOMALIES' | DataProviderId>('ALL');
  const [screenerSearch, setScreenerSearch] = useState<string>('');
  const [isScreenerRefreshing, setIsScreenerRefreshing] = useState<boolean>(false);

  // 5. Kraken Paper Bridge ($1,000.00 Account) & Live WebSocket Stream
  const [paperBridge, setPaperBridge] = useState<PaperBridgeStatus | null>(null);
  const [executionEnvironment, setExecutionEnvironment] = useState<'PAPER' | 'LIVE_ARMED'>('PAPER');
  const [liveConfirmStep, setLiveConfirmStep] = useState<boolean>(false);
  const [orderSizeUsd, setOrderSizeUsd] = useState<number>(50);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);

  const { markets: wsMarkets, streamStatus } = useKrakenStream();
  const wsConnected = streamStatus === 'LIVE';

  // 6. UI Workspace Navigation State
  const [leftPaneMode, setLeftPaneMode] = useState<LeftPaneMode>('CONFIG');
  const [showAdvancedParams, setShowAdvancedParams] = useState<boolean>(false);
  const [bottomTab, setBottomTab] = useState<BottomDockTab>('TRADES');
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<'ALL' | 'LONG' | 'SHORT' | 'WIN' | 'LOSS'>('ALL');
  const [editablePineScript, setEditablePineScript] = useState<string>(
    initialLocal?.lastResults?.[activeStrategy.id]?.pineScriptV6 || ''
  );
  const [pineCopied, setPineCopied] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveBlueprintItem[]>([]);
  const [isDriveLoading, setIsDriveLoading] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [systemLogs, setSystemLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString('de-DE')}] OMEGA NIO Terminal initialisiert · Paper Account Basis: $1,000.00 · Max Concurrent Trades Cap: 20`,
  ]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('de-DE');
    setSystemLogs((prev) => [`[${ts}] ${msg}`, ...prev.slice(0, 79)]);
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      (u) => setDriveUser(u),
      () => {
        setDriveUser(null);
        setDriveFiles([]);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleDriveSignIn = async () => {
    setDriveError(null);
    setIsDriveLoading(true);
    try {
      const { user, accessToken } = await googleSignIn();
      setDriveUser(user);
      const files = await searchDriveFiles(accessToken, 'OMEGA');
      setDriveFiles(files);
      appendLog(`Google Drive verbunden (${user.email}): ${files.length} Blueprints gefunden.`);
    } catch (err: any) {
      setDriveError(err.message || 'Google Drive Anmeldung fehlgeschlagen.');
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleDriveSignOut = async () => {
    await logout();
    setDriveUser(null);
    setDriveFiles([]);
  };

  const handleDriveSearch = async (query: string) => {
    setDriveError(null);
    setIsDriveLoading(true);
    try {
      let token = getAccessToken();
      if (!token) {
        const res = await googleSignIn();
        token = res.accessToken;
        setDriveUser(res.user);
      }
      const files = await searchDriveFiles(token, query);
      setDriveFiles(files);
    } catch (err: any) {
      setDriveError(err.message || 'Google Drive Suche fehlgeschlagen.');
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleDriveSelectFile = async (file: DriveBlueprintItem) => {
    setDriveError(null);
    setIsDriveLoading(true);
    try {
      const token = getAccessToken();
      if (!token) throw new Error('Bitte erneut mit Google Drive verbinden.');
      const content = await fetchFileContent(token, file.id, file.mimeType);
      const newStrat: StrategyDefinition = {
        ...activeStrategy,
        id: `drive-${file.id.slice(0, 8)}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        idea: content.slice(0, 180).replace(/\s+/g, ' ').trim() || `Drive Blueprint: ${file.name}`,
        initialCapital: 1000,
        maxConcurrentTrades: 20,
        updatedAt: Date.now(),
      };
      setStrategies((prev) => [newStrat, ...prev.filter((s) => s.id !== newStrat.id)]);
      setActiveStrategy(newStrat);
      setIsDriveModalOpen(false);
      setStatusNotice(`Google Drive Blueprint "${file.name}" als Strategie geladen.`);
      appendLog(`Google Drive Blueprint "${file.name}" importiert.`);
      await handleRunBacktest(newStrat);
    } catch (err: any) {
      setDriveError(err.message || 'Datei konnte nicht geladen werden.');
    } finally {
      setIsDriveLoading(false);
    }
  };

  // Persist to LocalStorage whenever strategies or backtestResult change
  useEffect(() => {
    const existing = loadLocalStore();
    const map = existing?.lastResults || {};
    if (backtestResult) {
      map[activeStrategy.id] = backtestResult;
    }
    saveLocalStore({
      activeStrategyId: activeStrategy.id,
      strategies,
      lastResults: map,
    });
  }, [activeStrategy.id, strategies, backtestResult]);

  // Initial Load: Fetch strategies, scheduled screener, paper bridge ($1,000), and run initial backtest
  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      try {
        const [storeData, screenerData, bridgeData] = await Promise.all([
          fetchStrategyStore().catch(() => null),
          fetchScreenerSchedule().catch(() => null),
          fetchPaperBridgeStatus().catch(() => null),
        ]);
        if (!mounted) return;

        if (bridgeData) {
          setPaperBridge(bridgeData);
        }
        if (screenerData) {
          setScreenerStatus(screenerData);
        }
        if (storeData && storeData.strategies?.length) {
          setStrategies(storeData.strategies);
          const target =
            storeData.strategies.find((s) => s.id === storeData.activeStrategyId) ||
            storeData.strategies[0];
          setActiveStrategy(target);
        }
      } catch (err: any) {
        appendLog(`Bootstrap-Hinweis: ${err.message}`);
      }
    }
    bootstrap();
    handleRunBacktest(activeStrategy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic polling of the Automated Scheduled Screener & Paper Account Ledger
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const [screenerData, bridgeData] = await Promise.all([
          fetchScreenerSchedule().catch(() => null),
          fetchPaperBridgeStatus().catch(() => null),
        ]);
        if (screenerData) {
          setScreenerStatus(screenerData);
        }
        if (bridgeData) {
          setPaperBridge(bridgeData);
        }
      } catch {
        // Silent background refresh
      }
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  // Input Validation for Strategy Parameters
  const validateStrategyInput = (strat: StrategyDefinition): string | null => {
    if (!strat.symbol || strat.symbol.trim().length < 2) {
      return 'Bitte ein gültiges Handelssymbol eingeben (z. B. BTC/USD, PEPEUSDT.P, NVDA, EUR/USD).';
    }
    if (isNaN(strat.initialCapital) || strat.initialCapital < 10 || strat.initialCapital > 10000000) {
      return 'Startkapital muss zwischen $10.00 und $10,000,000.00 liegen (Standard Paper-Konto: $1,000.00).';
    }
    if (isNaN(strat.riskPerTradePct) || strat.riskPerTradePct <= 0 || strat.riskPerTradePct > 25) {
      return 'Risiko pro Trade muss zwischen 0.1% und 25.0% liegen.';
    }
    if (
      isNaN(strat.maxConcurrentTrades) ||
      strat.maxConcurrentTrades < 1 ||
      strat.maxConcurrentTrades > 20
    ) {
      return 'Max. gleichzeitige Trades darf das Hard-Limit von 20 Trades nicht überschreiten (1 bis 20).';
    }
    if (isNaN(strat.slAtrMult) || strat.slAtrMult <= 0.1 || strat.slAtrMult > 20) {
      return 'Stop-Loss ATR-Multiplikator muss zwischen 0.1 und 20.0 liegen.';
    }
    if (isNaN(strat.feePct) || strat.feePct < 0 || strat.feePct > 5) {
      return 'Handelsgebühr muss zwischen 0.00% und 5.00% liegen.';
    }
    return null;
  };

  // Run Backtest (with Double-Start Lock & AbortController Cancel)
  const handleRunBacktest = async (strategyOverride?: StrategyDefinition) => {
    if (isJobRunning) return;
    const targetStrat = strategyOverride || activeStrategy;

    const validationMsg = validateStrategyInput(targetStrat);
    if (validationMsg) {
      setValidationError(validationMsg);
      setErrorBanner(validationMsg);
      appendLog(`Validierungsfehler: ${validationMsg}`);
      return;
    }

    setValidationError(null);
    setErrorBanner(null);
    setIsJobRunning(true);
    setJobStageLabel(`KASKADEN-ABRUF ${targetStrat.symbol} (${targetStrat.timeframe})...`);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      appendLog(
        `Starte Backtest "${targetStrat.name}" auf ${targetStrat.symbol} (${targetStrat.timeframe}) · Kapital: $${targetStrat.initialCapital.toFixed(2)} · Max Trades: ${targetStrat.maxConcurrentTrades}/20`
      );
      const result = await executeBacktestJob(targetStrat, controller.signal);

      setBacktestResult(result);
      setCandles(result.candles);
      setActiveProvider(result.activeProvider);
      setCascadeTrace(result.cascadeTrace);
      setLastDataTimestamp(result.executedAt);
      setEditablePineScript(result.pineScriptV6);
      setSelectedTradeId(null);

      setStrategies((prev) => {
        const exists = prev.some((s) => s.id === targetStrat.id);
        return exists
          ? prev.map((s) => (s.id === targetStrat.id ? targetStrat : s))
          : [targetStrat, ...prev];
      });

      appendLog(
        `Backtest abgeschlossen [${result.activeProvider}]: ${result.metrics.totalTrades} Trades · Net PnL: $${result.metrics.netProfitUsd.toFixed(2)} (${result.metrics.netReturnPct.toFixed(2)}%) · Gefiltert (Max 20 Cap): ${result.metrics.filteredByMax20Cap}`
      );
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setStatusNotice('Laufender Backtest-Job wurde vom Benutzer abgebrochen.');
        appendLog('Job durch Benutzer abgebrochen (AbortController).');
      } else {
        const msg = err.message || 'Unbekannter Fehler bei Backtest-Ausführung.';
        setErrorBanner(msg);
        appendLog(`FEHLER: ${msg}`);
      }
    } finally {
      setIsJobRunning(false);
      setJobStageLabel('BEREIT');
      abortControllerRef.current = null;
    }
  };

  // Cancel Running Job
  const handleCancelJob = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Dynamic Symbol or Timeframe Change
  const handleSymbolOrTimeframeChange = async (newSymbol: string, newTimeframe: TimeframeId) => {
    const updated: StrategyDefinition = {
      ...activeStrategy,
      symbol: newSymbol.toUpperCase().trim(),
      timeframe: newTimeframe,
      updatedAt: Date.now(),
    };
    setActiveStrategy(updated);
    await handleRunBacktest(updated);
  };

  // Save Strategy Persistently (Server + LocalStorage)
  const handleSaveStrategy = async () => {
    const validationMsg = validateStrategyInput(activeStrategy);
    if (validationMsg) {
      setValidationError(validationMsg);
      return;
    }
    setValidationError(null);
    const updated = { ...activeStrategy, updatedAt: Date.now() };
    setActiveStrategy(updated);

    try {
      const nextStore = await persistStrategyToBackend(updated, backtestResult || undefined);
      setStrategies(nextStore.strategies);
      setStatusNotice(`Strategie "${updated.name}" persistent gespeichert.`);
      appendLog(`Strategie "${updated.name}" im Backend & LocalStorage gespeichert.`);
      setTimeout(() => setStatusNotice(null), 3500);
    } catch (err: any) {
      setStatusNotice(`Lokal gespeichert (Server-Sync Hinweis: ${err.message})`);
      setTimeout(() => setStatusNotice(null), 3500);
    }
  };

  // Create New Strategy
  const handleCreateNewStrategy = () => {
    const newId = `strat_${Date.now().toString(36)}`;
    const fresh: StrategyDefinition = {
      ...activeStrategy,
      id: newId,
      name: `Quant Strategie ${strategies.length + 1}`,
      templateType: 'CUSTOM',
      initialCapital: 1000,
      maxConcurrentTrades: 20,
      updatedAt: Date.now(),
    };
    setStrategies((prev) => [fresh, ...prev]);
    setActiveStrategy(fresh);
    setStatusNotice(`Neue Strategie "${fresh.name}" ($1,000 Basis, Max 20 Trades) angelegt.`);
    setTimeout(() => setStatusNotice(null), 3500);
  };

  // Delete Active Strategy
  const handleDeleteStrategy = async () => {
    if (strategies.length <= 1) return;
    const idToDelete = activeStrategy.id;
    const nextStore = await deleteStrategyFromBackend(idToDelete);
    setStrategies(nextStore.strategies);
    setActiveStrategy(nextStore.strategies[0]);
    appendLog(`Strategie "${activeStrategy.name}" gelöscht.`);
    await handleRunBacktest(nextStore.strategies[0]);
  };

  // Import Strategy JSON File
  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}'));
        const importedStrat: StrategyDefinition = parsed.strategy || parsed;
        if (!importedStrat.symbol || !importedStrat.name) {
          throw new Error('Ungültiges Strategie-JSON: Felder "name" und "symbol" fehlen.');
        }
        const normalized: StrategyDefinition = {
          ...INITIAL_CLIENT_STRATEGIES[0],
          ...importedStrat,
          id: importedStrat.id || `imp_${Date.now().toString(36)}`,
          initialCapital: Number(importedStrat.initialCapital) || 1000,
          maxConcurrentTrades: Math.min(20, Number(importedStrat.maxConcurrentTrades) || 20),
          advanced: {
            ...INITIAL_CLIENT_STRATEGIES[0].advanced,
            ...(importedStrat.advanced || {}),
          },
          updatedAt: Date.now(),
        };
        const nextStore = await persistStrategyToBackend(normalized);
        setStrategies(nextStore.strategies);
        setActiveStrategy(normalized);
        setStatusNotice(`Strategie "${normalized.name}" erfolgreich importiert.`);
        await handleRunBacktest(normalized);
      } catch (err: any) {
        setErrorBanner(`JSON-Import fehlgeschlagen: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Screener Manual Scan & Schedule Toggle
  const handleManualScreenerRefresh = async () => {
    if (isScreenerRefreshing) return;
    setIsScreenerRefreshing(true);
    try {
      const status = await triggerScreenerRunNow();
      setScreenerStatus(status);
      appendLog(
        `Multi-Source Screener aktualisiert: ${status.tickers.length} Symbole über 6 Quellen gescannt.`
      );
    } catch (err: any) {
      setErrorBanner(`Screener-Scan Fehler: ${err.message}`);
    } finally {
      setIsScreenerRefreshing(false);
    }
  };

  const handleConfigureScreenerSchedule = async (enabled: boolean, intervalSec: number) => {
    try {
      const status = await updateScreenerSchedule({ enabled, intervalSec });
      setScreenerStatus(status);
      appendLog(`Screener-Schedule geändert: ${enabled ? `AKTIV (${intervalSec}s)` : 'PAUSIERT'}`);
    } catch (err: any) {
      setErrorBanner(`Schedule-Konfiguration fehlgeschlagen: ${err.message}`);
    }
  };

  // Paper Account Order Execution (Enforces Max 20 Concurrent Trades & $1,000.00 Ledger)
  const handleExecutePaperOrder = async (side: 'buy' | 'sell') => {
    if (isSubmittingOrder) return;
    const openPositionsCount = paperBridge?.paperLedger?.positions?.length || 0;
    if (side === 'buy' && openPositionsCount >= 20) {
      setErrorBanner(
        'M2 HARD-CAP BLOCKADE: Maximal 20 gleichzeitige Trades erlaubt (20/20 aktiv). Bitte zuerst Positionen schließen.'
      );
      return;
    }
    setIsSubmittingOrder(true);
    setErrorBanner(null);
    try {
      const lastCandlePrice = candles[candles.length - 1]?.close || 100;
      const res = await executePaperBridgeOrder({
        signalId: `TERM-${Date.now().toString(36).toUpperCase()}`,
        symbol: activeStrategy.symbol,
        side,
        sizeUsd: Math.max(10, orderSizeUsd),
        price: lastCandlePrice,
        executionRoute: 'TERMINAL_MANUAL_TICKET',
        strategyId: activeStrategy.id,
        strategyName: activeStrategy.name,
      });
      const updatedBridge = await fetchPaperBridgeStatus().catch(() => null);
      if (updatedBridge) setPaperBridge(updatedBridge);
      setStatusNotice(
        `Paper ${side.toUpperCase()} ausgeführt: ${res.volume} ${res.symbol} @ $${res.price.toFixed(2)} (${res.txid})`
      );
      appendLog(res.journalText);
      setTimeout(() => setStatusNotice(null), 4000);
    } catch (err: any) {
      setErrorBanner(`Order-Ausführung abgelehnt: ${err.message}`);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Emergency Kill Switch (Flatten All Open Trades & Bots)
  const handleEmergencyFlattenAll = async () => {
    try {
      const res = await triggerEmergencyFlatten();
      const updatedBridge = await fetchPaperBridgeStatus().catch(() => null);
      if (updatedBridge) setPaperBridge(updatedBridge);
      setStatusNotice(res.message || 'Alle Positionen glattgestellt (Kill Switch ausgeführt).');
      appendLog(`EMERGENCY KILL SWITCH: ${res.message || 'Flatten All ausgeführt'}`);
      setTimeout(() => setStatusNotice(null), 4500);
    } catch (err: any) {
      setErrorBanner(`Kill-Switch Fehler: ${err.message}`);
    }
  };

  // Reset Paper Account to $1,000.00
  const handleResetPaperTo1000 = async () => {
    try {
      await paperReset(1000);
      const updatedBridge = await fetchPaperBridgeStatus().catch(() => null);
      if (updatedBridge) setPaperBridge(updatedBridge);
      setStatusNotice('Paper-Konto auf $1,000.00 Startkapital zurückgesetzt.');
      appendLog('Paper-Konto via CLI auf $1,000.00 zurückgesetzt.');
      setTimeout(() => setStatusNotice(null), 3500);
    } catch (err: any) {
      setErrorBanner(`Paper-Reset Fehler: ${err.message}`);
    }
  };

  // Derived Telemetry & Screener Rows
  const filteredScreenerRows = useMemo(() => {
    const rows = screenerStatus?.tickers || [];
    return rows.filter((r) => {
      if (screenerFilter === 'ANOMALIES' && r.signalTag === 'NORMAL') return false;
      if (
        screenerFilter !== 'ALL' &&
        screenerFilter !== 'ANOMALIES' &&
        r.provider !== screenerFilter
      ) {
        return false;
      }
      if (
        screenerSearch.trim() &&
        !r.symbol.toLowerCase().includes(screenerSearch.toLowerCase()) &&
        !r.name.toLowerCase().includes(screenerSearch.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [screenerStatus, screenerFilter, screenerSearch]);

  const activeTickerDossier: ScreenerTickerRow | null = useMemo(() => {
    const rows = screenerStatus?.tickers || [];
    return (
      rows.find((r) => r.symbol.toUpperCase() === activeStrategy.symbol.toUpperCase()) || null
    );
  }, [screenerStatus, activeStrategy.symbol]);

  const filteredTrades = useMemo(() => {
    const list = backtestResult?.trades || [];
    return list.filter((t) => {
      if (tradeFilter === 'LONG') return t.side === 'LONG';
      if (tradeFilter === 'SHORT') return t.side === 'SHORT';
      if (tradeFilter === 'WIN') return t.netPnlUsd >= 0;
      if (tradeFilter === 'LOSS') return t.netPnlUsd < 0;
      return true;
    });
  }, [backtestResult, tradeFilter]);

  // Live L2 Orderbook & Beam of Absorption Calculation (Right Pane)
  const orderbookDepth = useMemo(() => {
    const wsBook = wsMarkets[activeStrategy.symbol];
    const lastPrice = candles[candles.length - 1]?.close || activeTickerDossier?.price || 100;
    const step = lastPrice * 0.0005;

    const bids: Array<{ price: number; size: number; total: number }> = [];
    const asks: Array<{ price: number; size: number; total: number }> = [];

    if (wsBook && wsBook.bids?.length && wsBook.asks?.length) {
      let bCum = 0;
      wsBook.bids.slice(0, 7).forEach((b) => {
        bCum += b.size;
        bids.push({ price: b.price, size: b.size, total: bCum });
      });
      let aCum = 0;
      wsBook.asks.slice(0, 7).forEach((a) => {
        aCum += a.size;
        asks.push({ price: a.price, size: a.size, total: aCum });
      });
    } else {
      const baseVol = (candles[candles.length - 1]?.volume || 1000) / 80;
      let bCum = 0;
      let aCum = 0;
      for (let i = 1; i <= 7; i++) {
        const bSize = Number((baseVol * (0.7 + ((i * 3) % 5) * 0.25)).toFixed(3));
        const aSize = Number((baseVol * (0.65 + ((i * 7) % 5) * 0.22)).toFixed(3));
        bCum += bSize;
        aCum += aSize;
        bids.push({
          price: Number((lastPrice - step * i).toFixed(lastPrice < 1 ? 5 : 2)),
          size: bSize,
          total: Number(bCum.toFixed(3)),
        });
        asks.push({
          price: Number((lastPrice + step * i).toFixed(lastPrice < 1 ? 5 : 2)),
          size: aSize,
          total: Number(aCum.toFixed(3)),
        });
      }
    }

    const totalBidVol = bids[bids.length - 1]?.total || 1;
    const totalAskVol = asks[asks.length - 1]?.total || 1;
    const bidAbsorptionPct = Math.round((totalBidVol / (totalBidVol + totalAskVol)) * 100);
    return {
      bids,
      asks,
      totalBidVol,
      totalAskVol,
      bidAbsorptionPct,
      askAbsorptionPct: 100 - bidAbsorptionPct,
    };
  }, [wsMarkets, activeStrategy.symbol, candles, activeTickerDossier]);

  const paperNav = paperBridge?.paperLedger?.current_value ?? 1000.0;
  const paperCash = paperBridge?.paperLedger?.cash ?? 1000.0;
  const paperOpenPositions = paperBridge?.paperLedger?.positions || [];
  const backtestActivePeak = backtestResult?.metrics.peakConcurrentTrades ?? 0;
  const currentConcurrentCount = paperOpenPositions.length;

  const formatPrice = (val: number) => {
    if (val < 0.01) return val.toFixed(6);
    if (val < 1) return val.toFixed(4);
    if (val < 100) return val.toFixed(3);
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#07090E] text-[#E6EDF3] flex flex-col select-none">
      {/* ===================================================================
          A. TOP COMMAND, TELEMETRY & HARD-LIMIT BAR (44px)
         =================================================================== */}
      <header className="h-11 bg-[#0C1017] border-b border-[#1B2230] px-2.5 flex items-center justify-between gap-2 shrink-0">
        {/* Left: Brand, Symbol Quick-Select, Timeframe Pills, Active 6-Stage Provider Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 pr-2 border-r border-[#1B2230]">
            <div className="w-2 h-2 bg-[#00E5FF]" />
            <span className="text-xs font-bold tracking-wider text-[#E6EDF3]">OMEGA NIO</span>
            <span className="text-[9px] font-mono px-1 py-0.2 bg-[#131924] border border-[#263042] text-[#00E5FF]">
              QUANT v5.2
            </span>
          </div>

          {/* Quick Symbol Selector */}
          <select
            aria-label="Symbol Schnellauswahl"
            value={activeStrategy.symbol}
            onChange={(e) => handleSymbolOrTimeframeChange(e.target.value, activeStrategy.timeframe)}
            disabled={isJobRunning}
            className="bg-[#07090E] border border-[#1B2230] text-[#E6EDF3] text-xs font-mono font-semibold px-2 py-1 focus:outline-none focus:border-[#00E5FF]"
          >
            {(screenerStatus?.tickers || []).map((t) => (
              <option key={t.symbol} value={t.symbol}>
                {t.symbol} [{t.provider}]
              </option>
            ))}
            {!(screenerStatus?.tickers || []).some(
              (t) => t.symbol.toUpperCase() === activeStrategy.symbol.toUpperCase()
            ) && <option value={activeStrategy.symbol}>{activeStrategy.symbol}</option>}
          </select>

          {/* Timeframe Bar */}
          <div className="flex items-center bg-[#07090E] border border-[#1B2230] p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                disabled={isJobRunning}
                onClick={() => handleSymbolOrTimeframeChange(activeStrategy.symbol, tf)}
                className={`px-1.5 py-0.5 text-[10px] font-mono tabular-nums transition-colors ${
                  activeStrategy.timeframe === tf
                    ? 'bg-[#00E5FF]/20 text-[#00E5FF] font-bold'
                    : 'text-[#8B95A5] hover:text-[#E6EDF3]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Active Data Source Badge from 6-Provider Cascade + Timestamp */}
          <button
            type="button"
            onClick={() => setIsDiagnosticsOpen(true)}
            title="Klicken für 6-Stufen Marktdaten-Kaskade (Kraken → CCXT → Gainium → Binance → Alpaca → Alpha Vantage)"
            className={`flex items-center gap-1.5 px-2 py-0.5 border text-[10px] font-mono tabular-nums ${
              PROVIDER_BADGE_STYLES[activeProvider] || PROVIDER_BADGE_STYLES.KRAKEN
            }`}
          >
            <span className="font-bold">QUELLE: {activeProvider}</span>
            <span className="text-[#8B95A5]">|</span>
            <span>
              {new Date(lastDataTimestamp).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </button>
        </div>

        {/* Center: Grok-Style Rolling Paper Equity ($1,000 Basis), Win/Loss & Concurrent Trades Cap (X / 20) */}
        <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
          <div className="flex items-center gap-1.5 bg-[#07090E] border border-[#1B2230] px-2.5 py-1">
            <span className="text-[10px] text-[#8B95A5] uppercase">PAPER KONTO:</span>
            <span className="font-bold text-[#089981]">
              ${paperNav.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-[#566173]">(Start: $1,000)</span>
          </div>

          {backtestResult && (
            <div className="hidden xl:flex items-center gap-1.5 bg-[#07090E] border border-[#1B2230] px-2.5 py-1">
              <span className="text-[10px] text-[#8B95A5] uppercase">BT EQUITY:</span>
              <span
                className={`font-bold ${
                  backtestResult.metrics.netProfitUsd >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                }`}
              >
                ${backtestResult.metrics.finalEquity.toFixed(2)} (
                {backtestResult.metrics.netProfitUsd >= 0 ? '+' : ''}
                {backtestResult.metrics.netReturnPct.toFixed(2)}%)
              </span>
              <span className="text-[10px] text-[#8B95A5] ml-1">
                {backtestResult.metrics.winningTrades}W / {backtestResult.metrics.losingTrades}L
              </span>
            </div>
          )}

          {/* Hard-Cap 20 Concurrent Trades Counter */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 border ${
              currentConcurrentCount >= 20
                ? 'bg-[#F23645]/15 border-[#F23645] text-[#F23645]'
                : 'bg-[#07090E] border-[#1B2230] text-[#E6EDF3]'
            }`}
            title="Hard-Limit: Maximal 20 gleichzeitige aktive Trades erlaubt"
          >
            <span className="text-[10px] text-[#8B95A5] uppercase">AKTIVE TRADES:</span>
            <span className="font-bold text-[#00E5FF]">{currentConcurrentCount} / 20</span>
            <span className="text-[9px] text-[#8B95A5]">(Peak BT: {backtestActivePeak}/20)</span>
          </div>
        </div>

        {/* Right: Job Status + Cancel Button, Environment Switch, Diagnostics & Emergency Kill Switch */}
        <div className="flex items-center gap-1.5">
          {isJobRunning ? (
            <div className="flex items-center gap-1.5 bg-[#00E5FF]/15 border border-[#00E5FF]/50 px-2 py-1 text-[10px] font-mono">
              <RefreshCw className="w-3 h-3 text-[#00E5FF] animate-spin" />
              <span className="text-[#00E5FF] font-semibold">{jobStageLabel}</span>
              <button
                type="button"
                onClick={handleCancelJob}
                className="ml-1 px-1.5 py-0.2 bg-[#F23645] text-white font-bold uppercase hover:bg-[#F23645]/80 flex items-center gap-0.5"
              >
                <Square className="w-2.5 h-2.5" />
                ABBRECHEN
              </button>
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-1 px-2 py-1 bg-[#07090E] border border-[#1B2230] text-[10px] font-mono text-[#089981]">
              <span>JOB: BEREIT</span>
            </div>
          )}

          {/* Two-Stage Environment Switch: PAPER [$1,000] vs LIVE EXECUTION */}
          {!liveConfirmStep ? (
            <button
              type="button"
              onClick={() => {
                if (executionEnvironment === 'PAPER') {
                  setLiveConfirmStep(true);
                } else {
                  setExecutionEnvironment('PAPER');
                  appendLog('Modus gewechselt auf PAPER EXECUTION ($1,000.00 Konto).');
                }
              }}
              className={`px-2 py-1 text-[10px] font-mono font-bold border uppercase ${
                executionEnvironment === 'PAPER'
                  ? 'bg-[#089981]/15 border-[#089981]/50 text-[#089981]'
                  : 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]'
              }`}
            >
              {executionEnvironment === 'PAPER' ? 'MODUS: PAPER ($1K)' : 'MODUS: LIVE ARMED'}
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-[#F59E0B]/20 border border-[#F59E0B] px-1.5 py-0.5 text-[10px] font-mono">
              <span className="text-[#F59E0B] font-bold">LIVE FREIGEBEN?</span>
              <button
                type="button"
                onClick={() => {
                  setExecutionEnvironment('LIVE_ARMED');
                  setLiveConfirmStep(false);
                  appendLog('WARNUNG: Modus auf LIVE EXECUTION geschaltet (M8 Gate aktiv).');
                }}
                className="px-1 bg-[#F23645] text-white font-bold"
              >
                JA
              </button>
              <button
                type="button"
                onClick={() => setLiveConfirmStep(false)}
                className="px-1 bg-[#1B2230] text-[#E6EDF3]"
              >
                NEIN
              </button>
            </div>
          )}

          {/* Google Drive Blueprint Sync */}
          <button
            type="button"
            onClick={() => setIsDriveModalOpen(true)}
            title="Strategie-Blueprints aus Google Drive laden"
            className="p-1.5 bg-[#07090E] border border-[#1B2230] text-[#8B95A5] hover:text-[#00E5FF] hover:border-[#00E5FF]/40"
          >
            <HardDrive className="w-3.5 h-3.5" />
          </button>

          {/* Diagnostics Drawer Trigger */}
          <button
            type="button"
            onClick={() => setIsDiagnosticsOpen(true)}
            title="System-Diagnose & 6-Provider-Kaskade öffnen"
            className="px-2 py-1 bg-[#07090E] border border-[#1B2230] text-[10px] font-mono text-[#8B95A5] hover:text-[#E6EDF3] flex items-center gap-1"
          >
            <Terminal className="w-3 h-3 text-[#00E5FF]" />
            <span>DIAGNOSE</span>
          </button>

          {/* EMERGENCY KILL SWITCH */}
          <button
            type="button"
            onClick={handleEmergencyFlattenAll}
            title="Sofort alle offenen Orders stornieren und alle 20 Positionen glattstellen"
            className="px-2.5 py-1 bg-[#F23645] hover:bg-[#F23645]/85 text-white text-[10px] font-mono font-bold tracking-wider uppercase flex items-center gap-1"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>KILL / FLATTEN</span>
          </button>
        </div>
      </header>

      {/* Error or Status Notification Strip */}
      {(errorBanner || statusNotice) && (
        <div
          className={`px-3 py-1 border-b text-xs font-mono flex items-center justify-between ${
            errorBanner
              ? 'bg-[#F23645]/15 border-[#F23645]/50 text-[#F23645]'
              : 'bg-[#089981]/15 border-[#089981]/50 text-[#089981]'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorBanner || statusNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setErrorBanner(null);
              setStatusNotice(null);
            }}
            className="text-[10px] underline uppercase ml-4"
          >
            Schließen
          </button>
        </div>
      )}

      {/* ===================================================================
          MAIN 3-COLUMN HIGH-DENSITY WORKSPACE (100% VIEWPORT)
         =================================================================== */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* -----------------------------------------------------------------
            B. LEFT WORKSPACE ZONE (335px): STRATEGY CONFIGURATOR & 6-SOURCE SCREENER
           ----------------------------------------------------------------- */}
        <aside className="w-[335px] bg-[#0C1017] border-r border-[#1B2230] flex flex-col min-h-0 shrink-0">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 border-b border-[#1B2230] bg-[#07090E]">
            <button
              type="button"
              onClick={() => setLeftPaneMode('CONFIG')}
              className={`py-2 text-[11px] font-bold tracking-wider uppercase border-b-2 flex items-center justify-center gap-1.5 ${
                leftPaneMode === 'CONFIG'
                  ? 'border-[#00E5FF] text-[#00E5FF] bg-[#0C1017]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>1. STRATEGIE & SETUP</span>
            </button>
            <button
              type="button"
              onClick={() => setLeftPaneMode('SCREENER')}
              className={`py-2 text-[11px] font-bold tracking-wider uppercase border-b-2 flex items-center justify-center gap-1.5 ${
                leftPaneMode === 'SCREENER'
                  ? 'border-[#00E5FF] text-[#00E5FF] bg-[#0C1017]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>2. SCREENER ({screenerStatus?.tickers.length || 16})</span>
            </button>
          </div>

          {/* LEFT MODE 1: STRATEGY CONFIGURATION & PARAMETER CONTROL */}
          {leftPaneMode === 'CONFIG' && (
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 text-xs">
              {/* 1. Strategy Management */}
              <div className="bg-[#07090E] border border-[#1B2230] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B95A5]">
                    STRATEGIE-VORLAGE / SPEICHER
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCreateNewStrategy}
                      title="Neue Strategie erstellen"
                      className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#00E5FF] hover:border-[#00E5FF]"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveStrategy}
                      title="Aktuelle Strategie persistent speichern"
                      className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#089981] hover:border-[#089981]"
                    >
                      <Save className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Strategie aus JSON-Datei importieren"
                      className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]"
                    >
                      <Upload className="w-3 h-3" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportJsonFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => exportStrategyAndResultToJson(activeStrategy, backtestResult)}
                      title="Strategie & Ergebnisse als JSON exportieren"
                      className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                    {strategies.length > 1 && (
                      <button
                        type="button"
                        onClick={handleDeleteStrategy}
                        title="Strategie löschen"
                        className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#F23645] hover:border-[#F23645]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Template Selector */}
                <select
                  aria-label="Gespeicherte Strategie auswählen"
                  value={activeStrategy.id}
                  onChange={(e) => {
                    const found = strategies.find((s) => s.id === e.target.value);
                    if (found) {
                      setActiveStrategy(found);
                      handleRunBacktest(found);
                    }
                  }}
                  className="w-full bg-[#0C1017] border border-[#1B2230] text-[#E6EDF3] px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-[#00E5FF]"
                >
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.symbol} · {s.timeframe})
                    </option>
                  ))}
                </select>

                {/* Strategy Name & Trading Idea */}
                <div className="space-y-1.5">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">Strategiename</label>
                    <input
                      type="text"
                      value={activeStrategy.name}
                      onChange={(e) =>
                        setActiveStrategy({ ...activeStrategy, name: e.target.value })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Handelsidee / Setup-Logik
                    </label>
                    <input
                      type="text"
                      value={activeStrategy.idea}
                      onChange={(e) =>
                        setActiveStrategy({ ...activeStrategy, idea: e.target.value })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-[11px] text-[#8B95A5] focus:text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Market, Symbol, Timeframe, Direction & Data Period */}
              <div className="bg-[#07090E] border border-[#1B2230] p-2 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#8B95A5]">
                  MARKT, SYMBOL & ZEITRAHMEN
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Symbol (6-Quellen)
                    </label>
                    <input
                      type="text"
                      value={activeStrategy.symbol}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          symbol: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="z.B. BTC/USD, PEPEUSDT.P"
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono font-bold text-[#00E5FF] focus:outline-none focus:border-[#00E5FF]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">Zeitrahmen</label>
                    <select
                      value={activeStrategy.timeframe}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          timeframe: e.target.value as TimeframeId,
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                    >
                      {TIMEFRAMES.map((tf) => (
                        <option key={tf} value={tf}>
                          {tf}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">Handelsrichtung</label>
                    <select
                      value={activeStrategy.direction}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          direction: e.target.value as TradeDirectionMode,
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono text-[#E6EDF3]"
                    >
                      <option value="BOTH">LONG & SHORT</option>
                      <option value="LONG">LONG ONLY</option>
                      <option value="SHORT">SHORT ONLY</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Datenzeitraum (Bars)
                    </label>
                    <input
                      type="number"
                      min={60}
                      max={500}
                      value={activeStrategy.lookbackBars}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          lookbackBars: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Core Parameters (Directly Visible): Capital ($1,000), Max 20 Trades, Risk, Costs, ATR & Exit Mode */}
              <div className="bg-[#07090E] border border-[#1B2230] p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B95A5]">
                    KERN-PARAMETER & RISIKO-KONTROLLE
                  </span>
                  <span className="text-[9px] font-mono text-[#089981]">CAP ≤ 20 TRADES</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Startkapital ($ USD)
                    </label>
                    <input
                      type="number"
                      step="100"
                      value={activeStrategy.initialCapital}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          initialCapital: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums font-bold text-[#089981]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Max. Trades parallel (≤20)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={activeStrategy.maxConcurrentTrades}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          maxConcurrentTrades: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums font-bold text-[#00E5FF]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Risiko / Trade (%)
                    </label>
                    <input
                      type="number"
                      step="0.25"
                      value={activeStrategy.riskPerTradePct}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          riskPerTradePct: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Stop-Loss ATR-Mult
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={activeStrategy.slAtrMult}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          slAtrMult: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Gebühren / Fee (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={activeStrategy.feePct}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          feePct: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Slippage (bps)
                    </label>
                    <input
                      type="number"
                      step="1"
                      value={activeStrategy.slippageBps}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          slippageBps: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">Exit-Modus</label>
                    <select
                      value={activeStrategy.exitMode}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          exitMode: e.target.value as ExitModeId,
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-1.5 py-1 text-[11px] font-mono text-[#E6EDF3]"
                    >
                      <option value="TP_LADDER">TP Ladder</option>
                      <option value="AUTO_TP_MFE">Auto TP [MFE-Quantil]</option>
                      <option value="FRACTAL_TP">Fraktal TP</option>
                      <option value="TRAILING_STOP">Trailing from Top</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                      Ziel Take-Profit (R)
                    </label>
                    <input
                      type="number"
                      step="0.2"
                      value={activeStrategy.tpRMultiple}
                      onChange={(e) =>
                        setActiveStrategy({
                          ...activeStrategy,
                          tpRMultiple: Number(e.target.value),
                        })
                      }
                      className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums text-[#E6EDF3]"
                    />
                  </div>
                </div>
              </div>

              {/* 4. Collapsible Section "Erweitert" */}
              <div className="bg-[#07090E] border border-[#1B2230]">
                <button
                  type="button"
                  onClick={() => setShowAdvancedParams((v) => !v)}
                  className="w-full px-2.5 py-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[#8B95A5] hover:text-[#E6EDF3]"
                >
                  <span>ERWEITERTE PARAMETER (COS-PHI, SHADOW ENGINE, EMA)</span>
                  {showAdvancedParams ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>

                {showAdvancedParams && (
                  <div className="p-2 border-t border-[#1B2230] space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Fast EMA Periode
                        </label>
                        <input
                          type="number"
                          value={activeStrategy.advanced.fastPeriod}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              advanced: {
                                ...activeStrategy.advanced,
                                fastPeriod: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Slow EMA Periode
                        </label>
                        <input
                          type="number"
                          value={activeStrategy.advanced.slowPeriod}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              advanced: {
                                ...activeStrategy.advanced,
                                slowPeriod: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Z-Score Schwelle
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          value={activeStrategy.advanced.zScoreThreshold}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              advanced: {
                                ...activeStrategy.advanced,
                                zScoreThreshold: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Min. cos(φ) Wirkleistung
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min={0}
                          max={0.95}
                          value={activeStrategy.advanced.cosPhiThreshold}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              advanced: {
                                ...activeStrategy.advanced,
                                cosPhiThreshold: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Profit-Lock Giveback R
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          value={activeStrategy.advanced.profitLockGivebackR}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              advanced: {
                                ...activeStrategy.advanced,
                                profitLockGivebackR: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-[#8B95A5] block mb-0.5">
                          Hebel / Leverage (x)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={25}
                          value={activeStrategy.leverage}
                          onChange={(e) =>
                            setActiveStrategy({
                              ...activeStrategy,
                              leverage: Number(e.target.value),
                            })
                          }
                          className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <label className="flex items-center justify-between pt-1 cursor-pointer">
                      <span className="text-[11px] text-[#A855F7] font-semibold">
                        Shadow Engine (Inverse Gegenstrategie parallel berechnen)
                      </span>
                      <input
                        type="checkbox"
                        checked={activeStrategy.advanced.enableShadowEngine}
                        onChange={(e) =>
                          setActiveStrategy({
                            ...activeStrategy,
                            advanced: {
                              ...activeStrategy.advanced,
                              enableShadowEngine: e.target.checked,
                            },
                          })
                        }
                        className="accent-[#A855F7]"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Validation Error Box */}
              {validationError && (
                <div className="p-2 bg-[#F23645]/15 border border-[#F23645] text-[11px] text-[#F23645] font-mono">
                  {validationError}
                </div>
              )}

              {/* 5. Primary Action Button */}
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  disabled={isJobRunning}
                  onClick={() => handleRunBacktest(activeStrategy)}
                  className={`w-full py-2.5 px-3 font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 border transition-colors ${
                    isJobRunning
                      ? 'bg-[#1B2230] border-[#263042] text-[#8B95A5] cursor-not-allowed'
                      : 'bg-[#089981] hover:bg-[#089981]/90 border-[#089981] text-white'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>
                    {isJobRunning
                      ? 'BERECHNUNG LÄUFT...'
                      : 'STRATEGIE GENERIEREN / BACKTEST STARTEN'}
                  </span>
                </button>

                {isJobRunning && (
                  <button
                    type="button"
                    onClick={handleCancelJob}
                    className="w-full py-1.5 bg-[#F23645]/20 border border-[#F23645] text-[#F23645] text-[11px] font-mono font-bold uppercase"
                  >
                    AKTUELLEN JOB ABBRECHEN
                  </button>
                )}
              </div>
            </div>
          )}

          {/* LEFT MODE 2: AUTOMATED SCHEDULED MULTI-SOURCE SCREENER (6 PROVIDERS) */}
          {leftPaneMode === 'SCREENER' && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Screener Schedule & Provider Controls */}
              <div className="p-2 border-b border-[#1B2230] bg-[#07090E] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#00E5FF]" />
                    <span className="text-[10px] font-bold uppercase text-[#E6EDF3]">
                      AUTO-SCHEDULE SCREENER
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[15, 30, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleConfigureScreenerSchedule(true, sec)}
                        className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                          screenerStatus?.enabled && screenerStatus?.intervalSec === sec
                            ? 'bg-[#00E5FF]/20 border-[#00E5FF] text-[#00E5FF] font-bold'
                            : 'bg-[#0C1017] border-[#1B2230] text-[#8B95A5]'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleManualScreenerRefresh}
                      disabled={isScreenerRefreshing}
                      title="Jetzt alle 6 Börsen-Quellen scannen"
                      className="p-1 bg-[#0C1017] border border-[#1B2230] text-[#00E5FF] hover:border-[#00E5FF]"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${isScreenerRefreshing ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                {/* Search Input */}
                <input
                  type="text"
                  value={screenerSearch}
                  onChange={(e) => setScreenerSearch(e.target.value)}
                  placeholder="Symbol oder Name filtern..."
                  className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                />

                {/* 6-Provider Filter Pills */}
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      'ALL',
                      'ANOMALIES',
                      'KRAKEN',
                      'CCXT',
                      'GAINIUM',
                      'BINANCE',
                      'ALPACA',
                      'ALPHAVANTAGE',
                    ] as const
                  ).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setScreenerFilter(tag)}
                      className={`px-1.5 py-0.5 text-[9px] font-mono border ${
                        screenerFilter === tag
                          ? 'bg-[#00E5FF]/20 border-[#00E5FF] text-[#00E5FF] font-bold'
                          : 'bg-[#0C1017] border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screener Table */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                  <thead className="sticky top-0 bg-[#0C1017] border-b border-[#1B2230] text-[9px] text-[#8B95A5] uppercase">
                    <tr>
                      <th className="py-1.5 px-2">SYM / QUELLE</th>
                      <th className="py-1.5 px-1.5 text-right">PREIS</th>
                      <th className="py-1.5 px-1.5 text-right">RVOL</th>
                      <th className="py-1.5 px-2 text-right">CHG %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1B2230]/60">
                    {filteredScreenerRows.map((row) => {
                      const isSelected =
                        row.symbol.toUpperCase() === activeStrategy.symbol.toUpperCase();
                      return (
                        <tr
                          key={row.symbol}
                          onClick={() =>
                            handleSymbolOrTimeframeChange(row.symbol, activeStrategy.timeframe)
                          }
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#00E5FF]/15 text-[#E6EDF3]'
                              : 'hover:bg-[#131924] text-[#E6EDF3]'
                          }`}
                        >
                          <td className="py-1.5 px-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-[#00E5FF]">{row.symbol}</span>
                              <span
                                className={`text-[8px] px-1 border ${
                                  PROVIDER_BADGE_STYLES[row.provider]
                                }`}
                              >
                                {row.provider}
                              </span>
                            </div>
                            {row.signalTag !== 'NORMAL' && (
                              <div className="text-[9px] text-[#F59E0B] truncate mt-0.5">
                                ⚡ {row.signalTag}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-semibold">
                            {formatPrice(row.price)}
                          </td>
                          <td
                            className={`py-1.5 px-1.5 text-right ${
                              row.rvol >= 2.0 ? 'text-[#00E5FF] font-bold' : 'text-[#8B95A5]'
                            }`}
                          >
                            {row.rvol.toFixed(2)}x
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-semibold ${
                              row.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                            }`}
                          >
                            {row.change24hPct >= 0 ? '+' : ''}
                            {row.change24hPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </aside>

        {/* -----------------------------------------------------------------
            C. CENTER WORKSPACE ZONE (Flex-1): ASSET DOSSIER, PIPELINE, CHART & TABS
           ----------------------------------------------------------------- */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#07090E]">
          {/* 1. Active Asset & Cosinus-Phi Dossier Header */}
          <div className="bg-[#0C1017] border-b border-[#1B2230] px-3 py-1.5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold font-mono text-[#00E5FF]">
                    {activeStrategy.symbol}
                  </span>
                  <span className="text-xs font-mono text-[#8B95A5]">
                    {activeTickerDossier?.name || activeStrategy.name}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.2 border ${
                      PROVIDER_BADGE_STYLES[activeProvider]
                    }`}
                  >
                    {activeProvider}
                  </span>
                </div>
                <div className="text-[10px] text-[#8B95A5] truncate max-w-md">
                  {activeStrategy.idea}
                </div>
              </div>

              {/* Live Price & 24h Range Progress Bar */}
              <div className="flex items-center gap-3 pl-3 border-l border-[#1B2230] font-mono tabular-nums">
                <div>
                  <div className="text-sm font-bold text-[#E6EDF3]">
                    $
                    {formatPrice(
                      candles[candles.length - 1]?.close || activeTickerDossier?.price || 0
                    )}
                  </div>
                  <div
                    className={`text-[10px] font-semibold ${
                      (activeTickerDossier?.change24hPct ?? 0) >= 0
                        ? 'text-[#089981]'
                        : 'text-[#F23645]'
                    }`}
                  >
                    {(activeTickerDossier?.change24hPct ?? 0) >= 0 ? '+' : ''}
                    {(activeTickerDossier?.change24hPct ?? 0).toFixed(2)}% (24h)
                  </div>
                </div>

                {activeTickerDossier && (
                  <div className="hidden md:block w-28">
                    <div className="flex justify-between text-[9px] text-[#8B95A5]">
                      <span>L: {formatPrice(activeTickerDossier.low24h)}</span>
                      <span>H: {formatPrice(activeTickerDossier.high24h)}</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#1B2230] mt-0.5 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#F23645] via-[#00E5FF] to-[#089981]"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(
                              5,
                              ((activeTickerDossier.price - activeTickerDossier.low24h) /
                                Math.max(
                                  activeTickerDossier.high24h - activeTickerDossier.low24h,
                                  1e-6
                                )) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Dossier Metrics: Cosinus-Phi Phase Monitor & Shadow Engine Status */}
            <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
              <div
                className="bg-[#07090E] border border-[#1B2230] px-2.5 py-1"
                title="Cosinus-Phi Phasen-Effizienz: Wirkleistung (Trend) vs. Blindleistung (Chop)"
              >
                <div className="text-[9px] text-[#8B95A5] uppercase">
                  cos(φ) PHASEN-EFFIZIENZ
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`font-bold ${
                      (backtestResult?.shadow.currentCosPhi ?? 0.65) >=
                      activeStrategy.advanced.cosPhiThreshold
                        ? 'text-[#089981]'
                        : 'text-[#F59E0B]'
                    }`}
                  >
                    {(backtestResult?.shadow.currentCosPhi ?? 0.65).toFixed(3)}
                  </span>
                  <span className="text-[9px] text-[#8B95A5]">
                    {backtestResult?.shadow.phaseState || 'ACTIVE_POWER'}
                  </span>
                </div>
              </div>

              <div
                className="bg-[#07090E] border border-[#A855F7]/40 px-2.5 py-1"
                title="Shadow Engine: Parallel laufende inverse Gegenstrategie & adaptives Auto-TP MFE-Quantil"
              >
                <div className="text-[9px] text-[#A855F7] uppercase">
                  SHADOW ENGINE (INVERS)
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-bold ${
                      (backtestResult?.shadow.inverseNetPnlUsd ?? 0) >= 0
                        ? 'text-[#089981]'
                        : 'text-[#F23645]'
                    }`}
                  >
                    ${(backtestResult?.shadow.inverseNetPnlUsd ?? 0).toFixed(2)}
                  </span>
                  <span className="text-[9px] text-[#8B95A5]">
                    MFE-Q: {(backtestResult?.shadow.adaptiveMfeQuantileR ?? 2.1).toFixed(2)}R
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Grok-Bot-Terminal Animated 5-Stage Pipeline Strip */}
          <TerminalPipelineStrip
            isRunning={isJobRunning}
            activeProvider={activeProvider}
            activeSymbol={activeStrategy.symbol}
            activeTimeframe={activeStrategy.timeframe}
            activeConcurrentTrades={currentConcurrentCount}
            maxConcurrentTrades={activeStrategy.maxConcurrentTrades}
            paperCapital={activeStrategy.initialCapital}
            filteredByMax20Count={backtestResult?.metrics.filteredByMax20Cap ?? 0}
            filteredByChopCount={backtestResult?.metrics.filteredByCosPhiChop ?? 0}
            latestLog={backtestResult?.pipelineEvents?.[0] || null}
          />

          {/* 3. Interactive Financial Result Chart */}
          <TerminalWorkspaceChart
            symbol={activeStrategy.symbol}
            timeframe={activeStrategy.timeframe}
            provider={activeProvider}
            candles={candles}
            trades={backtestResult?.trades || []}
            equityCurve={backtestResult?.equityCurve || []}
            initialCapital={activeStrategy.initialCapital}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
            fastEmaPeriod={activeStrategy.advanced.fastPeriod}
            slowEmaPeriod={activeStrategy.advanced.slowPeriod}
          />

          {/* 4. Bottom Evaluation & Execution Dock */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#0C1017]">
            {/* Dock Tab Navigation + Export Bar */}
            <div className="flex items-center justify-between px-2.5 border-b border-[#1B2230] bg-[#07090E] shrink-0">
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setBottomTab('TRADES')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 ${
                    bottomTab === 'TRADES'
                      ? 'border-[#00E5FF] text-[#00E5FF] bg-[#0C1017]'
                      : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  TRADE-LISTE & LOG ({backtestResult?.trades.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('METRICS')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 ${
                    bottomTab === 'METRICS'
                      ? 'border-[#00E5FF] text-[#00E5FF] bg-[#0C1017]'
                      : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  PERFORMANCE & SHADOW-ANALYSE
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('EXECUTION')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 ${
                    bottomTab === 'EXECUTION'
                      ? 'border-[#089981] text-[#089981] bg-[#0C1017]'
                      : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  PAPER / LIVE EXECUTION ({paperOpenPositions.length}/20 AKTIV)
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab('PINE')}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 flex items-center gap-1 ${
                    bottomTab === 'PINE'
                      ? 'border-[#A855F7] text-[#A855F7] bg-[#0C1017]'
                      : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
                  }`}
                >
                  <Code2 className="w-3 h-3" />
                  <span>PINE SCRIPT v6</span>
                </button>
              </div>

              {/* Direct Export Buttons */}
              <div className="flex items-center gap-1.5 py-1">
                {backtestResult && (
                  <button
                    type="button"
                    onClick={() => exportTradesToCsv(backtestResult)}
                    className="px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#8B95A5] hover:text-[#00E5FF] flex items-center gap-1"
                  >
                    <Download className="w-2.5 h-2.5" />
                    <span>CSV EXPORT</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => exportStrategyAndResultToJson(activeStrategy, backtestResult)}
                  className="px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#8B95A5] hover:text-[#00E5FF] flex items-center gap-1"
                >
                  <Download className="w-2.5 h-2.5" />
                  <span>JSON EXPORT</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportPineScriptFile(
                      activeStrategy.name,
                      activeStrategy.symbol,
                      editablePineScript || backtestResult?.pineScriptV6 || ''
                    )
                  }
                  className="px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#A855F7] hover:border-[#A855F7] flex items-center gap-1"
                >
                  <Code2 className="w-2.5 h-2.5" />
                  <span>.PINE EXPORT</span>
                </button>
              </div>
            </div>

            {/* TAB 1: TRADE LIST & GROK PIPELINE EXECUTION LOG */}
            {bottomTab === 'TRADES' && (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-2.5 py-1 border-b border-[#1B2230] flex items-center justify-between text-[10px] font-mono">
                  <div className="flex items-center gap-1">
                    {(['ALL', 'LONG', 'SHORT', 'WIN', 'LOSS'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setTradeFilter(f)}
                        className={`px-1.5 py-0.5 border ${
                          tradeFilter === f
                            ? 'bg-[#00E5FF]/15 border-[#00E5FF] text-[#00E5FF]'
                            : 'bg-[#07090E] border-[#1B2230] text-[#8B95A5]'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <span className="text-[#8B95A5]">
                    Klicke auf einen Trade, um Entry, Exit, SL & TP im Chart zu fokussieren
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {filteredTrades.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#8B95A5]">
                      Keine abgeschlossenen Round-Trip-Trades für den aktuellen Filter vorhanden.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
                      <thead className="sticky top-0 bg-[#07090E] border-b border-[#1B2230] text-[9px] text-[#8B95A5] uppercase">
                        <tr>
                          <th className="py-1 px-2"># / SLOT</th>
                          <th className="py-1 px-1.5">SIDE</th>
                          <th className="py-1 px-2">ENTRY ZEIT / PREIS</th>
                          <th className="py-1 px-2">EXIT ZEIT / PREIS</th>
                          <th className="py-1 px-1.5 text-right">SIZE ($/%)</th>
                          <th className="py-1 px-1.5 text-right">MFE / MAE</th>
                          <th className="py-1 px-1.5 text-right">cos(φ)</th>
                          <th className="py-1 px-1.5 text-center">EXIT-GRUND</th>
                          <th className="py-1 px-2 text-right">NET PNL ($ / %)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1B2230]/50">
                        {filteredTrades.map((t) => {
                          const isWin = t.netPnlUsd >= 0;
                          const isSelected = t.id === selectedTradeId;
                          return (
                            <tr
                              key={t.id}
                              onClick={() => setSelectedTradeId(isSelected ? null : t.id)}
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-[#00E5FF]/20' : 'hover:bg-[#131924]'
                              }`}
                            >
                              <td className="py-1 px-2 text-[#8B95A5]">
                                #{t.tradeNumber} ({t.concurrentSlot}/20)
                              </td>
                              <td className="py-1 px-1.5">
                                <span
                                  className={`px-1.5 py-0.2 text-[9px] font-bold border ${
                                    t.side === 'LONG'
                                      ? 'bg-[#089981]/15 border-[#089981]/50 text-[#089981]'
                                      : 'bg-[#F23645]/15 border-[#F23645]/50 text-[#F23645]'
                                  }`}
                                >
                                  {t.side}
                                </span>
                              </td>
                              <td className="py-1 px-2">
                                <span className="text-[#E6EDF3] font-semibold">
                                  ${formatPrice(t.entryPrice)}
                                </span>{' '}
                                <span className="text-[9px] text-[#8B95A5]">
                                  (
                                  {new Date(t.entryTime).toLocaleTimeString('de-DE', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  )
                                </span>
                              </td>
                              <td className="py-1 px-2">
                                <span className="text-[#E6EDF3] font-semibold">
                                  ${formatPrice(t.exitPrice)}
                                </span>{' '}
                                <span className="text-[9px] text-[#8B95A5]">
                                  (
                                  {new Date(t.exitTime).toLocaleTimeString('de-DE', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  )
                                </span>
                              </td>
                              <td className="py-1 px-1.5 text-right text-[#8B95A5]">
                                ${t.notionalUsd.toFixed(0)} ({t.sizePctEquity.toFixed(0)}%)
                              </td>
                              <td className="py-1 px-1.5 text-right text-[10px]">
                                <span className="text-[#089981]">+{t.mfePct.toFixed(1)}%</span> /{' '}
                                <span className="text-[#F23645]">-{t.maePct.toFixed(1)}%</span>
                              </td>
                              <td className="py-1 px-1.5 text-right text-[#00E5FF]">
                                {t.cosPhiAtEntry.toFixed(2)}
                              </td>
                              <td className="py-1 px-1.5 text-center">
                                <span className="px-1 py-0.2 text-[9px] bg-[#07090E] border border-[#263042] text-[#E6EDF3]">
                                  {t.exitReason}
                                </span>
                              </td>
                              <td
                                className={`py-1 px-2 text-right font-bold ${
                                  isWin ? 'text-[#089981]' : 'text-[#F23645]'
                                }`}
                              >
                                {isWin ? '+' : ''}${t.netPnlUsd.toFixed(2)} ({isWin ? '+' : ''}
                                {t.returnPct.toFixed(2)}%)
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: PERFORMANCE, RISK METRICS & SHADOW ENGINE COUNTER-ANALYSIS */}
            {bottomTab === 'METRICS' && backtestResult && (
              <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-3 gap-3 font-mono tabular-nums text-xs">
                {/* Col 1: Core Return & Quality */}
                <div className="bg-[#07090E] border border-[#1B2230] p-2.5 space-y-1.5">
                  <div className="text-[10px] font-bold text-[#00E5FF] uppercase border-b border-[#1B2230] pb-1">
                    RENDITE & TRADE-QUALITÄT ($1,000 BASIS)
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Startkapital:</span>
                    <span>${activeStrategy.initialCapital.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">End-Equity:</span>
                    <span className="font-bold text-[#E6EDF3]">
                      ${backtestResult.metrics.finalEquity.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Netto-Gewinn (Net PnL):</span>
                    <span
                      className={`font-bold ${
                        backtestResult.metrics.netProfitUsd >= 0
                          ? 'text-[#089981]'
                          : 'text-[#F23645]'
                      }`}
                    >
                      ${backtestResult.metrics.netProfitUsd.toFixed(2)} (
                      {backtestResult.metrics.netReturnPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Profit Factor:</span>
                    <span className="font-bold">{backtestResult.metrics.profitFactor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Trefferquote (Win Rate):</span>
                    <span className="font-bold">{backtestResult.metrics.winRatePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Sharpe / Trade Quality (μ/σ):</span>
                    <span className="text-[#00E5FF] font-bold">
                      {backtestResult.metrics.sharpeRatio} /{' '}
                      {backtestResult.metrics.tradeQualityMuSigma}
                    </span>
                  </div>
                </div>

                {/* Col 2: Risk, Drawdown & M2 20-Trade Cap Telemetry */}
                <div className="bg-[#07090E] border border-[#1B2230] p-2.5 space-y-1.5">
                  <div className="text-[10px] font-bold text-[#F23645] uppercase border-b border-[#1B2230] pb-1">
                    DRAWDOWN, KOSTEN & 20-TRADE-CAP
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Max Drawdown:</span>
                    <span className="text-[#F23645] font-bold">
                      -${backtestResult.metrics.maxDrawdownUsd.toFixed(2)} (-
                      {backtestResult.metrics.maxDrawdownPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Recovery Factor:</span>
                    <span>{backtestResult.metrics.recoveryFactor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Kommissionen gesamt:</span>
                    <span>${backtestResult.metrics.totalFeesUsd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Peak gleichzeitige Trades:</span>
                    <span className="text-[#00E5FF] font-bold">
                      {backtestResult.metrics.peakConcurrentTrades} / 20
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Gefiltert (Max 20 Cap):</span>
                    <span className="text-[#F59E0B] font-bold">
                      {backtestResult.metrics.filteredByMax20Cap} Signale
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Gefiltert (CosPhi Chop):</span>
                    <span>{backtestResult.metrics.filteredByCosPhiChop} Signale</span>
                  </div>
                </div>

                {/* Col 3: Shadow Engine (Negative Counter-Strategy Comparison) */}
                <div className="bg-[#07090E] border border-[#A855F7]/40 p-2.5 space-y-1.5">
                  <div className="text-[10px] font-bold text-[#A855F7] uppercase border-b border-[#1B2230] pb-1">
                    SHADOW ENGINE (INVERSE GEGENSTRATEGIE)
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Inverse Net PnL:</span>
                    <span
                      className={`font-bold ${
                        backtestResult.shadow.inverseNetPnlUsd >= 0
                          ? 'text-[#089981]'
                          : 'text-[#F23645]'
                      }`}
                    >
                      ${backtestResult.shadow.inverseNetPnlUsd.toFixed(2)} (
                      {backtestResult.shadow.inverseReturnPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Inverse Win Rate:</span>
                    <span>{backtestResult.shadow.inverseWinRatePct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Shadow Stops gebrochen:</span>
                    <span className="text-[#A855F7] font-bold">
                      {backtestResult.shadow.shadowStopsBrokenCount}x gefeuert
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B95A5]">Adaptives Auto-TP Quantil:</span>
                    <span className="text-[#00E5FF] font-bold">
                      {backtestResult.shadow.adaptiveMfeQuantileR}R
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8B95A5] pt-1 border-t border-[#1B2230]">
                    {backtestResult.shadow.recommendation}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: PAPER / LIVE EXECUTION BLOTTER ($1,000 ACCOUNT, MAX 20 TRADES) */}
            {bottomTab === 'EXECUTION' && (
              <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-3 gap-3 font-mono tabular-nums text-xs">
                {/* Direct Order Ticket */}
                <div className="bg-[#07090E] border border-[#1B2230] p-2.5 space-y-2">
                  <div className="flex items-center justify-between border-b border-[#1B2230] pb-1">
                    <span className="text-[10px] font-bold text-[#00E5FF] uppercase">
                      DIREKT-ORDER ({executionEnvironment})
                    </span>
                    <span className="text-[10px] text-[#089981]">
                      Cash: ${paperCash.toFixed(2)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-[#8B95A5] block">Symbol</span>
                      <div className="bg-[#0C1017] border border-[#1B2230] px-2 py-1 font-bold text-[#E6EDF3]">
                        {activeStrategy.symbol}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#8B95A5] block">
                        Positionsgröße ($ USD)
                      </span>
                      <input
                        type="number"
                        min={10}
                        max={1000}
                        step={10}
                        value={orderSizeUsd}
                        onChange={(e) => setOrderSizeUsd(Number(e.target.value))}
                        className="w-full bg-[#0C1017] border border-[#1B2230] px-2 py-1 font-bold text-[#00E5FF]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={isSubmittingOrder || paperOpenPositions.length >= 20}
                      onClick={() => handleExecutePaperOrder('buy')}
                      className="py-1.5 bg-[#089981] hover:bg-[#089981]/90 disabled:opacity-40 text-white font-bold uppercase text-[11px]"
                    >
                      BUY / LONG
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingOrder}
                      onClick={() => handleExecutePaperOrder('sell')}
                      className="py-1.5 bg-[#F23645] hover:bg-[#F23645]/90 disabled:opacity-40 text-white font-bold uppercase text-[11px]"
                    >
                      SELL / CLOSE
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[#1B2230]">
                    <span className="text-[10px] text-[#8B95A5]">
                      Slots: {paperOpenPositions.length} / 20
                    </span>
                    <button
                      type="button"
                      onClick={handleResetPaperTo1000}
                      className="text-[10px] text-[#00E5FF] hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Konto auf $1,000.00 Reset</span>
                    </button>
                  </div>
                </div>

                {/* Open Paper Positions Table */}
                <div className="md:col-span-2 bg-[#07090E] border border-[#1B2230] p-2.5 flex flex-col">
                  <div className="flex items-center justify-between border-b border-[#1B2230] pb-1 mb-1.5">
                    <span className="text-[10px] font-bold text-[#E6EDF3] uppercase">
                      AKTIVE PAPER-POSITIONEN ({paperOpenPositions.length} / 20 MAX)
                    </span>
                    <span className="text-[10px] text-[#8B95A5]">
                      Quelle: Kraken CLI 0.4.1 Paper Ledger ($1,000.00 Basis)
                    </span>
                  </div>

                  {paperOpenPositions.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-[#8B95A5] text-xs py-6">
                      Keine offenen Positionen im Paper-Ledger (0 / 20 belegt · $1,000.00 verfügbar).
                    </div>
                  ) : (
                    <div className="overflow-y-auto max-h-36">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead className="text-[9px] text-[#8B95A5] uppercase border-b border-[#1B2230]">
                          <tr>
                            <th className="py-1">PAIR</th>
                            <th className="py-1">SIDE</th>
                            <th className="py-1 text-right">VOLUMEN</th>
                            <th className="py-1 text-right">ENTRY</th>
                            <th className="py-1 text-right">MARKT</th>
                            <th className="py-1 text-right">UNREAL. PNL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1B2230]/50">
                          {paperOpenPositions.map((pos, idx) => (
                            <tr key={idx}>
                              <td className="py-1 font-bold text-[#00E5FF]">{pos.pair}</td>
                              <td className="py-1 uppercase text-[#089981]">{pos.side}</td>
                              <td className="py-1 text-right">{pos.volume}</td>
                              <td className="py-1 text-right">${formatPrice(pos.entry_price)}</td>
                              <td className="py-1 text-right">${formatPrice(pos.current_price)}</td>
                              <td
                                className={`py-1 text-right font-bold ${
                                  pos.unrealized_pnl >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                                }`}
                              >
                                ${pos.unrealized_pnl.toFixed(2)} (
                                {pos.unrealized_pnl_pct.toFixed(2)}%)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: PINE SCRIPT V6 EDITOR & ONE-CLICK COPY / .PINE EXPORT */}
            {bottomTab === 'PINE' && (
              <div className="flex-1 flex flex-col min-h-0 p-2.5 bg-[#07090E]">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-[#8B95A5]">
                    TradingView Pine Script v6 · Synchronisiert mit "{activeStrategy.name}" (
                    {activeStrategy.symbol} · {activeStrategy.timeframe} · $1,000 Kapital · Max 20
                    Trades)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(editablePineScript);
                        setPineCopied(true);
                        setTimeout(() => setPineCopied(false), 2000);
                      }}
                      className="px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#00E5FF] hover:border-[#00E5FF] flex items-center gap-1"
                    >
                      {pineCopied ? (
                        <Check className="w-3 h-3 text-[#089981]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{pineCopied ? 'KOPIERT' : 'CODE KOPIEREN'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportPineScriptFile(
                          activeStrategy.name,
                          activeStrategy.symbol,
                          editablePineScript
                        )
                      }
                      className="px-2 py-0.5 bg-[#A855F7]/20 border border-[#A855F7] text-[10px] font-mono text-[#A855F7] font-bold flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>.PINE DATEI SPEICHERN</span>
                    </button>
                  </div>
                </div>
                <textarea
                  aria-label="Pine Script v6 Code Editor"
                  value={editablePineScript}
                  onChange={(e) => setEditablePineScript(e.target.value)}
                  className="flex-1 w-full bg-[#0C1017] border border-[#1B2230] p-2.5 font-mono text-[11px] text-[#E6EDF3] focus:outline-none focus:border-[#A855F7] resize-none"
                />
              </div>
            )}
          </div>
        </main>

        {/* -----------------------------------------------------------------
            D. RIGHT WORKSPACE ZONE (295px): CHRONICLE OF EVENTS & BEAM OF ABSORPTION
           ----------------------------------------------------------------- */}
        <aside className="w-[295px] bg-[#0C1017] border-l border-[#1B2230] flex flex-col min-h-0 shrink-0">
          {/* Top Half: Chronicle of Events */}
          <div className="flex-1 flex flex-col min-h-0 border-b border-[#1B2230]">
            <div className="px-2.5 py-1.5 bg-[#07090E] border-b border-[#1B2230] flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[#00E5FF]" />
                <span className="text-[10px] font-bold tracking-wider uppercase text-[#E6EDF3]">
                  CHRONICLE OF EVENTS (LIVE)
                </span>
              </div>
              <span className="text-[9px] font-mono text-[#8B95A5]">6 QUELLEN</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#1B2230]/50 font-mono tabular-nums text-[10px]">
              {(screenerStatus?.chronicle || []).map((ev: ChronicleAnomalyEvent) => (
                <div
                  key={ev.id}
                  onClick={() =>
                    handleSymbolOrTimeframeChange(ev.symbol, activeStrategy.timeframe)
                  }
                  className="px-2.5 py-1.5 hover:bg-[#131924] cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#8B95A5]">{ev.timeFormatted}</span>
                      <span className="font-bold text-[#00E5FF]">{ev.symbol}</span>
                    </div>
                    <span
                      className={`text-[8px] px-1 border ${PROVIDER_BADGE_STYLES[ev.provider]}`}
                    >
                      {ev.provider}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 leading-tight ${
                      ev.severity === 'BULLISH'
                        ? 'text-[#089981]'
                        : ev.severity === 'BEARISH'
                        ? 'text-[#F23645]'
                        : ev.severity === 'WARNING'
                        ? 'text-[#F59E0B]'
                        : 'text-[#8B95A5]'
                    }`}
                  >
                    {ev.headline} — {ev.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Half: The Beam of Absorption & L2 Orderbook Depth */}
          <div className="h-[275px] flex flex-col bg-[#07090E] shrink-0">
            <div className="px-2.5 py-1.5 bg-[#0C1017] border-b border-[#1B2230] flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-[#E6EDF3]">
                BEAM OF ABSORPTION · L2 BOOK
              </span>
              <span className="text-[9px] font-mono text-[#00E5FF]">
                {activeStrategy.symbol}
              </span>
            </div>

            {/* Horizontal Bid/Ask Absorption Beam */}
            <div className="px-2.5 py-2 border-b border-[#1B2230]">
              <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                <span className="text-[#089981] font-bold">
                  BID {orderbookDepth.bidAbsorptionPct}%
                </span>
                <span className="text-[#8B95A5] text-[9px]">ABSORPTION</span>
                <span className="text-[#F23645] font-bold">
                  {orderbookDepth.askAbsorptionPct}% ASK
                </span>
              </div>
              <div className="w-full h-2 bg-[#F23645]/40 flex overflow-hidden border border-[#1B2230]">
                <div
                  className="h-full bg-[#089981] transition-all duration-300"
                  style={{ width: `${orderbookDepth.bidAbsorptionPct}%` }}
                />
              </div>
            </div>

            {/* L2 Depth Ladder (Bids vs Asks) */}
            <div className="flex-1 overflow-y-auto px-2 py-1 grid grid-cols-2 gap-1.5 font-mono tabular-nums text-[10px]">
              {/* Bids Column */}
              <div>
                <div className="flex justify-between text-[8px] text-[#8B95A5] uppercase border-b border-[#1B2230] pb-0.5 mb-0.5">
                  <span>BID PREIS</span>
                  <span>VOL</span>
                </div>
                {orderbookDepth.bids.map((b, i) => (
                  <div key={i} className="relative flex justify-between py-0.5">
                    <div
                      className="absolute inset-y-0 right-0 bg-[#089981]/15 pointer-events-none"
                      style={{
                        width: `${Math.min(100, (b.total / orderbookDepth.totalBidVol) * 100)}%`,
                      }}
                    />
                    <span className="text-[#089981] relative z-10">{formatPrice(b.price)}</span>
                    <span className="text-[#E6EDF3] relative z-10">{b.size.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {/* Asks Column */}
              <div>
                <div className="flex justify-between text-[8px] text-[#8B95A5] uppercase border-b border-[#1B2230] pb-0.5 mb-0.5">
                  <span>ASK PREIS</span>
                  <span>VOL</span>
                </div>
                {orderbookDepth.asks.map((a, i) => (
                  <div key={i} className="relative flex justify-between py-0.5">
                    <div
                      className="absolute inset-y-0 left-0 bg-[#F23645]/15 pointer-events-none"
                      style={{
                        width: `${Math.min(100, (a.total / orderbookDepth.totalAskVol) * 100)}%`,
                      }}
                    />
                    <span className="text-[#F23645] relative z-10">{formatPrice(a.price)}</span>
                    <span className="text-[#E6EDF3] relative z-10">{a.size.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick 1-Click Paper Execution Bar at Bottom of Orderbook */}
            <div className="p-1.5 border-t border-[#1B2230] bg-[#0C1017] grid grid-cols-2 gap-1.5">
              <button
                type="button"
                disabled={isSubmittingOrder || paperOpenPositions.length >= 20}
                onClick={() => handleExecutePaperOrder('buy')}
                className="py-1 bg-[#089981]/20 hover:bg-[#089981]/30 border border-[#089981] text-[#089981] text-[10px] font-mono font-bold uppercase flex items-center justify-center gap-1"
              >
                <ArrowUpRight className="w-3 h-3" />
                <span>PAPER BUY (${orderSizeUsd})</span>
              </button>
              <button
                type="button"
                disabled={isSubmittingOrder}
                onClick={() => handleExecutePaperOrder('sell')}
                className="py-1 bg-[#F23645]/20 hover:bg-[#F23645]/30 border border-[#F23645] text-[#F23645] text-[10px] font-mono font-bold uppercase flex items-center justify-center gap-1"
              >
                <ArrowDownRight className="w-3 h-3" />
                <span>PAPER SELL (${orderSizeUsd})</span>
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Collapsible Diagnostics & 6-Provider Cascade Drawer */}
      <TerminalDiagnosticsDrawer
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        activeProvider={activeProvider}
        cascadeTrace={cascadeTrace}
        screenerStatus={screenerStatus}
        backtestResult={backtestResult}
        wsConnected={wsConnected}
        systemLogs={systemLogs}
      />

      {/* Google Drive Blueprint Modal */}
      {isDriveModalOpen && (
        <DriveBlueprintModal
          isOpen={isDriveModalOpen}
          onClose={() => setIsDriveModalOpen(false)}
          user={driveUser}
          onSignIn={handleDriveSignIn}
          onSignOut={handleDriveSignOut}
          onSearch={handleDriveSearch}
          driveFiles={driveFiles}
          isLoading={isDriveLoading}
          error={driveError}
          onSelectFile={handleDriveSelectFile}
        />
      )}
    </div>
  );
}

export default App;
