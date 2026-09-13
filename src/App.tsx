import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { Header } from './components/Header';
import { JudgeGateView } from './components/JudgeGateView';
import { SwarmView } from './components/SwarmView';
import { PortfolioView } from './components/PortfolioView';
import { OrderbookView } from './components/OrderbookView';
import { BlueprintDocsView } from './components/BlueprintDocsView';
import { DriveBlueprintModal } from './components/DriveBlueprintModal';
import { WorkerBotsView } from './components/WorkerBotsView';
import { ConnectionHistoryModal } from './components/ConnectionHistoryModal';
import { KrakenCliView } from './components/KrakenCliView';
import { KrakenFourTasksBar } from './components/KrakenFourTasksBar';
import {
  fetchAuthoritativeBalance,
  fetchKrakenBalance,
  executePaperBridgeOrder,
} from './services/krakenCliProxyRegistry';

import {
  RawSignal,
  JudgeVerdict,
  ExecutionOrder,
  StrategyAgent,
  JudgeConfig,
  PortfolioState,
  Position,
  OrderbookData,
  DriveBlueprintItem,
  WorkerBot,
} from './types/trading';

import {
  createInitialMarketData,
  simulateTick,
  executeVerdict,
  recalculatePortfolio,
  createInitialPortfolio,
  prioritizeKrakenMarketData,
} from './engine/marketEngine';
import { generateSwarmSignals } from './engine/swarmEngine';
import { adjudicateSignal } from './engine/judgeEngine';
import { INITIAL_JUDGE_CONFIG, INITIAL_SWARM_STRATEGIES } from './data/canonicalBlueprint';
import { INITIAL_WORKER_BOTS, updateWorkerBotsWithMarket } from './data/workerBots';
import { useKrakenStream } from './hooks/useKrakenStream';
import { initAuth, googleSignIn, logout, getAccessToken, setAccessTokenInMemory } from './services/firebase';
import { searchDriveFiles, fetchFileContent } from './services/googleDrive';

export default function App() {
  // Engine execution state
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [tickCount, setTickCount] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<string>('judge');

  // Quant core state
  const [markets, setMarkets] = useState<Record<string, OrderbookData>>(createInitialMarketData);
  const [portfolio, setPortfolio] = useState<PortfolioState>(createInitialPortfolio);
  const [strategies, setStrategies] = useState<StrategyAgent[]>(INITIAL_SWARM_STRATEGIES);
  const [judgeConfig, setJudgeConfig] = useState<JudgeConfig>(INITIAL_JUDGE_CONFIG);
  const [workerBots, setWorkerBots] = useState<WorkerBot[]>(INITIAL_WORKER_BOTS);

  // Real-Time Kraken Market Stream Hook (Multi-tier WebSocket & Cloud Run Bridge)
  const kraken = useKrakenStream(isRunning);

  // Active consolidated orderbook: strictly prioritizes live Kraken WS ticker & orderbook data
  const activeMarkets = prioritizeKrakenMarketData(markets, kraken.markets, kraken.isRealKrakenData);

  const tickCountRef = useRef<number>(1);
  const marketsRef = useRef<Record<string, OrderbookData>>(activeMarkets);
  marketsRef.current = activeMarkets;
  const strategiesRef = useRef<StrategyAgent[]>(strategies);
  strategiesRef.current = strategies;
  const judgeConfigRef = useRef<JudgeConfig>(judgeConfig);
  judgeConfigRef.current = judgeConfig;

  // Real-time zero-latency worker bot sync whenever Kraken WS ticker updates arrive
  useEffect(() => {
    if (!kraken.isRealKrakenData || Object.keys(kraken.markets).length === 0) return;
    const prioritized = prioritizeKrakenMarketData(marketsRef.current, kraken.markets, true);
    setWorkerBots((prevBots) => updateWorkerBotsWithMarket(prevBots, prioritized));
  }, [kraken.markets, kraken.isRealKrakenData]);

  // Authoritative Kraken balance NAV reference (updated directly from kraken balance / paper status)
  const authoritativeNavRef = useRef<number>(100000);

  // Streaming buffers (initialized cleanly without simulated sizing drifts)
  const [signals, setSignals] = useState<RawSignal[]>([]);
  const [verdicts, setVerdicts] = useState<JudgeVerdict[]>([]);
  const [orders, setOrders] = useState<ExecutionOrder[]>([]);
  const [equityHistory, setEquityHistory] = useState<{ timestamp: number; nav: number }[]>([]);

  // Google Drive & Auth state
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveBlueprintItem[]>([]);
  const [isLoadingDrive, setIsLoadingDrive] = useState<boolean>(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [selectedDriveFile, setSelectedDriveFile] = useState<DriveBlueprintItem | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState<boolean>(false);
  const [isConnectionHistoryOpen, setIsConnectionHistoryOpen] = useState<boolean>(false);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setDriveUser(user);
        if (token) {
          setDriveToken(token);
          setAccessTokenInMemory(token);
          // Initial discovery search on user's Google Drive
          performDriveSearch('OMEGA NIO', token);
        }
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
        setAccessTokenInMemory(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Search user's Google Drive
  const performDriveSearch = useCallback(async (query: string, tokenOverride?: string) => {
    const token = tokenOverride || driveToken || getAccessToken();
    if (!token) {
      setDriveError('Google Drive token missing. Please authenticate via Sign in with Google.');
      return;
    }
    setIsLoadingDrive(true);
    setDriveError(null);
    try {
      const files = await searchDriveFiles(token, query);
      setDriveFiles(files);
      if (files.length > 0 && !selectedDriveFile) {
        handleSelectDriveFile(files[0], token);
      }
    } catch (err: any) {
      console.error('Google Drive search failed:', err);
      setDriveError(err.message || 'Failed to search Google Drive files');
    } finally {
      setIsLoadingDrive(false);
    }
  }, [driveToken, selectedDriveFile]);

  // Handle Google Drive file selection
  const handleSelectDriveFile = async (file: DriveBlueprintItem, tokenOverride?: string) => {
    setSelectedDriveFile(file);
    const token = tokenOverride || driveToken || getAccessToken();
    if (!token) return;

    try {
      setSelectedFileContent('Loading document from Google Drive API...');
      const text = await fetchFileContent(token, file.id, file.mimeType);
      setSelectedFileContent(text);
    } catch (err: any) {
      console.error('Failed to fetch file content:', err);
      setSelectedFileContent(`Error loading file: ${err.message}`);
    }
  };

  // Google Login Action
  const handleGoogleSignIn = async () => {
    setDriveError(null);
    try {
      const { user, accessToken } = await googleSignIn();
      setDriveUser(user);
      setDriveToken(accessToken);
      setAccessTokenInMemory(accessToken);
      await performDriveSearch('OMEGA NIO', accessToken);
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      setDriveError(err.message || 'Google authentication failed');
    }
  };

  // Google Sign Out Action
  const handleGoogleSignOut = async () => {
    await logout();
    setDriveUser(null);
    setDriveToken(null);
    setAccessTokenInMemory(null);
    setDriveFiles([]);
    setSelectedDriveFile(null);
    setSelectedFileContent(null);
  };

  // Manual Position Close
  const handleClosePosition = (symbol: string) => {
    setPortfolio((prev) => {
      const targetPos = prev.positions.find((p) => p.symbol === symbol);
      if (!targetPos) return prev;

      const book = markets[symbol];
      const exitPrice = book ? book.lastPrice : targetPos.currentPrice;
      const realizedTradePnl =
        targetPos.direction === 'LONG'
          ? (exitPrice - targetPos.entryPrice) * targetPos.quantity
          : (targetPos.entryPrice - exitPrice) * targetPos.quantity;

      const remainingPositions = prev.positions.filter((p) => p.symbol !== symbol);
      const newCash = prev.cashUsd + targetPos.allocatedUsd + realizedTradePnl;

      return recalculatePortfolio(
        {
          ...prev,
          cashUsd: newCash,
          realizedPnl: prev.realizedPnl + realizedTradePnl,
          positions: remainingPositions,
        },
        markets
      );
    });
  };

  // Update Strategy Weights
  const handleUpdateStrategyWeight = (strategyId: string, newWeight: number) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === strategyId ? { ...s, weight: newWeight } : s))
    );
  };

  // Test Signal Injection
  const handleInjectTestSignal = (type: 'NORMAL' | 'OVERSIZED' | 'LATENCY_STALE' | 'WIDE_SPREAD') => {
    const symbol = 'BTC/USD';
    const book = markets[symbol];
    const now = Date.now();

    let sig: RawSignal;

    const activeNav = authoritativeNavRef.current > 0 ? authoritativeNavRef.current : 100000;

    if (type === 'OVERSIZED') {
      sig = {
        id: `TEST-OVERSIZE-${Date.now()}`,
        timestamp: now,
        strategyId: 'strat_alpha_momentum',
        strategyName: 'Alpha-Momentum (Test)',
        symbol,
        direction: 'LONG',
        confidence: 0.95,
        expectedAlphaBps: 28.0,
        timeHorizonSec: 60,
        suggestedSizeUsd: Math.round(activeNav * 1.5), // Dynamic oversized request (150% of CLI NAV) to trigger M2/M4/M7
        rawMetrics: { zScore: 3.4, stressTest: 1 },
      };
    } else if (type === 'LATENCY_STALE') {
      sig = {
        id: `TEST-STALE-${Date.now()}`,
        timestamp: now - 950, // 950ms old tick exceeds 500ms M1 limit
        strategyId: 'strat_orderbook_microstructure',
        strategyName: 'Microstructure (Test)',
        symbol,
        direction: 'SHORT',
        confidence: 0.75,
        expectedAlphaBps: 15.0,
        timeHorizonSec: 30,
        suggestedSizeUsd: Math.round(activeNav * 0.15),
        rawMetrics: { latencyDrift: 950 },
      };
    } else if (type === 'WIDE_SPREAD') {
      sig = {
        id: `TEST-SPREAD-${Date.now()}`,
        timestamp: now,
        strategyId: 'strat_sigma_mean_reversion',
        strategyName: 'Sigma-MeanReversion (Test)',
        symbol: 'NIO/USD',
        direction: 'LONG',
        confidence: 0.65,
        expectedAlphaBps: 12.0,
        timeHorizonSec: 120,
        suggestedSizeUsd: Math.round(activeNav * 0.20),
        rawMetrics: { spreadBps: 18.5 }, // Simulated wide spread
      };
    } else {
      sig = {
        id: `TEST-ALPHA-${Date.now()}`,
        timestamp: now - 15,
        strategyId: 'strat_deep_rl',
        strategyName: 'Deep-RL Multi-Horizon (Test)',
        symbol: 'ETH/USD',
        direction: 'LONG',
        confidence: 0.88,
        expectedAlphaBps: 22.4,
        timeHorizonSec: 120,
        suggestedSizeUsd: Math.round(activeNav * 0.12),
        rawMetrics: { entropy: 0.021, valueEstimate: 1.84 },
      };
    }

    // Adjudicate injected signal immediately strictly using authoritative navUsd
    const strat = strategies.find((s) => s.id === sig.strategyId);
    const mockBook = type === 'WIDE_SPREAD' ? { ...book, spreadBps: 18.5 } : book;
    const verdict = adjudicateSignal(sig, portfolio, mockBook, judgeConfig, strat, activeNav);

    setSignals((prev) => [sig, ...prev.slice(0, 49)]);
    setVerdicts((prev) => [verdict, ...prev.slice(0, 49)]);

    if (verdict.status !== 'REJECTED') {
      const { updatedPortfolio, executedOrder } = executeVerdict(verdict, portfolio, mockBook);
      setPortfolio(updatedPortfolio);
      if (executedOrder) {
        setOrders((prev) => [executedOrder, ...prev.slice(0, 49)]);

        // Direct DMA dispatch to Kraken CLI Paper Execution Bridge
        executePaperBridgeOrder({
          signalId: verdict.signalId,
          symbol: verdict.symbol,
          side: verdict.direction === 'LONG' ? 'buy' : 'sell',
          sizeUsd: verdict.approvedSizeUsd,
          price: mockBook.lastPrice,
          executionRoute: verdict.executionRoute,
          strategyId: verdict.strategyId,
          strategyName: strat?.name || verdict.strategyId,
        }).then(() => {
          syncAuthoritativeBalance();
        }).catch((err) => {
          console.warn('[Kraken Paper Bridge] Test signal bridge error:', err);
        });
      }
    }
  };

  // Synchronize portfolio directly from Kraken CLI 0.4.1 Source of Truth
  const syncAuthoritativeBalance = useCallback(async () => {
    try {
      const auth = await fetchAuthoritativeBalance();
      if (auth && typeof auth.navUsd === 'number' && auth.navUsd > 0) {
        const isInitialAuthSync = authoritativeNavRef.current === 100000;
        authoritativeNavRef.current = auth.navUsd;

        // Populate initial Swarm signals strictly using verified CLI NAV if buffer is empty
        if (isInitialAuthSync) {
          const initialMarkets = marketsRef.current;
          const initialSigs: RawSignal[] = [];
          const now = Date.now();
          for (let t = 8; t >= 1; t--) {
            const sigs = generateSwarmSignals(strategiesRef.current, initialMarkets, t, auth.navUsd);
            sigs.forEach((s, idx) => {
              s.timestamp = now - (t * 2400) + (idx * 150);
              initialSigs.push(s);
            });
          }
          setSignals(initialSigs.slice(0, 30));
        }

        setPortfolio((prev) => {
          const cliPositions: Position[] = (auth.positions || []).map((pos: any) => ({
            symbol: pos.pair || 'BTC/USD',
            direction: (pos.type === 'buy' || pos.type === 'LONG') ? 'LONG' : 'SHORT',
            quantity: Number(pos.vol) || Number(pos.quantity) || 0,
            entryPrice: Number(pos.entry_price) || Number(pos.price) || 0,
            currentPrice: Number(pos.current_price) || Number(pos.entry_price) || 0,
            unrealizedPnl: Number(pos.unrealized_pnl) || 0,
            unrealizedPnlPct: Number(pos.unrealized_pnl_pct) || 0,
            allocatedUsd: Number(pos.cost) || (Number(pos.vol) * Number(pos.entry_price)) || 0,
            openedAt: pos.time || Date.now(),
            strategyId: 'kraken_cli_authoritative',
            stopLossPrice: 0,
            takeProfitPrice: 0,
          }));

          return {
            ...prev,
            cashUsd: auth.cashUsd,
            realizedPnl: auth.realizedPnl,
            unrealizedPnl: auth.unrealizedPnl,
            navUsd: auth.navUsd,
            peakNav: Math.max(prev.peakNav, auth.navUsd),
            positions: cliPositions.length > 0 ? cliPositions : prev.positions,
          };
        });

        setEquityHistory((prevHist) => [
          ...prevHist.slice(-50),
          { timestamp: Date.now(), nav: auth.navUsd },
        ]);
      }
    } catch (e) {
      // Background sync silent fallback
    }
  }, []);

  // Initial and periodic authoritative balance sync (eliminates homemade split-brain)
  useEffect(() => {
    syncAuthoritativeBalance();
    const timer = setInterval(syncAuthoritativeBalance, 8000);
    return () => clearInterval(timer);
  }, [syncAuthoritativeBalance]);

  // Main High-Frequency Loop: Swarm -> The Judge -> Market Execution Slicer
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      tickCountRef.current += 1;
      setTickCount(tickCountRef.current);

      // Determine current active market prices: STRICTLY prioritize Kraken WS ticker data
      // Lock any Kraken pairs from synthetic drift to preserve absolute price parity
      const lockedSymbols = kraken.isRealKrakenData
        ? Object.keys(kraken.markets)
        : ['BTC/USD', 'ETH/USD', 'SOL/USD'];

      let currentM: Record<string, OrderbookData>;
      if (kraken.isRealKrakenData) {
        currentM = prioritizeKrakenMarketData(marketsRef.current, kraken.markets, true);
        setMarkets(currentM);
      } else {
        const drifted = simulateTick(marketsRef.current, lockedSymbols);
        currentM = prioritizeKrakenMarketData(drifted, kraken.markets, kraken.isRealKrakenData);
        setMarkets(currentM);
      }

      const activeStrategies = strategiesRef.current;
      const activeConfig = judgeConfigRef.current;

      // Mark-to-market revaluation
      setPortfolio((prevPort) => {
        const revaluedPort = recalculatePortfolio(prevPort, currentM);

        // Emit Swarm speculative hypotheses strictly sized by authoritative CLI kraken balance navUsd
        const authNav = authoritativeNavRef.current > 0 ? authoritativeNavRef.current : (prevPort.navUsd > 0 ? prevPort.navUsd : 100000);
        const newSignals = generateSwarmSignals(activeStrategies, currentM, tickCountRef.current, authNav);

        if (newSignals.length > 0) {
          setSignals((prevSigs) => [...newSignals, ...prevSigs].slice(0, 50));

          // Adjudicate all emitted signals via The Judge (M8-Gate) strictly using authoritative kraken balance navUsd
          let runningPortfolio = {
            ...revaluedPort,
            navUsd: authNav,
          };
          const newVerdicts: JudgeVerdict[] = [];
          const newOrders: ExecutionOrder[] = [];

          for (const sig of newSignals) {
            const strat = activeStrategies.find((s) => s.id === sig.strategyId);
            const book = currentM[sig.symbol] || currentM['BTC/USD'];
            const verdict = adjudicateSignal(
              sig,
              runningPortfolio,
              book,
              activeConfig,
              strat,
              authNav
            );
            newVerdicts.push(verdict);

            // If passed or scaled, execute into liquidity book
            if (verdict.status !== 'REJECTED') {
              const { updatedPortfolio, executedOrder } = executeVerdict(
                verdict,
                runningPortfolio,
                book
              );
              runningPortfolio = updatedPortfolio;
              if (executedOrder) {
                newOrders.push(executedOrder);

                // Asynchronously bridge order to native Kraken CLI Paper Execution Bridge
                executePaperBridgeOrder({
                  signalId: verdict.signalId,
                  symbol: verdict.symbol,
                  side: verdict.direction === 'LONG' ? 'buy' : 'sell',
                  sizeUsd: verdict.approvedSizeUsd,
                  price: book.lastPrice,
                  executionRoute: verdict.executionRoute,
                  strategyId: verdict.strategyId,
                  strategyName: strat?.name || verdict.strategyId,
                }).then(() => {
                  syncAuthoritativeBalance();
                }).catch(() => {
                  // Silent async bridge dispatch catch
                });
              }
            }
          }

          setVerdicts((prevV) => [...newVerdicts, ...prevV].slice(0, 50));
          if (newOrders.length > 0) {
            setOrders((prevO) => [...newOrders, ...prevO].slice(0, 50));
          }

          // Record NAV curve sample
          setEquityHistory((prevHist) => [
            ...prevHist.slice(-50),
            { timestamp: Date.now(), nav: runningPortfolio.navUsd },
          ]);

          return runningPortfolio;
        }

        return revaluedPort;
      });

      // Update established worker bots with live mark-to-market prices cleanly
      setWorkerBots((prevBots) => updateWorkerBotsWithMarket(prevBots, currentM));
    }, 1600);

    return () => clearInterval(interval);
  }, [isRunning, kraken.isRealKrakenData]);

  // Toggle Bot Activation Status
  const handleToggleBotStatus = (botId: string) => {
    setWorkerBots((prev) =>
      prev.map((b) => {
        if (b.id !== botId) return b;
        const isActive = b.status === 'active' || b.status === 'ACTIVE';
        const nextStatus = isActive ? 'paused' : 'active';
        return {
          ...b,
          status: nextStatus,
          statusText: nextStatus === 'active' ? 'Bot aktiv · Verbunden' : 'Bot pausiert',
        };
      })
    );
  };

  // Dynamically update Bot Parameters (Leverage, DCA Range)
  const handleUpdateBotParameters = (
    botId: string,
    updates: { leverage?: number; dcaRangeMin?: number; dcaRangeMax?: number }
  ) => {
    setWorkerBots((prev) =>
      prev.map((b) => {
        if (b.id !== botId) return b;
        const newLeverage = updates.leverage ?? b.leverage;
        const newDcaMin = updates.dcaRangeMin ?? b.metrics.dcaRangeMin;
        const newDcaMax = updates.dcaRangeMax ?? b.metrics.dcaRangeMax;
        return {
          ...b,
          leverage: newLeverage,
          metrics: {
            ...b.metrics,
            dcaRangeMin: newDcaMin,
            dcaRangeMax: newDcaMax,
          },
        };
      })
    );
  };

  // Add dynamically deployed Worker Bot
  const handleAddWorkerBot = (newBot: any) => {
    setWorkerBots((prev) => [newBot, ...prev]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Quant Engine Header */}
      <Header
        isRunning={isRunning}
        onToggleRunning={() => setIsRunning(!isRunning)}
        portfolio={portfolio}
        driveConnected={!!driveUser}
        driveUser={driveUser}
        onOpenDriveModal={() => setIsDriveModalOpen(true)}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        tickCount={tickCount}
        onOpenConnectionHistory={() => setIsConnectionHistoryOpen(true)}
        krakenStatus={{
          status: kraken.streamStatus,
          source: kraken.streamSource,
          latencyMs: kraken.latencyMs,
          messagesCount: kraken.messagesCount,
          onReconnect: kraken.reconnect,
          isRealData: kraken.isRealKrakenData,
          reconnectAttempt: kraken.reconnectAttempt,
          nextRetryDelayMs: kraken.nextRetryDelayMs,
          nextRetryAt: kraken.nextRetryAt,
          targetPort: kraken.targetPort,
        }}
      />

      {/* 4 Architectural Tasks Toolbar: Kraken CLI 0.4.1 Source of Truth */}
      <KrakenFourTasksBar
        onSyncPortfolio={syncAuthoritativeBalance}
        onNavigateToTab={(tab) => setActiveTab(tab)}
      />

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'judge' && (
          <JudgeGateView
            verdicts={verdicts}
            config={judgeConfig}
            onUpdateConfig={setJudgeConfig}
            portfolio={portfolio}
            onInjectTestSignal={handleInjectTestSignal}
          />
        )}

        {activeTab === 'swarm' && (
          <SwarmView
            strategies={strategies}
            signals={signals}
            onUpdateWeights={handleUpdateStrategyWeight}
            workerBots={workerBots}
            onToggleBotStatus={handleToggleBotStatus}
            onNavigateToBotsTab={() => setActiveTab('bots')}
          />
        )}

        {activeTab === 'bots' && (
          <WorkerBotsView
            bots={workerBots}
            onToggleBotStatus={handleToggleBotStatus}
            onUpdateParameters={handleUpdateBotParameters}
            onAddBot={handleAddWorkerBot}
          />
        )}

        {activeTab === 'portfolio' && (
          <PortfolioView
            portfolio={portfolio}
            orders={orders}
            onClosePosition={handleClosePosition}
            equityHistory={equityHistory}
          />
        )}

        {activeTab === 'kraken-cli' && <KrakenCliView />}

        {activeTab === 'orderbook' && (
          <OrderbookView
            markets={activeMarkets}
            onOpenConnectionHistory={() => setIsConnectionHistoryOpen(true)}
            krakenStatus={{
              status: kraken.streamStatus,
              source: kraken.streamSource,
              latencyMs: kraken.latencyMs,
              messagesCount: kraken.messagesCount,
              lastTickTime: kraken.lastTickTime,
              onReconnect: kraken.reconnect,
              isRealData: kraken.isRealKrakenData,
              reconnectAttempt: kraken.reconnectAttempt,
              nextRetryDelayMs: kraken.nextRetryDelayMs,
            }}
          />
        )}

        {activeTab === 'blueprint' && (
          <BlueprintDocsView
            driveFiles={driveFiles}
            driveConnected={!!driveUser}
            isLoadingDrive={isLoadingDrive}
            onRefreshDrive={() => performDriveSearch('OMEGA NIO')}
            onOpenDriveModal={() => setIsDriveModalOpen(true)}
            onSelectDriveFile={(f) => handleSelectDriveFile(f)}
            selectedFileContent={selectedFileContent}
            selectedFile={selectedDriveFile}
          />
        )}
      </main>

      {/* Google Drive Blueprint Synchronization Modal */}
      <DriveBlueprintModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        user={driveUser}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleGoogleSignOut}
        onSearch={(q) => performDriveSearch(q)}
        driveFiles={driveFiles}
        isLoading={isLoadingDrive}
        error={driveError}
        onSelectFile={(file) => {
          handleSelectDriveFile(file);
          setActiveTab('blueprint');
        }}
      />

      {/* WebSocket Port 1000 Connection History & Telemetry Modal */}
      <ConnectionHistoryModal
        isOpen={isConnectionHistoryOpen}
        onClose={() => setIsConnectionHistoryOpen(false)}
        events={kraken.connectionHistory}
        onClearHistory={kraken.clearConnectionHistory}
        onReconnect={kraken.reconnect}
        targetPort={kraken.targetPort}
        currentStatus={kraken.streamStatus}
        streamSource={kraken.streamSource}
        reconnectAttempt={kraken.reconnectAttempt}
        nextRetryDelayMs={kraken.nextRetryDelayMs}
        nextRetryAt={kraken.nextRetryAt}
      />
    </div>
  );
}
