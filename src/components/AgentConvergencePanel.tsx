import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Cpu,
  Lock,
  Play,
  RefreshCw,
  Shield,
  Volume2,
  Zap,
} from 'lucide-react';
import {
  AgentConvergenceDecision,
  AgentConvergenceState,
  AgentExecutionConfig,
  AgentStance,
  AgentVote,
} from '../types/terminal';

interface AgentConvergencePanelProps {
  mode: 'STUDIO' | 'TERMINAL';
  state: AgentConvergenceState;
  activeSymbol: string;
  isEvaluating: boolean;
  errorMsg: string | null;
  onEvaluateNow: () => void;
  onSelectSymbol: (symbol: string) => void;
  onSpeakDebate: (decision: AgentConvergenceDecision) => void;
  onSpeakVote: (vote: AgentVote, symbol: string) => void;
  onUpdateConfig?: (patch: Partial<AgentExecutionConfig>) => void;
}

function getStanceColor(stance: AgentStance): string {
  switch (stance) {
    case 'LONG':
      return 'text-[#089981] border-[#089981]/50 bg-[#089981]/10';
    case 'SHORT':
      return 'text-[#F23645] border-[#F23645]/50 bg-[#F23645]/10';
    case 'VETO':
      return 'text-[#F59E0B] border-[#F59E0B]/60 bg-[#F59E0B]/15';
    default:
      return 'text-[#8B95A5] border-[#263042] bg-[#07090E]';
  }
}

export const AgentConvergencePanel: React.FC<AgentConvergencePanelProps> = ({
  mode,
  state,
  activeSymbol,
  isEvaluating,
  errorMsg,
  onEvaluateNow,
  onSelectSymbol,
  onSpeakDebate,
  onSpeakVote,
  onUpdateConfig,
}) => {
  const latest = state.latest;
  const config = state.config;
  const isTerminal = mode === 'TERMINAL';

  const fixedCorsetVotes = latest
    ? latest.votes.filter((v) => v.group === 'RISK_CORSET')
    : [];
  const adaptiveVotes = latest
    ? latest.votes.filter((v) => v.group === 'ADAPTIVE')
    : [];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15] overflow-y-auto p-3 space-y-3">
      {/* 1. Top Synthesis Header Bar */}
      <div className="bg-[#07090E] border border-[#263042] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 text-[#00E5FF]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#E6EDF3]">
              HYBRID 5-AGENTEN KONVERGENZ
            </span>
          </div>

          <span className="text-[10px] font-mono text-[#8B95A5] tabular-nums">
            FOKUS:{' '}
            <strong className="text-[#00E5FF]">{latest?.context.symbol || activeSymbol}</strong>
          </span>

          {latest && (
            <>
              <span
                className={`px-2 py-0.5 text-[10px] font-mono font-bold tabular-nums border ${
                  latest.convergencePct >= config.minConvergencePct && !latest.riskCorsetVetoed
                    ? 'border-[#089981]/60 bg-[#089981]/15 text-[#089981]'
                    : latest.riskCorsetVetoed
                    ? 'border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B]'
                    : 'border-[#263042] bg-[#0C1118] text-[#8B95A5]'
                }`}
              >
                KONVERGENZ: {latest.convergencePct}% · {latest.consensusDirection}
              </span>

              <span
                className={`px-2 py-0.5 text-[10px] font-mono font-bold border flex items-center gap-1 ${
                  latest.riskCorsetVetoed
                    ? 'border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B]'
                    : 'border-[#089981]/40 bg-[#089981]/10 text-[#089981]'
                }`}
              >
                {latest.riskCorsetVetoed ? (
                  <>
                    <Lock className="w-3 h-3" />
                    <span>RISIKO-KORSETT: VETO</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-3 h-3" />
                    <span>RISIKO-KORSETT: FREI</span>
                  </>
                )}
              </span>

              <span className="text-[10px] font-mono text-[#8B95A5] tabular-nums">
                ~{latest.context.estTokens} Tok · {latest.totalLatencyMs} ms · {latest.trigger}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {latest && (
            <button
              type="button"
              onClick={() => onSpeakDebate(latest)}
              className="px-2.5 py-1 bg-[#0C1118] border border-[#263042] hover:border-[#00E5FF] text-[#00E5FF] text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Volume2 className="w-3 h-3" />
              <span>DEBATTE VORLESEN</span>
            </button>
          )}
          <button
            type="button"
            disabled={isEvaluating}
            onClick={onEvaluateNow}
            className="px-2.5 py-1 bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/60 disabled:opacity-50 text-[#00E5FF] text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            {isEvaluating ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <span>{isEvaluating ? 'ANALYSE LÄUFT...' : 'JETZT ANALYSIEREN'}</span>
          </button>
        </div>
      </div>

      {/* Error State Banner */}
      {errorMsg && (
        <div className="px-3 py-2 bg-[#F23645]/10 border border-[#F23645]/50 text-[#F23645] text-xs font-mono flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 2. Pure Teleprompter Script-Feed Context Strip */}
      {latest && (
        <div className="bg-[#0C1118] border border-[#263042] px-3 py-2 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-[#8B95A5]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#00E5FF] font-bold uppercase flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                <span>REINER TELEPROMPTER-KONTEXT</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                PX:{' '}
                <strong className="text-[#E6EDF3]">
                  ${latest.context.price >= 100 ? latest.context.price.toFixed(2) : latest.context.price.toFixed(4)}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  latest.context.change24hPct >= 0 ? 'text-[#089981]' : 'text-[#F23645]'
                }
              >
                24H: {latest.context.change24hPct >= 0 ? '+' : ''}
                {latest.context.change24hPct.toFixed(2)}%
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  latest.context.rvol >= 2.0 ? 'text-[#F59E0B] font-bold' : 'text-[#E6EDF3]'
                }
              >
                RVOL: {latest.context.rvol.toFixed(2)}x
              </span>
              <span aria-hidden="true">·</span>
              <span>F&amp;G: {latest.context.fearAndGreedIndex}</span>
            </div>
            <span className="text-[#566173]">{latest.timeFormatted}</span>
          </div>
          <div className="text-[11px] text-[#E6EDF3] leading-snug">
            {latest.context.rawScriptText}
          </div>
          {latest.context.macroHeadline && (
            <div className="text-[10px] font-mono text-[#8B95A5]">
              MAKRO-KATALYSATOR: {latest.context.macroHeadline}
            </div>
          )}
        </div>
      )}

      {/* 3. Concrete Setup Output (Entry / Stop-Loss / Take-Profit / R:R) */}
      {latest && latest.tradeSetup ? (
        <div className="bg-[#07090E] border border-[#263042] px-3 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-xs">
            <button
              type="button"
              onClick={() => onSelectSymbol(latest.tradeSetup!.symbol)}
              className="px-2 py-0.5 bg-[#00E5FF]/15 border border-[#00E5FF]/50 text-[#00E5FF] font-bold hover:bg-[#00E5FF]/25 whitespace-nowrap shrink-0"
            >
              {latest.tradeSetup.symbol}
            </button>
            <span
              className={`px-2 py-0.5 font-bold border flex items-center gap-1 ${
                latest.tradeSetup.direction === 'LONG'
                  ? 'border-[#089981]/60 bg-[#089981]/15 text-[#089981]'
                  : 'border-[#F23645]/60 bg-[#F23645]/15 text-[#F23645]'
              }`}
            >
              {latest.tradeSetup.direction === 'LONG' ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              <span>{latest.tradeSetup.direction}</span>
            </span>
            <span>
              <span className="text-[#8B95A5] text-[10px]">ENTRY </span>
              <strong className="text-[#E6EDF3]">{latest.tradeSetup.entryStr}</strong>
            </span>
            <span>
              <span className="text-[#8B95A5] text-[10px]">SL </span>
              <strong className="text-[#F23645]">{latest.tradeSetup.stopLossStr}</strong>
            </span>
            <span>
              <span className="text-[#8B95A5] text-[10px]">TP </span>
              <strong className="text-[#089981]">{latest.tradeSetup.takeProfitStr}</strong>
            </span>
            <span>
              <span className="text-[#8B95A5] text-[10px]">R:R </span>
              <strong className="text-[#00E5FF]">{latest.tradeSetup.riskRewardStr}</strong>
            </span>
            <span>
              <span className="text-[#8B95A5] text-[10px]">SIZE CAP </span>
              <strong className="text-[#E6EDF3]">
                {latest.tradeSetup.suggestedSizePct.toFixed(1)}%
              </strong>
            </span>
          </div>

          {isTerminal && latest.executionRecord && (
            <div
              className={`px-2 py-0.5 text-[10px] font-mono border flex items-center gap-1 ${
                latest.executionRecord.status === 'EXECUTED'
                  ? 'border-[#089981]/60 bg-[#089981]/15 text-[#089981]'
                  : latest.executionRecord.status === 'BLOCKED'
                  ? 'border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#F59E0B]'
                  : 'border-[#263042] bg-[#0C1118] text-[#8B95A5]'
              }`}
            >
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>
                PAPER BOOK: {latest.executionRecord.status} · {latest.executionRecord.reason}
              </span>
            </div>
          )}
        </div>
      ) : latest ? (
        <div className="bg-[#07090E] border border-[#263042] px-3 py-2 text-[11px] font-mono text-[#F59E0B] flex items-center justify-between gap-2">
          <span>
            {latest.vetoReason ||
              `Konvergenz (${latest.convergencePct}%) unter Schwelle (${config.minConvergencePct}%) oder uneindeutige Richtung — kein Trade-Setup ausgegeben.`}
          </span>
          {isTerminal && latest.executionRecord && (
            <span className="text-[10px] text-[#8B95A5] shrink-0">
              [{latest.executionRecord.status}]
            </span>
          )}
        </div>
      ) : null}

      {/* 4. Terminal-Only Risk-Capped Paper Auto-Execution Config Bar */}
      {isTerminal && onUpdateConfig && (
        <div className="bg-[#07090E] border border-[#263042] px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono tabular-nums">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({ autoExecuteEnabled: !config.autoExecuteEnabled })
              }
              className={`px-2 py-1 border font-bold uppercase whitespace-nowrap shrink-0 ${
                config.autoExecuteEnabled
                  ? 'border-[#089981] bg-[#089981]/15 text-[#089981]'
                  : 'border-[#263042] bg-[#0C1118] text-[#8B95A5]'
              }`}
            >
              AUTO-PAPER EXECUTION: {config.autoExecuteEnabled ? 'AN' : 'AUS'}
            </button>

            <label className="flex items-center gap-1.5 text-[#8B95A5]">
              <span>MIN KONVERGENZ %</span>
              <input
                type="number"
                min={55}
                max={95}
                step={5}
                value={config.minConvergencePct}
                onChange={(e) =>
                  onUpdateConfig({ minConvergencePct: Number(e.target.value) })
                }
                className="w-14 bg-[#0C1118] border border-[#263042] px-1.5 py-0.5 text-[#00E5FF] font-bold"
              />
            </label>

            <label className="flex items-center gap-1.5 text-[#8B95A5]">
              <span>MAX RISIKO %</span>
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={config.maxRiskPctPerTrade}
                onChange={(e) =>
                  onUpdateConfig({ maxRiskPctPerTrade: Number(e.target.value) })
                }
                className="w-14 bg-[#0C1118] border border-[#263042] px-1.5 py-0.5 text-[#00E5FF] font-bold"
              />
            </label>

            <label className="flex items-center gap-1.5 text-[#8B95A5]">
              <span>COOLDOWN (S)</span>
              <input
                type="number"
                min={60}
                max={3600}
                step={60}
                value={config.cooldownSecPerSymbol}
                onChange={(e) =>
                  onUpdateConfig({ cooldownSecPerSymbol: Number(e.target.value) })
                }
                className="w-16 bg-[#0C1118] border border-[#263042] px-1.5 py-0.5 text-[#E6EDF3] font-bold"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => onUpdateConfig({ autoSpeakDebate: !config.autoSpeakDebate })}
            className={`px-2 py-1 border font-bold uppercase whitespace-nowrap shrink-0 ${
              config.autoSpeakDebate
                ? 'border-[#00E5FF]/60 bg-[#00E5FF]/15 text-[#00E5FF]'
                : 'border-[#263042] bg-[#0C1118] text-[#8B95A5]'
            }`}
          >
            DEBATTE ON-AIR: {config.autoSpeakDebate ? 'AN' : 'AUS'}
          </button>
        </div>
      )}

      {/* 5. Five Strictly Isolated Agent Personas (Fixed Risk Corset 3 + Adaptive 2) */}
      {!latest ? (
        <div className="bg-[#07090E] border border-[#263042] p-6 text-center space-y-2">
          <div className="text-xs font-mono text-[#E6EDF3] font-semibold">
            Noch keine Multi-Agenten-Konvergenz für {activeSymbol} ausgewertet.
          </div>
          <p className="text-[11px] text-[#8B95A5] max-w-xl mx-auto">
            Klicke auf „JETZT ANALYSIEREN“ oder warte auf den nächsten Teleprompter-/RVOL-Impuls,
            um alle 5 isolierten Agenten-Personas parallel über den reinen Skript-Kontext abstimmen zu lassen.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Group A: Festes Risiko-Korsett (3 Agents) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#8B95A5] px-0.5">
              <span className="flex items-center gap-1.5 text-[#00E5FF] font-bold">
                <Shield className="w-3 h-3" />
                <span>FESTES RISIKO-KORSETT (3 ISOLIERTE AGENTEN)</span>
              </span>
              <span>Kapitalschutz · Plausibilitätsprüfung · Extremwert-Bremse</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
              {fixedCorsetVotes.map((vote) => (
                <AgentPersonaCard
                  key={vote.agentId}
                  vote={vote}
                  symbol={latest.context.symbol}
                  onSpeakVote={onSpeakVote}
                />
              ))}
            </div>
          </div>

          {/* Group B: Adaptive Markt-Parteien (2 Agents) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#8B95A5] px-0.5">
              <span className="flex items-center gap-1.5 text-[#F97316] font-bold">
                <Zap className="w-3 h-3" />
                <span>ADAPTIVE MARKT-PARTEIEN (2 ISOLIERTE AGENTEN)</span>
              </span>
              <span>Momentum-Breakout · Event-Volatilität</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {adaptiveVotes.map((vote) => (
                <AgentPersonaCard
                  key={vote.agentId}
                  vote={vote}
                  symbol={latest.context.symbol}
                  onSpeakVote={onSpeakVote}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. Terminal-Only Auto-Execution Audit Ledger & Recent History */}
      {isTerminal && state.executions.length > 0 && (
        <div className="bg-[#07090E] border border-[#263042] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between border-b border-[#1B2230] pb-1 text-[10px] font-mono uppercase">
            <span className="font-bold text-[#089981] flex items-center gap-1.5">
              <Activity className="w-3 h-3" />
              <span>RISIKO-GEDECKELTES PAPER-EXECUTION PROTOKOLL</span>
            </span>
            <span className="text-[#8B95A5]">{state.executions.length} EINTRÄGE</span>
          </div>
          <div className="overflow-x-auto max-h-36">
            <table className="w-full text-left border-collapse font-mono tabular-nums text-[10px]">
              <thead className="text-[#8B95A5] uppercase border-b border-[#1B2230]">
                <tr>
                  <th className="py-1 pr-2">ZEIT</th>
                  <th className="py-1 pr-2">SYMBOL</th>
                  <th className="py-1 pr-2">RICHTUNG</th>
                  <th className="py-1 pr-2 text-right">ENTRY / SL / TP</th>
                  <th className="py-1 pr-2 text-right">KOSTEN ($)</th>
                  <th className="py-1 pr-2">STATUS</th>
                  <th className="py-1">BEGRÜNDUNG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1B2230]/50">
                {state.executions.slice(0, 10).map((ex) => (
                  <tr key={ex.id} className="hover:bg-[#0C1118]">
                    <td className="py-1 pr-2 text-[#8B95A5]">{ex.timeFormatted}</td>
                    <td
                      onClick={() => onSelectSymbol(ex.symbol)}
                      className="py-1 pr-2 font-bold text-[#00E5FF] cursor-pointer hover:underline"
                    >
                      {ex.symbol}
                    </td>
                    <td
                      className={`py-1 pr-2 font-bold ${
                        ex.direction === 'LONG' ? 'text-[#089981]' : 'text-[#F23645]'
                      }`}
                    >
                      {ex.direction}
                    </td>
                    <td className="py-1 pr-2 text-right text-[#E6EDF3]">
                      ${ex.price >= 100 ? ex.price.toFixed(2) : ex.price.toFixed(4)} / $
                      {ex.stopLoss >= 100 ? ex.stopLoss.toFixed(2) : ex.stopLoss.toFixed(4)} / $
                      {ex.takeProfit >= 100 ? ex.takeProfit.toFixed(2) : ex.takeProfit.toFixed(4)}
                    </td>
                    <td className="py-1 pr-2 text-right text-[#E6EDF3]">
                      ${ex.costUsd.toFixed(2)}
                    </td>
                    <td
                      className={`py-1 pr-2 font-bold ${
                        ex.status === 'EXECUTED'
                          ? 'text-[#089981]'
                          : ex.status === 'BLOCKED'
                          ? 'text-[#F59E0B]'
                          : 'text-[#8B95A5]'
                      }`}
                    >
                      {ex.status}
                    </td>
                    <td className="py-1 text-[#8B95A5]">{ex.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface AgentPersonaCardProps {
  vote: AgentVote;
  symbol: string;
  onSpeakVote: (vote: AgentVote, symbol: string) => void;
}

const AgentPersonaCard: React.FC<AgentPersonaCardProps> = ({
  vote,
  symbol,
  onSpeakVote,
}) => {
  return (
    <div className="bg-[#07090E] border border-[#263042] p-2.5 flex flex-col justify-between gap-2">
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#E6EDF3] truncate">
              {vote.agentName}
            </div>
            <div className="text-[9px] font-mono text-[#8B95A5] tabular-nums">
              {vote.group === 'RISK_CORSET' ? 'KORSETT' : 'ADAPTIV'} · Stimme: {vote.googleVoice} ·{' '}
              {vote.latencyMs} ms
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums border ${getStanceColor(
                vote.stance
              )}`}
            >
              {vote.stance} {vote.confidence}%
            </span>
            <button
              type="button"
              onClick={() => onSpeakVote(vote, symbol)}
              title={`${vote.agentName} jetzt mit eigener Stimme (${vote.googleVoice}) anhören`}
              className="p-1 bg-[#0C1118] border border-[#263042] hover:border-[#00E5FF] text-[#8B95A5] hover:text-[#00E5FF]"
            >
              <Volume2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        <p className="text-[11px] text-[#E6EDF3] leading-snug">{vote.thesis}</p>
      </div>

      <div className="pt-1.5 border-t border-[#1E2634] flex items-center justify-between gap-2 text-[10px] font-mono text-[#8B95A5]">
        <span className="truncate">{vote.riskNote}</span>
        <span className="text-[9px] text-[#566173] shrink-0 uppercase">
          {vote.generatedBy === 'gemini' ? 'Gemini' : 'Quant'}
        </span>
      </div>
    </div>
  );
};
