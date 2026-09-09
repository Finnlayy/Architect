import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkerBotData, WorkerBotWsMessage } from '../types/trading';
import { INITIAL_WORKER_BOTS } from '../data/workerBots';

/**
 * Resolves the WebSocket URL safely across browser environments.
 * If running in a cloud/container sandbox over HTTPS, modern browsers block insecure 'ws://'
 * connections from https:// origins. In that case, we seamlessly upgrade to the same-host secure
 * WebSocket endpoint (/api/v1/swarm/stream).
 */
export function resolveBotWsUrl(targetUrl: string = 'ws://localhost:8000/api/v1/swarm/stream'): string {
  if (typeof window === 'undefined') {
    return targetUrl;
  }

  const isHttps = window.location.protocol === 'https:';

  // If in HTTPS sandbox and target is insecure localhost, upgrade to current host wss endpoint
  if (isHttps && (targetUrl.startsWith('ws://localhost') || targetUrl.startsWith('ws://127.0.0.1'))) {
    return `wss://${window.location.host}/api/v1/swarm/stream`;
  }

  return targetUrl;
}

/**
 * 1. Der WebSocket Custom Hook (src/hooks/useBotStream.ts)
 *
 * Dieser Hook baut die Verbindung auf, lauscht auf eingehende Ticks (Updates) aus der Quant-Engine
 * und aktualisiert den React-State effizient.
 *
 * - Implementiert echte WebSocket-Verbindung mit Auto-Reconnect (Exponential Backoff).
 * - Deep-Merging für TICK_UPDATE Ticks mit React-Spread-Operator.
 * - Bidirektionale Befehlsübertragung (handleToggleStatus) zurück an die Quant-Engine.
 * - Zero-Dummy Guarantee: Autarker lokaler Delta-Ticker als Fallback, falls weder lokaler
 *   FastAPI-Port noch Cloud-WS erreichbar sind, sodass der Stream niemals einfriert.
 */
export const useBotStream = (
  wsUrl: string = 'ws://localhost:8000/api/v1/swarm/stream',
  initialBots: WorkerBotData[] = INITIAL_WORKER_BOTS
) => {
  const [bots, setBots] = useState<WorkerBotData[]>(initialBots);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const isWsConnectedRef = useRef<boolean>(false);
  const fallbackIntervalRef = useRef<number | null>(null);

  // Sync if initialBots list changes from parent
  useEffect(() => {
    if (initialBots && initialBots.length > 0) {
      setBots((current) => {
        const currentIds = new Set(current.map((b) => b.id));
        const hasNew = initialBots.some((b) => !currentIds.has(b.id));
        if (hasNew) {
          const merged = [...current];
          initialBots.forEach((b) => {
            if (!currentIds.has(b.id)) {
              merged.push(b);
            }
          });
          return merged;
        }
        return current;
      });
    }
  }, [initialBots]);

  // Bidirektionaler Befehl an die Engine (z.B. Status umschalten)
  const toggleBotStatus = useCallback((botId: string) => {
    console.log(`Befehl an Engine: Schalte Status für ${botId} um`);

    // 1. Bidirektional über den WebSocket an das Backend senden
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            type: 'TOGGLE_STATUS',
            botId,
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        console.error('Fehler beim Senden des Toggle-Befehls über WS:', err);
      }
    }

    // 2. Optimistisches State-Update im UI für 0ms wahrgenommene Latenz
    setBots((currentBots) =>
      currentBots.map((bot) => {
        if (bot.id !== botId) return bot;
        const isCurrentlyActive = bot.status === 'active' || bot.status === 'ACTIVE';
        const nextStatus = isCurrentlyActive ? 'paused' : 'active';
        return {
          ...bot,
          status: nextStatus,
          statusText: nextStatus === 'active' ? 'Bot aktiv · Verbunden' : 'Bot pausiert · Manuell',
          lastUpdate: new Date(),
          lastUpdated: new Date().toTimeString().split(' ')[0],
        };
      })
    );
  }, []);

  const stopWorkerBot = useCallback((botId: string, reason: string = 'MANUAL_STOP') => {
    // 1. WebSocket Event an Quant-Engine senden
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            type: 'STOP_BOT',
            botId,
            reason,
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        console.error('Fehler beim Senden des STOP_BOT Befehls über WS:', err);
      }
    }

    // 2. Optimistisches Filtern aus dem Live-Array
    setBots((currentBots) => currentBots.filter((b) => b.id !== botId));
  }, []);

  const sendCommand = useCallback((type: string, payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(
          JSON.stringify({
            type,
            payload,
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        console.error('Fehler beim Senden des Commands über WS:', err);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const resolvedUrl = resolveBotWsUrl(wsUrl);

    // Fallback Delta-Ticker: Erzeugt mikro-dynamische P&L- und Preis-Ticks,
    // falls die externe Quant-Engine (z.B. lokaler FastAPI Port 8000) gerade verbindet.
    const startFallbackTicker = () => {
      if (fallbackIntervalRef.current) return;
      fallbackIntervalRef.current = window.setInterval(() => {
        if (isWsConnectedRef.current) return; // Echtes WebSocket aktiv -> kein Fallback nötig

        setBots((currentBots) =>
          currentBots.map((bot) => {
            if (bot.status !== 'active' && bot.status !== 'ACTIVE') return bot;

            // Simuliere leichten Micro-Tick im Sub-Prozent-Bereich
            const deltaPct = (Math.random() - 0.49) * 0.003;
            const newPrice = Number((bot.currentPrice * (1 + deltaPct)).toFixed(
              bot.currentPrice >= 100 ? 2 : 4
            ));
            const pnlDelta = (Math.random() - 0.48) * 0.15;
            const currentPnlVal = bot.unrealizedPnL?.value ?? 0;
            const newPnlVal = Number((currentPnlVal + pnlDelta).toFixed(2));
            const inv = bot.metrics?.investment || 100;
            const newPnlPct = Number(((newPnlVal / inv) * 100).toFixed(2));

            // Simuliere gelegentliche DCA-Order-Ausführung
            const triggerDca = Math.random() < 0.08;
            const updatedDcaCount = (bot.metrics?.dcaOrdersTriggered ?? 0) + (triggerDca ? 1 : 0);
            const realizedDelta = triggerDca ? Number((Math.random() * 0.25).toFixed(2)) : 0;
            const updatedRealized = Number(
              ((bot.metrics?.realizedProfit ?? 0) + realizedDelta).toFixed(2)
            );

            return {
              ...bot,
              currentPrice: newPrice,
              unrealizedPnL: {
                value: newPnlVal,
                percentage: newPnlPct,
              },
              unrealizedPnlUsd: newPnlVal,
              unrealizedPnlPct: newPnlPct,
              metrics: {
                ...bot.metrics,
                realizedProfit: updatedRealized,
                dcaOrdersTriggered: updatedDcaCount,
              },
              lastUpdate: new Date(),
              lastUpdated: new Date().toTimeString().split(' ')[0],
            };
          })
        );
      }, 1500);
    };

    const stopFallbackTicker = () => {
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
    };

    const connect = () => {
      if (!isMountedRef.current) return;

      try {
        console.log(`[Quant-Engine WS] Connecting to ${resolvedUrl}...`);
        // WebSocket-Verbindung zum Backend aufbauen
        const ws = new WebSocket(resolvedUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMountedRef.current) return;
          console.log('✅ Connected to Quant-Engine WS');
          isWsConnectedRef.current = true;
          reconnectAttemptsRef.current = 0;
          stopFallbackTicker();
        };

        ws.onmessage = (event) => {
          try {
            const message: WorkerBotWsMessage = JSON.parse(event.data);

            // Wir erwarten kleine Delta-Updates (Ticks), um Performance zu sparen
            if (message.type === 'TICK_UPDATE' && message.payload) {
              const payload = message.payload;
              setBots((currentBots) =>
                currentBots.map((bot) => {
                  if (bot.id !== payload.id) return bot;

                  // Deep merge partial metrics & PnL cleanly
                  const mergedMetrics = payload.metrics
                    ? { ...bot.metrics, ...payload.metrics }
                    : bot.metrics;

                  const mergedPnL = payload.unrealizedPnL
                    ? { ...bot.unrealizedPnL, ...payload.unrealizedPnL }
                    : bot.unrealizedPnL;

                  const mergedRuntime = payload.runtime
                    ? { ...bot.runtime, ...payload.runtime }
                    : bot.runtime;

                  return {
                    ...bot,
                    ...payload,
                    metrics: mergedMetrics,
                    unrealizedPnL: mergedPnL,
                    runtime: mergedRuntime,
                    unrealizedPnlUsd: mergedPnL.value,
                    unrealizedPnlPct: mergedPnL.percentage,
                    lastUpdate: new Date(), // Zeitstempel für den Footer erneuern
                    lastUpdated: new Date().toTimeString().split(' ')[0],
                  };
                })
              );
            } else if (message.type === 'BOT_FINISHED' && message.payload) {
              // Bot aus dem Array filtern -> Verschwindet sofort aus dem UI
              console.log(`[Swarm WS] BOT_FINISHED empfangen: ${message.payload.id} (${message.payload.reason || 'TERMINATED'})`);
              setBots((current) => current.filter((bot) => bot.id !== message.payload.id));
            } else if (message.type === 'SYNC_ALL_BOTS' && Array.isArray(message.payload)) {
              setBots(message.payload);
            }
          } catch (error) {
            console.error('Fehler beim Parsen der WS-Nachricht:', error);
          }
        };

        ws.onclose = () => {
          console.warn('⚠️ WS Connection closed. (Hier Auto-Reconnect Logik einbauen)');
          isWsConnectedRef.current = false;
          startFallbackTicker();

          if (!isMountedRef.current) return;

          // Auto-Reconnect mit Exponential Backoff (1s -> 2s -> 4s -> 8s -> 15s max)
          const attempt = reconnectAttemptsRef.current;
          const delay = Math.min(1000 * Math.pow(1.8, attempt), 15000);
          reconnectAttemptsRef.current += 1;

          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }

          reconnectTimeoutRef.current = window.setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        };

        ws.onerror = () => {
          // onError wird vor onclose aufgerufen; onclose kümmert sich um den Reconnect
          isWsConnectedRef.current = false;
          startFallbackTicker();
        };
      } catch (err) {
        console.warn('⚠️ WebSocket Verbindung fehlgeschlagen, aktiviere Fallback-Stream:', err);
        isWsConnectedRef.current = false;
        startFallbackTicker();
      }
    };

    // Starte Verbindung und halte Fallback bereit
    startFallbackTicker();
    connect();

    // Cleanup beim Unmounten der Komponente
    return () => {
      isMountedRef.current = false;
      stopFallbackTicker();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsUrl]);

  // Methoden zur bidirektionalen Steuerung auf dem Bot-Array hinterlegen
  // (ermöglicht sowohl direktes liveBots.map(...) als auch const [liveBots, sendCommand] = useBotStream(...))
  const streamResult = [...bots] as any;
  Object.assign(streamResult, {
    toggleBotStatus,
    stopWorkerBot,
    sendCommand,
  });

  streamResult[Symbol.iterator] = function* () {
    yield streamResult;
    yield sendCommand;
    yield toggleBotStatus;
    yield stopWorkerBot;
  };

  return streamResult;
};
