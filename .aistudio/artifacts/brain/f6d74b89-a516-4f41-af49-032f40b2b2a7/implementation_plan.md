# OMEGA NIO — High-Density Quant & Execution Terminal (Arcane Monitor Layout + Multi-Exchange Cascade)

Kompletter Umbau der bestehenden OMEGA-NIO-Anwendung zu einer **produktiven, hochdichten Echtzeit-Trading-, Screening- und Backtesting-Arbeitsoberfläche** im Stil des Referenzfotos (*Arcane Monitor / Finviz / Fischer*) kombiniert mit den gezielten Live-Animationen des Referenzvideos (*Pipeline-Flow, rollende Zähler, `ENTER`/`EXIT`/`FILTERED`-Protokoll*).

## User Review & Critical Decisions

> [!IMPORTANT]
> **Verbindliche System- & Architekturvorgaben aus deinem Feedback:**
> 1. **Echte 6-Stufen-Marktdaten-Kaskade (Kein „Synthetic Fallback“-Müll)**:
>    - Wenn ein Symbol oder Zeitrahmen bei **Kraken** nicht vorliegt, zieht der Backend-Data-Router die historischen OHLCV-Kerzen und Live-Kurse automatisch über die Kaskade:
>      $$\text{1. Kraken} \longrightarrow \text{2. CCXT} \longrightarrow \text{3. Gainium} \longrightarrow \text{4. Binance} \longrightarrow \text{5. Alpaca} \longrightarrow \text{6. Alpha Vantage}$$
> 2. **Automatische Scheduled Screener über alle 6 Quellen**:
>    - Alle sechs Provider (*Kraken, CCXT, Gainium, Binance, Alpaca, Alpha Vantage*) speisen den **automatisch im Schedule laufenden Multi-Source-Screener**, der kontinuierlich Symbole, RVOL-Spikes, VWAP-Crosses, Spreads und 24h-Ausbrüche aktualisiert.
> 3. **Paper-Account Startkapital exakt `1.000 $`**:
>    - Das Startkapital (`initial_balance` / `initialCapital`) des Paper-Accounts und der Strategie-Konfiguration ist standardmäßig fest auf **`$1,000.00`** eingestellt.
> 4. **Hartes Limit von maximal `20` gleichzeitigen Trades (`MAX_CONCURRENT_TRADES = 20`)**:
>    - Im gesamten System und im Sizer/M8-Gate dürfen **maximal 20 Trades gleichzeitig** offen sein (`Active Trades: X / 20`). Bei 20 offenen Trades werden weitere Entry-Signale strikt mit `FILTERED: MAX 20 TRADES REACHED` abgewiesen, bis wieder ein Slot frei wird.
> 5. **Shadow-Engine (Inverse Gegenstrategie) im Hintergrund**:
>    - Die Shadow-Engine läuft als inverse Spiegelbild-Strategie automatisch mit, ohne die Hauptoberfläche mit theoretischem Ballast zu überfrachten.

---

## 1. Overview & Core Concept

- **Was das System leistet**: Ein mehrspaltiges Echtzeit-Trading- und Backtesting-Terminal ohne jeglichen Präsentations-Ballast. Automatische Scheduled Screener scannen fortlaufend Märkte über *Kraken, CCXT, Gainium, Binance, Alpaca und Alpha Vantage*. Der Nutzer wählt per Klick ein Symbol, konfiguriert seine Strategie (Startkapital `1.000 $`, Max. `20` parallele Trades), berechnet echte OHLCV-Backtests oder lässt die Pipeline live gegen den `1.000 $` Paper-Account arbeiten.
- **Kernmehrwert**: Echte Multi-Exchange-Marktdatenabdeckung ohne künstliche Fallback-Badges, kombiniert mit der hohen Informationsdichte des *Arcane Monitor*-Rasters und dem flüssigen Pipeline-Feedback des *Grok Bot Terminals*.

---

## 2. User Experience & Visual Design

### Visuelle Architektur (Foto-Layout + Video-Dynamik)

- **Oberflächen & Farbkodierung**:
  - **Tiefschwarzes Terminal-Grid**: Hintergrund `#07090E`, Panel-Flächen `#0C1017`, aktive Kopfzeilen `#111722`, gestochen scharfe 1px-Trennlinien `#1B2230`.
  - **Semantische Signalfarben**:
    - `#089981` / `#10B981` (Smaragdgrün): Long / `EXIT` im Gewinn / Bid-Absorption / Aktive Quelle
    - `#F23645` (Karmesinrot): Short / `EXIT` im Verlust / Slot-Limit (`20/20`) / Ask-Dominanz / Emergency Kill Switch
    - `#00E5FF` (Cyan): `ENTER`-Signale / Aktive Pipeline-Stufe / Fokus-Symbol
    - `#FF9800` / `#EC4899` (Bernstein / Pink): `FILTERED` (z. B. durch `20/20 Trade Cap`, Spread-Limit oder Risiko-Gate)
- **Typografie & Zahlen-Disziplin**:
  - Kompakte Sans-Serif (`Plus Jakarta Sans` / `DM Sans`) für Panel-Titel und Steuerung (`10px`–`12px`, `whitespace-nowrap`).
  - Striktes `JetBrains Mono` mit `font-variant-numeric: tabular-nums` für alle Kurse, Volumina, RVOL, Prozentwerte, Zeitstempel und PnL-Spalten.
- **Gezielte Animationen (wie im Video)**:
  - **5-Stufen-Pipeline (`SCANNER → RISK CHECK → SIZER → EXECUTOR → LOGGER`)**: Animierter Signalfluss mit Anzeige der aktuellen Positions-Auslastung (`Slots: X / 20`) und Prozent-Allokation vom `1.000 $` Konto.
  - **Fließende Zähler**: Rollende `tabular-nums`-Zähler für Paper-Equity (startend bei `$1,000.00`), Realized/Unrealized PnL sowie Wins/Losses.
  - **Absorptions- & Auslastungs-Balken (*Beam of Absorption*)**: Flüssig animierte horizontale Balken für Orderbuch-Tiefe und aktive Trade-Slots (`0–20`).

### Durchgängiger Arbeitsablauf im Multi-Panel-Workspace

1. **Top Command & Telemetry Bar**:
   - Links: Markenkennung + Schnell-Umschalter für Symbol & Zeitrahmen (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) + aktive Datenquelle aus der Kaskade (`KRAKEN` · `CCXT` · `GAINIUM` · `BINANCE` · `ALPACA` · `ALPHA VANTAGE`) mit Zeitstempel.
   - Mitte: **Paper-Account Equity Zähler** (Basis: **`$1,000.00`**), Win/Loss-Verhältnis, **Trade-Slot-Wächter (`X / 20 Active Trades`)** sowie Status laufender Jobs inkl. **„Abbrechen“**-Button.
   - Rechts: Hard-Limit-Wächter (Daily Loss, Max Drawdown), Modus-Umschalter (`PAPER [$1,000]` / `LIVE`) und **EMERGENCY KILL SWITCH (Flatten All 20)**.
2. **Linke Zone — Automatischer Multi-Source Scheduled Screener & Strategie-Konfigurator**:
   - **Scheduled Multi-Exchange Screener (wie links oben im Foto)**:
     - Läuft automatisch im hinterlegten Intervall-Schedule über alle 6 Quellen (*Kraken, CCXT, Gainium, Binance, Alpaca, Alpha Vantage*).
     - Filterbar nach Quelle (`ALL`, `KRAKEN`, `CCXT`, `GAINIUM`, `BINANCE`, `ALPACA`, `ALPHAVANTAGE`) oder Signal-Typ (*Universe*, *High RVOL*, *Breakout*).
     - Kompakte Spalten: `SYM`, `SRC`, `PRICE`, `RVOL`, `CHG %`, `SPREAD`. Klick auf jede Zeile lädt sofort Kerzen und Orderbuch.
   - **Strategie-Steuerung & Parameter**:
     - Vorlagen-Auswahl (*SniperFusion v3.1*, *MTF CISD Breakout*, *1m Flip-Sensor*, *Sigma Z-Score Reversion*, *ATR Trend*), Neu-Anlage, Speichern und JSON-/Drive-Import.
     - Direkt sichtbare Kernparameter: Richtung (`LONG & SHORT`, `LONG`, `SHORT`), Zeitraum (`200`–`1000` Bars), **Startkapital (`$1,000.00`)**, **Max. gleichzeitige Trades (`20`)**, Risiko pro Trade (`%`), Hebel, Gebühren (`%`), Slippage (`bps`), Stop-Loss (`ATR Multiplikator`) und **Exit-Modus** (`TP Ladder`, `Auto TP`, `Fractal TP`, `Trailing from Top`).
     - Aufklappbares Akkordeon **„Erweitert“** für Indikator-Perioden, Z-Score-Schwellen, Profit-Lock Giveback R und Shadow-Engine-Gegenlauf.
     - Primärer Button **„Backtest starten / Berechnen“** (inkl. Validierung, Doppelstart-Sperre und Abbruch-Button).
3. **Zentrale Zone — Asset-Dossier, Animierte Pipeline, Haupt-Chart & Ergebnis-Ledger**:
   - **Asset- & Strategie-Kopf (wie Mitte oben im Foto)**: Aktives Symbol, Datenquelle in der Kaskade, 24h-Range-Balken, `Price`, `Change`, `RVol`, `VWAP`, `ATR` und aktueller Status der inversen Shadow-Position.
   - **Animierter Pipeline-Strip (wie im Video)**: `SCANNER → CHECK (≤20 Trades) → SIZER ($1k Basis) → EXECUTOR → LOGGER` mit Live-Indikator für durchgelassene und gefilterte Signale.
   - **Interaktiver Haupt-Chart**: Echte OHLCV-Kerzen mit leuchtenden `ENTER`/`EXIT`/`SL`/`TP`-Markern, aktiven Stop-/Trailing-Linien sowie umschaltbarer **Equity-Kurve (Start bei `$1,000.00`)** und **Drawdown-Kurve**.
   - **Unteres Multi-Tab-Dock**:
     - *Trade-Liste & Execution Log*: Alle Round-Trips und Live-Events (`ENTER` / `EXIT` / `FILTERED`, Zeit, Quelle, Preis, Größe, Gebühren, Net PnL, Return %, MFE, MAE, exakter `reason`-Text).
     - *Performance & Risiko-Metriken*: Net Profit (auf `1.000 $` Basis), Profit Factor, Win Rate, Sharpe, Sortino, Max Drawdown, Expectancy, Peak Concurrent Trades (`max 20`).
     - *Aktive Trades (`X / 20`) & Execution Blotter*: Übersicht aller aktuell offenen Positionen (maximal 20), manuelles Order-Ticket, Einzel-Close oder Flatten-All.
     - *Pine Script v6 Editor*: Editierbarer Pine-Script-v6-Code mit One-Click-Copy und `.pine`-Export.
     - *Diagnose & System-Logs*: Status der 6 Datenquellen-Adapter, Scheduled-Screener-Läufe und API-Logs.
4. **Rechte Zone — Echtzeit-Chronik (*Chronicle of Events*) & *Beam of Absorption* (Orderbuch)**:
   - **Chronicle of Events (wie rechts oben im Foto)**: Laufender Stream der automatischen Scheduled-Screener-Treffer (`VWAP cross`, `High of Day`, `RVOL Spike`, `New Entry`, `Max 20 Cap Block`) über alle 6 Quellen.
   - **Orderbuch & *Beam of Absorption* (wie rechts unten im Foto)**: L2 Bid/Ask-Tiefe mit horizontalen Absorptions-Balken für Kaufdruck vs. Verkaufsdruck.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Deterministische 6-Stufen-Provider-Kaskade (`Kraken → CCXT → Gainium → Binance → Alpaca → Alpha Vantage`)**
  - *Gewählter Ansatz*: Ein zentraler Backend-Market-Data-Service prüft der Reihe nach Kraken, CCXT-Endpunkte, Gainium, Binance (`data-api.binance.vision` / `api.binance.com`), Alpaca und Alpha Vantage. Sobald eine Quelle valide OHLCV-Kerzen bzw. Ticker liefert, wird diese Quelle mit ihrem echten Provider-Tag (`KRAKEN`, `CCXT`, `GAINIUM`, `BINANCE`, `ALPACA`, `ALPHAVANTAGE`) ausgeliefert. Falls für einen spezifischen Anbieter ein API-Key in `.env` benötigt wird und noch fehlt, meldet die Diagnose exakt den fehlenden Key und schaltet verzögerungsfrei auf das nächste Glied der Kaskade weiter.
- **Decision 2: Automatischer Scheduled Screener im Backend & Frontend**
  - *Gewählter Ansatz*: Ein Hintergrund-Scheduler scannt periodisch das Multi-Exchange-Universum aus allen 6 Quellen, berechnet RVOL, 24h-Change, Spread und VWAP-Abstand und speist die Ergebnisse automatisch in die linke Screener-Tabelle sowie in die rechte Event-Chronik ein.
- **Decision 3: Striktes `1.000 $` Paper-Konto & `20 Trades` Hard-Cap**
  - *Gewählter Ansatz*: Sowohl der Paper-Ledger im Backend als auch der Backtester und Positions-Sizer starten exakt mit `$1,000.00` und blockieren jeden 21. gleichzeitigen Trade hart im Risiko-Gate.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP COMMAND BAR: [OMEGA NIO] · [Symbol/TF] · [Active Provider] · [Equity: $1,000.00] · [Trades: X/20] │
├───────────────────────────┬────────────────────────────────────────────────┬──────────────────────┤
│ LEFT COLUMN (310px)       │ CENTER COLUMN (Flex 1)                         │ RIGHT COLUMN (290px) │
│                           │                                                │                      │
│ 1. Scheduled Multi-Source │ 1. Active Asset Dossier & Animated Pipeline    │ 1. Chronicle Stream  │
│    Screener (Auto-Cron)   │    - Provider Tag · 24h Range · Shadow Status  │    - Live Scheduled  │
│    [Kraken|CCXT|Gainium|  │    - [SCAN]──►[CHECK ≤20]──►[SIZE]──►[EXEC]    │      Screener Hits   │
│     Binance|Alpaca|AlphaV]│                                                │      across 6 Sources│
│                           │ 2. Interactive Price / Equity ($1k) / DD Chart │                      │
│ 2. Strategy Configurator  │    - OHLCV Candles + Glowing ENTER/EXIT Dots   │ 2. Beam of Absorption│
│    - Capital: $1,000.00   │    - Active SL / TP / Trailing Lines           │    & L2 Orderbook    │
│    - Max Open Trades: 20  ├────────────────────────────────────────────────┤    - Bid/Ask Depth   │
│    - Risk%, Fee%, ATR SL  │ 3. Dense Evaluation & Execution Ledger         │    - Imbalance Bars  │
│    - [+] Advanced & Shadow│    [Trade Log (ENTER/EXIT/FILTERED)]           │    - Quick Order     │
│                           │    [Performance & Risk] [Open Trades (X / 20)] │      Ticket ($1k Cap)│
│ 3. Primary Actions        │    [Pine Script v6 Editor] [Provider Logs]     │                      │
│    [Run Backtest / Cancel]│                                                │                      │
│    [Save] [CSV/JSON/.pine]│                                                │                      │
└───────────────────────────┴────────────────────────────────────────────────┴──────────────────────┘
                                             │
                                             ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│ EXPRESS BACKEND: 6-PROVIDER CASCADE, SCHEDULED SCREENER & $1,000 PAPER LEDGER (MAX 20 TRADES)     │
│ - /api/market/ohlc & /api/backtest/run (Cascade: Kraken → CCXT → Gainium → Binance → Alpaca → AV) │
│ - /api/screener/schedule (Auto-running cron across all 6 sources + manual trigger & status)       │
│ - /api/strategies & /api/kraken/cli/paper/* ($1,000 initial balance, 20 concurrent trades guard)  │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping

- **Multi-Source-Kaskade bei Symbol-/Zeitrahmenwechsel**: Wechselt der Nutzer auf z. B. `BTC/USD`, `PEPE/USDT`, `ZEC/USDT`, `SOL/USD`, `NVDA` oder `EUR/USD`, durchläuft das Backend automatisch `Kraken → CCXT → Gainium → Binance → Alpaca → Alpha Vantage`, lädt die echten Kerzen und zeigt den liefernden Provider transparent an.
- **Automatischer Scheduled Screener**: Läuft im einstellbaren Takt (z. B. 15s / 30s / 60s), aktualisiert alle Symbole der 6 Quellen und erzeugt Echtzeit-Einträge in der *Chronicle of Events*.
- **`$1,000` Startkapital & `20 Trades` Limit**: Jede Positionsgrößenberechnung basiert standardmäßig auf `$1,000.00` Equity; versucht ein Backtest oder Bot einen 21. Trade gleichzeitig zu öffnen, greift sofort die Sperre `MAX_CONCURRENT_TRADES (20/20)` und protokolliert den Vorgang als `FILTERED`.
