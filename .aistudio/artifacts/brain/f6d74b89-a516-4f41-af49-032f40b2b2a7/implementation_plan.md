# Hybrid 5-Agent Market Convergence & Multisensory Execution System

This plan introduces a parallel 5-agent hybrid trading desk that extracts pure text directly from the live Teleprompter script feed to analyze real-time market data, orderflow RVOL spikes, and macro headlines with minimal token overhead and latency. When agent convergence clears the risk-corset threshold, the system outputs concrete Entry, Stop-Loss, and Take-Profit levels, plays role-matched multisensory audio cues and distinct agent voices, and auto-executes risk-capped trades in the Paper Book.

## User Review & Critical Decisions

> [!IMPORTANT] All major placement, execution, acoustic, and evaluation triggers were confirmed during discovery. Please review the synthesized architecture below before implementation begins.

-   **Confirmed Placement**: Displayed both as a dedicated **Agent Convergence** tab inside the **TV Studio Stream** deck (market & setup view only, keeping Paper Book internals off the broadcast stream) and as a full **Agent War Room** tab in the **Main Terminal** dock (including Paper Book auto-execution controls and fill audit).
-   **Confirmed High-Convergence Execution**: Automatically executes eligible setups in the isolated **Paper Book** with strict risk caps (max per-trade capital % cap, minimum convergence % gate, fixed risk-corset veto override, per-symbol cooldown, and automatic SL/TP bracket placement respecting the 20-trade hard cap).
-   **Confirmed Multisensory Audio**: Assigns a distinct **Google Natural Voice** profile to each of the 5 agent personas (with Web Speech pitch/rate fallbacks) paired with event-mapped synthesizer market chimes (RVOL radar cue, convergence harmonic chord, risk-veto warning, and execution fill chime).
-   **Confirmed Evaluation Cadence**: Event-triggered whenever a new **Teleprompter script** updates or a qualifying **Agent Market Event** occurs (RVOL spike >= 2.0x or breaking macro/news catalyst), plus an on-demand manual trigger.

---

## 1. Overview & Core Concept

-   **What It Does**:
    -   **Pure Teleprompter Context Extractor**: Captures the live spoken script feed plus compact structured market deltas (Symbol, Price, 24h change, RVOL, Fear & Greed) as a lean, de-duplicated plain-text prompt — eliminating redundant JSON overhead to minimize token spend and inference latency.
    -   **Hybrid 5-Agent Parallel Committee**: Runs five strictly isolated personas concurrently so reasoning never cross-contaminates:
        1.  **Analytischer Stratege** *(Fixed Risk Corset)* — Enforces risk minimization, minimum R:R, stop placement, and capital limits.
        2.  **Datengetriebener Skeptiker** *(Fixed Risk Corset)* — Stress-tests every headline and spike against RVOL confirmation, orderbook depth, and bull/bear trap risk.
        3.  **Geduldiger Mean-Reversion-Händler** *(Fixed Risk Corset)* — Measures VWAP/Z-score overextension and sentiment extremes to block late chasing.
        4.  **Impulsiver Trendfolger** *(Adaptive)* — Captures high-RVOL breakout acceleration and EMA momentum continuation.
        5.  **Opportunistischer News-Trader** *(Adaptive)* — Targets event-driven volatility bursts around macro releases and breaking headlines.
    -   **Risk-Corset Convergence Engine**: Synthesizes the 5 independent stances into a single `0–100%` convergence score, consensus bias (`LONG`, `SHORT`, or `WAIT`), risk-veto verdict, and exact `Entry`, `Stop-Loss`, `Take-Profit`, and `R:R` levels.
-   **Target Audience**: Active intraday and macro-event traders monitoring multi-source orderflow in both the TV Studio Broadcast view and the Main Execution Terminal.
-   **Key Value**: Cuts LLM prompt bloat by feeding directly from the Teleprompter script stream, prevents groupthink via isolated parallel personas, and bridges real-time multi-agent consensus directly to risk-capped Paper execution and multisensory alerts.

---

## 2. User Experience & Visual Design

-   **Key User Flows**:
    1.  **Passive Event-Triggered Analysis**: As the Teleprompter broadcasts a new RVOL spike or macro headline, the pipeline extracts the pure script text, triggers a subtle acoustic radar cue, runs the 5 parallel agents, and updates the Convergence Card with token count and round-trip latency.
    2.  **Multisensory Debate Playback**: Users can enable automatic on-air convergence briefings or click individual agent speaker buttons to hear each persona read its thesis in its distinct voice (`Charon`, `Fenrir`, `Kore`, `Zephyr`, `Puck`).
    3.  **High-Convergence Execution**: When convergence clears the threshold without a Risk-Corset veto, the Terminal War Room automatically submits a risk-capped Paper order with SL/TP brackets, triggers the execution chime, and logs the trade; meanwhile the TV Studio tab shows the clean chart-clickable setup levels.
    4.  **Tuning Risk & Adaptive Balance**: Inside the Terminal War Room tab, the user configures the Convergence Threshold (`65%–95%`), Risk-per-Trade Cap (`1%–10%`), and Auto-Execution toggle.
-   **Visual Identity & Theme**:
    -   *Aesthetic Direction*: High-precision institutional broadcast desk & dark financial terminal matching the existing dark studio shell.
    -   *Color Palette & Mood*: Deep slate canvas (`#07090E`), structural panel surfaces (`#0B0F15` / `#0C1118`) with crisp `1px` borders (`#263042`), semantic accents reserved strictly for state and actions — Bullish Emerald (`#089981`), Bearish Crimson (`#F23645`), Risk-Corset Amber (`#F59E0B`), and Adaptive Cyan (`#00E5FF`).
    -   *Typography & Hierarchy*: Clean sans-serif headings paired with `tabular-nums` monospace telemetry for all prices, RVOL ratios, convergence percentages, token counts, and latencies.
    -   *Component Styling & Layout*: Flat single-elevation grid panels separated by clean `1px` borders and whitespace; static metadata rendered as quiet separator-delimited text (`·`) with zero decorative pills, pulsing dots, or thick left accent bars.
-   **Interactive Feedback & Motion**:
    -   Skeleton/analyzing state during parallel agent evaluation (`~150–400ms` visual transition), instant chart symbol jump when clicking a convergence setup, and clear veto/cooldown reason banners if an execution is blocked by the Risk Corset.

---

## 3. Key Product Decisions & Trade-Offs

-   **Decision 1: Pure Teleprompter Script Extraction Over Full Terminal State Dumps**
    -   *Chosen Approach*: Distill only the active Teleprompter script text plus a 1-line market header (`Symbol | Price | 24h% | RVOL | VWAP/Z-Score | F&G`) into a compact plain-text context block (~120–180 tokens) shared read-only across the 5 parallel agent calls.
    -   *Why*: Minimizes input tokens, slashes LLM response latency for time-sensitive breakouts, and ensures agents reason over the exact narrative the operator is hearing.
    -   *Alternatives Considered*: Passing full orderbook arrays, 300 candles, and full news HTML per agent (5x–10x higher token cost and multi-second latency).
-   **Decision 2: Strictly Isolated Parallel Calls + Deterministic Risk-Corset Aggregation**
    -   *Chosen Approach*: Run the 5 agent prompts concurrently via `Promise.all` with zero shared chain-of-thought between agents, then compute the final convergence score, Risk-Corset veto check, and geometric ATR/price Entry-SL-TP synthesis in a deterministic server aggregator.
    -   *Why*: Guarantees reasoning independence (Skeptic cannot be swayed by Trend-Follower's tone) while keeping SL/TP math exact, bounded, and hallucination-free.
    -   *Alternatives Considered*: Single multi-persona prompt or sequential round-robin debate (causes persona bleed and multiplies latency).
-   **Decision 3: Strict Broadcast Isolation vs. Full Terminal Execution**
    -   *Chosen Approach*: Auto-execution into the isolated Paper Book runs via the Main Terminal War Room policy and `/api/kraken/cli/paper-bridge/execute` + bracket endpoints, while the TV Studio Stream tab displays only live market convergence and trade levels.
    -   *Why*: Preserves the broadcast stream's strict separation from Paper Book balances/fills while delivering full automated Paper execution in the terminal.

---

## 4. Technical Architecture & Data Strategy

-   **System Architecture & Data Flow**:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ LIVE INPUTS: Teleprompter Script Feed + Screener RVOL + Macro/News/CMC    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Pure Script-Context Extractor (Minimal Tokens)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ SERVER CONVERGENCE ENGINE (5 Parallel Isolated Gemini Calls)              │
│  ┌──────────────── Fixed Risk Corset ─────────────────┐  ┌── Adaptive ──┐ │
│  │ 1. Strategist  │ 2. Skeptic  │ 3. Mean-Reversion   │  │ 4. Trend     │ │
│  │ (Charon)       │ (Kore)      │ (Zephyr)            │  │    (Fenrir)  │ │
│  │                │             │                     │  │ 5. News      │ │
│  │                │             │                     │  │    (Puck)    │ │
│  └────────────────┴─────────────┴─────────────────────┘  └──────┬───────┘ │
│                                │                                │         │
│                                ▼                                ▼         │
│         Deterministic Risk-Corset Veto + Entry/SL/TP Synthesizer          │
└──────────┬───────────────────────────────────────────┬────────────────────┘
           │                                           │
           ▼                                           ▼
┌────────────────────────────────┐       ┌──────────────────────────────────┐
│ TV STUDIO STREAM TAB           │       │ TERMINAL WAR ROOM PANEL          │
│ · Clean 5-Agent Stances        │       │ · Full Debate + Risk Controls    │
│ · Convergence & Setup Levels   │       │ · Risk-Capped Paper Auto-Execute │
│ · Distinct Voice + Chime Cues  │       │ · SL/TP Brackets & Fill Ledger   │
└────────────────────────────────┘       └──────────────────────────────────┘
```

-   **Data Model & State**:
    -   `AgentPersonaId`: `'STRATEGIST' | 'TREND_FOLLOWER' | 'SKEPTIC' | 'MEAN_REVERSION' | 'NEWS_TRADER'` with static metadata defining `group` (`'RISK_CORSET' | 'ADAPTIVE'`), Google voice ID (`Charon`, `Fenrir`, `Kore`, `Zephyr`, `Puck`), Web Speech pitch/rate signature, and acoustic chime trigger.
    -   `PureTeleprompterContext`: Extracted script text, resolved symbol, spot price, 24h change, RVOL, Fear & Greed index, character count, and estimated token budget.
    -   `AgentConvergenceDecision`: Timestamp, ID, cycle trigger (`'TELEPROMPTER' | 'RVOL_SPIKE' | 'MACRO_EVENT' | 'MANUAL'`), 5 individual `AgentVote` items (`stance`, `confidence`, `thesis`, `riskNote`, `latencyMs`), `convergencePct`, `consensusDirection` (`'LONG' | 'SHORT' | 'WAIT'`), `riskCorsetVetoed`, `tradeSetup` (`symbol`, `direction`, `entryPrice`, `stopLoss`, `takeProfit`, `riskRewardRatio`), `tokensSavedNote`, and `totalLatencyMs`.
    -   `AgentExecutionConfig`: `autoExecuteEnabled`, `minConvergencePct` (default `75`), `maxRiskPctPerTrade` (default `3%`), `cooldownSecPerSymbol` (default `600s`), persisted in bounded memory/storage with strict `MAX_HISTORY = 24` memory caps.
-   **Interactive Component & State Mapping**:
    -   **Event Trigger Hook**: Watches Teleprompter active broadcasts and incoming Screener/News RVOL spikes (debounced with cooldown & symbol-state deduplication) and invokes the server convergence synthesis endpoint.
    -   **Multisensory Voice & Chime Dispatcher**: Queues distinct agent voice snippets sequentially through Google Natural Voices (using each persona's `voice` & `style` metadata) and dispatches role-matched Web Audio chimes without colliding with active voice playback.
    -   **Risk-Capped Auto-Executor**: On qualifying `LONG` convergence (or closing an open position on `SHORT` convergence) when `autoExecuteEnabled` is active, executes a bounded Paper order sized by `maxRiskPctPerTrade` and attaches SL/TP brackets immediately.
    -   **Dual UI Views**: Shares a unified convergence panel component parameterized by `mode="STUDIO" | "TERMINAL"` — hiding Paper Book execution controls/balances in `STUDIO` mode while exposing full risk/auto-execution controls and execution logs in `TERMINAL` mode.
