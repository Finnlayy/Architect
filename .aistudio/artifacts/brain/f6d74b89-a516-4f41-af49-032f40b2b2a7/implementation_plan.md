# OMEGA NIO — High-Density Quant & Execution Terminal (Finviz / Fischer / CCXT / El Toro DNA)

Kompletter Umbau der bestehenden OMEGA-NIO-Anwendung von einer erklärungs- und präsentationslastigen Architektur-Demo zu einem **kompromisslosen, produktiven Echtzeit-Trading-, Screening- und Backtesting-Terminal** für den direkten Arbeitseinsatz. Jedes sichtbare Element dient ausschließlich einer konkreten Benutzereingabe, einer echten Aktion, einem berechneten Ergebnis oder einem handlungsrelevanten Systemzustand.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Bestätigte Ausrichtung aus deinem Feedback:**
> Statt kosmetischer Modus-Tabs über der alten Präsentationsstruktur wird die Oberfläche radikal nach dem Vorbild von **Finviz** (kompaktes Multi-Symbol-Screening & Kennzahlen-Tabellen), **Fischer-Terminal** (100% Viewport-Ausnutzung, direkte Parameter-zu-Chart-Kopplung, $\cos\varphi$- & MFE/MAE-Präzision) sowie **CCXT / El Toro Terminal** (integriertes L2-Orderbuch, direktes Paper/Live-Execution-Blotter & Positionsverwaltung im selben Arbeitsbereich) neu aufgebaut.

- **Entfernung jeglichen Präsentations-Ballasts**: Alle Marketing-Banner, Architektur-Erklärkarten, „Zero-Dummy“-Selbstbeschreibungen, die 4-Tasks-Toolbar und isolierte Vorstellungsseiten entfallen vollständig.
- **Echte historische & Live-Marktdaten**: Der Backtest- und Chart-Motor bezieht reale historische OHLCV-Kerzendaten über die öffentliche Kraken REST API (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) kombiniert mit dem laufenden Kraken-WebSocket-Feed. Für Symbole ohne direkte Kraken-Historie greift ein deterministischer Generator mit unübersehbarem `SYNTHETIC DATA`-Statushinweis.
- **Durchgängige Persistenz & Export**: Strategien, Parameter-Sets und Backtest-Läufe werden sowohl über dedizierte Server-Endpunkte als auch synchron im Browser (`LocalStorage`) gespeichert, überstehen jeden Page-Reload und lassen sich als CSV, JSON und Pine Script v6 (`.pine`) exportieren sowie aus JSON oder Google Drive importieren.

---

## 1. Overview & Core Concept

- **Was das System leistet**: Eine integrierte Single-Screen-Arbeitsoberfläche, in der Trader ohne Seitenwechsel Märkte nach Volumen-/Volatilitätsanomalien filtern (Finviz-Screener), quantitative Strategien parametrisieren, deterministische Backtests über reale historische Kerzendaten berechnen, jede einzelne Trade-Entscheidung im Chart und in der Round-Trip-Tabelle prüfen, den generierten Pine-Script-v6-Code anpassen und Strategien direkt gegen das angebundene Kraken-Paper/Live-Orderbuch ausführen können.
- **Zielgruppe & Nutzungskontext**: Aktive systematische Trader und Quant-Analysten, die hohe Informationsdichte, sofortige kausale Rückmeldung bei Parameteränderungen und verlässliche Datenquellen-Transparenz benötigen.
- **Kernmehrwert**: Null Klicks durch Erklärseiten – 100 % des Bildschirms arbeiten als synchronisiertes Analyse-, Backtest- und Ausführungswerkzeug.

---

## 2. User Experience & Visual Design

### Key User Flows (End-to-End im selben Terminal)

1. **Markt-Screening & Symbolwechsel (Finviz / CCXT Stil)**:
   - Oben links oder im kompakten Screener-Panel wählt der Nutzer ein Handelspaar (z. B. `BTC/USD`, `ETH/USD`, `SOL/USD`, `HYPE/USD`, `PEPE/USD`, `ZEC/USD`, `AVAX/USD`, `XRP/USD`) und den Zeitrahmen (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`).
   - Der Screener schaltet verzögerungsfrei zwischen **Universe Watchlist** (Kurs, 24h-Änderung, Spread in bps, RVOL, Regime-Phase) und **Anomaly Stream** (Echtzeit-Ausbrüche bei Volumen- oder Spread-Spikes) um. Ein Klick auf eine Zeile lädt sofort Kerzendaten, Orderbuch und Strategie-Berechnung für dieses Symbol.
2. **Strategie auswählen, erstellen, importieren & parametrisieren (Fischer-Terminal DNA)**:
   - Auswahl aus praxisfertigen Strategie-Vorlagen (*SniperFusion v3.1 Long/Short*, *MTF CISD Structure Break*, *1m Microstructure Flip-Sensor*, *Sigma Bollinger/Z-Score Reversion*, *ATR Volatility Breakout*) oder Anlage einer neuen Strategie bzw. Import per JSON / Google Drive.
   - Direkt sichtbare Kernparameter: Handelsrichtung (`LONG & SHORT`, `LONG ONLY`, `SHORT ONLY`), Datenzeitraum (Kerzenanzahl bzw. Start-/Enddatum), Startkapital (`Initial Capital`), Risiko pro Trade (`Risk %`), Hebel (`Leverage`), Kommission (`Fee %`), Slippage (`bps`), Stop-Loss (`ATR Multiplikator`) sowie **Exit-Modus** (`TP Ladder`, `Auto TP [MFE-Quantil]`, `Fractal TP`, `Trailing from Top`).
   - Aufklappbares Akkordeon **„Erweitert“** für Spezialparameter (Indikator-Perioden, Z-Score-Schwellen, $\cos\varphi$ Phasen-Filter, Profit-Lock Giveback R, M8-Risiko-Schranken).
3. **Backtest-Ausführung mit Job-Steuerung & Validierung**:
   - Strikte Eingabevalidierung vor dem Start (z. B. Abfangen negativer Kapital-/Gebührenwerte oder ungültiger Zeiträume mit präziser Korrekturmeldung).
   - Klick auf **„Backtest starten“** sperrt Doppelstarts, zeigt den realen Berechnungsstatus im Header und bietet einen **„Abbrechen“**-Button (`AbortController`) für laufende Abfragen.
4. **Visuelle & Tabellarische Auswertung**:
   - **Haupt-Chart**: Interaktiver Kerzen-/Preis-Chart mit eingezeichneten Entry-/Exit-Markern (`BUY`, `SELL`, `TP`, `SL`, `TRAIL`, `EARLY_OPP`), aktiven Stop-/Target-Linien sowie umschaltbarer **Equity- und Drawdown-Kurve**.
   - **Kompakter $\cos\varphi$- & Shadow-Monitor**: Einzeilige Telemetrie-Leiste direkt am Chart für Wirkleistung vs. Rauschen ($\cos\varphi$), virtuelles Long/Short-Spiegelbild (MFE/MAE) und adaptives Auto-TP-Quantil.
   - **Unteres Auswertungs-Dock (Kompakte Reiter)**:
     - *Trade-Liste*: Sortier- und filterbare Tabelle aller Round-Trips inkl. Ein-/Ausstiegszeit, Preis, Positionsgröße, Gebühren, Net PnL ($/%), MFE, MAE und Exit-Grund. Klick auf einen Trade fokussiert den Zeitpunkt im Chart.
     - *Performance & Risiko*: Net Profit, Profit Factor, Win Rate, Sharpe Ratio, Sortino, Max Drawdown, Expectancy, Durchschnittlicher Gewinn/Verlust und Exit-Verteilung.
     - *Live / Paper Blotter & Bots (CCXT / El Toro)*: Aktive Positionen, offene Orders, direktes Order-Ticket (Market/Limit Buy/Sell über die Kraken Paper Bridge), Positions-Glattstellung und laufende DCA-Worker-Bots.
     - *Pine Script v6*: Vollständiger, editierbarer Pine-Script-v6-Strategiecode passend zu den gewählten Parametern mit One-Click-Copy und `.pine`-Dateiexport.
     - *Diagnose & System-Logs*: Bei Bedarf einblendbare Rohdaten, Kraken-WebSocket-Latenz, M8-Gate-Prüfprotokolle und API-Statusmeldungen.
5. **Speichern, Wiederherstellen & Exportieren**:
   - Speichern der Strategie inklusive Parameter und letztem Backtest-Ergebnis; automatische Wiederherstellung beim erneuten Öffnen der Anwendung; direkter Dateiexport als **CSV** (Trade-Liste), **JSON** (kompletter Strategie- & Ergebnis-Snapshot) und **Pine Script (`.pine`)**.

### Visual Identity & Theme

- **Aesthetic Direction**: Kompromissloses institutionelles Quant- & Execution-Terminal (Finviz / Fischer / CCXT Vorbild) – flache 1px-Rahmenarchitektur, null dekorative Schatten-Karten, maximale Datenlesbarkeit.
- **Color Palette & Mood**:
  - Primärer Hintergrund (`#0B0E14`), strukturelle Panel-Oberflächen (`#12161F`), präzise 1px-Trennlinien (`#1E2430`).
  - Semantische Signalfarben (niemals ohne klaren Text-/Richtungsindikator):
    - `#089981` (Smaragdgrün): Long / Positiver PnL / Wirkleistung ($\cos\varphi \to 1,0$) / Live-Verbindung
    - `#F23645` (Karmesinrot): Short / Negativer PnL / Stop-Loss / Hard-Limit-Warnung / Kill-Switch
    - `#00E5FF` (Cyan): Shadow-Queue / MFE-Quantil-Kurve / Aktiver Fokus
    - `#FF9800` (Bernstein): Synthetische Fallback-Daten / Chop-Sperre ($\cos\varphi \to 0$) / Reconnect-Zustand
- **Typography & Hierarchy**:
  - Struktur & UI-Labels: `Plus Jakarta Sans` / `DM Sans` in kompakter 11px–13px Skalierung, klare Zeilenführung (`whitespace-nowrap` auf allen Controls).
  - Preise, Metriken, Zeitstempel, PnL & Tabellen: Strikt `JetBrains Mono` mit `font-variant-numeric: tabular-nums`, damit bei Echtzeit-Ticks kein einziges Layout-Element wackelt.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Echte Multi-Pane-Terminal-Architektur statt Tab-Seiten-Sammlung**
  - *Gewählter Ansatz*: Ein durchgängiger 3-Spalten-/Multi-Pane-Workspace (Links: Screener & Strategie-Konfigurator; Mitte oben: Chart + Equity/Drawdown + $\cos\varphi$/Shadow-Strip; Mitte unten: Trades / Metriken / Execution Blotter / Pine Script; Rechts kompakt: L2-Orderbuch & Tape).
  - *Warum*: Ein Trader muss beim Ändern eines ATR-Multiplikators oder beim Klick auf ein Symbol im Screener sofort die Auswirkung im Chart und in den Kennzahlen sehen, ohne zwischen isolierten Unterseiten hin- und herzuspringen.
- **Decision 2: Reale Kraken-OHLCV-Historie mit gekennzeichnetem deterministischem Fallback**
  - *Gewählter Ansatz*: Der Backend-Endpunkt `/api/backtest/run` und `/api/market/ohlc` ruft echte historische Kerzen von Kraken (`https://api.kraken.com/0/public/OHLC`) ab. Wird ein Symbol gewählt, das auf Kraken Spot nicht existiert (oder ist die externe API nicht erreichbar), erzeugt die Engine deterministische historische Kerzen, verankert am letzten bekannten Marktpreis, und markiert das Ergebnis unübersehbar als `SYNTHETIC / SIMULATED`.
  - *Warum*: Garantiert 100 % Ehrlichkeit über die Datenherkunft und ermöglicht gleichzeitig unterbrechungsfreies Testen aller Symbole und Fehlerfälle.
- **Decision 3: Duale Persistenz (Server + LocalStorage) für Strategien & Ergebnisse**
  - *Gewählter Ansatz*: Alle gespeicherten Strategien, Parameter und Backtest-Runs werden über `/api/strategies` auf dem Server persistiert und zusätzlich im Browser-`LocalStorage` gespiegelt.
  - *Warum*: Sofortige Wiederherstellung nach jedem Seiten-Reload sowie Schutz vor Datenverlust.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP COMMAND & STATUS BAR                                                                 │
│ [OMEGA NIO] · [Symbol/TF Quick-Bar] · [Data Source & Job Status + Cancel] · [KILL SWITCH]│
├────────────────────────┬─────────────────────────────────────────────┬───────────────────┤
│ LEFT PANE (320px)      │ CENTER TOP PANE (Flex 1)                    │ RIGHT PANE (260px)│
│                        │                                             │                   │
│ 1. Finviz Screener     │ 1. Interactive Price / Trade / Equity Chart │ 1. Kraken L2 Book │
│    - Universe Table    │    - OHLCV Candles + Buy/Sell/SL/TP Markers │    - Bid/Ask Depth│
│    - Anomaly Stream    │    - Toggle: Price | Equity | Drawdown      │    - Spread (bps) │
│                        │                                             │                   │
│ 2. Strategy Builder    │ 2. Compact cos(φ) & Shadow Queue Strip      │ 2. Live Trade Tape│
│    - Template / Import │    - Phase Efficiency · Virtual Long/Short  │                   │
│    - Capital, Risk, Fee│                                             │ 3. Quick Execution│
│    - ATR SL & Exit Mode├─────────────────────────────────────────────┤    - Paper / Live │
│    - [+] Advanced      │ CENTER BOTTOM DOCK (Resizable / Tabbed)     │    - M8 Gate Check│
│                        │ [Trades (Round-Trips)] [Performance/Risiko] │                   │
│ 3. Action Controls     │ [Positions & Bots] [Pine Script v6] [Logs]  │                   │
│    [Run Backtest]      │                                             │                   │
│    [Save] [Export]     │ [Export CSV] [Export JSON] [Export .pine]   │                   │
└────────────────────────┴─────────────────────────────────────────────┴───────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ EXPRESS BACKEND & EXECUTION ENGINE                                                       │
│ - /api/market/ohlc & /api/backtest/run (Real Kraken OHLCV + Deterministic Sim Engine)    │
│ - /api/strategies (GET / POST / DELETE persistent strategy & backtest store)             │
│ - /api/kraken/* (Live WebSocket v2 Book/Ticker + 181-Leaf CLI Paper/Live Execution SoT)  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **`StrategyDefinition`**: Eindeutige ID, Name, Beschreibung, Kategorie, Zeitrahmen, Symbol, Richtung (`LONG` | `SHORT` | `BOTH`), Kerzenanzahl/Zeitraum, Kapital (`initialCapital`), Risiko pro Trade (`riskPerTradePct`), Hebel (`leverage`), Gebühren (`feePct`), Slippage (`slippageBps`), Stop-Loss-ATR-Multiplikator (`slAtrMult`), Take-Profit-R (`tpRMultiple`), Exit-Modus (`TP_LADDER` | `AUTO_TP_MFE` | `FRACTAL_TP` | `TRAILING_STOP`), sowie erweiterte Parameter (`fastPeriod`, `slowPeriod`, `zScoreThreshold`, `cosPhiThreshold`, `profitLockGivebackR`, `mfeWindow`).
- **`BacktestResult`**: Verknüpfte `strategyId`, Symbol, Zeitrahmen, Datenquelle (`KRAKEN_LIVE_OHLC` | `SYNTHETIC_FALLBACK`), Zeitstempel, Kerzen-Array (`OHLCVCandle[]`), vollständige `BacktestTrade[]`-Liste (inkl. Entry/Exit-Preis, Größe, Gebühren, Slippage, Net PnL, Return %, MFE %, MAE %, Exit-Grund), `EquityPoint[]`-Kurve (Equity & Drawdown %), `ShadowMetrics` ($\cos\varphi$, Shadow Long/Short PnL, berechnetes MFE-Quantil), zusammenfassende `PerformanceMetrics` sowie der generierte `pineScriptCode`.

### Interactive Component & State Mapping

- **Symbol- & Zeitrahmenwechsel**: Löst unmittelbar das Nachladen der passenden OHLCV-Kerzen und Orderbuchdaten aus; falls eine Strategie aktiv ist, wird der Backtest automatisch oder per Knopfdruck mit den neuen Marktdaten neu berechnet.
- **Kausale Parameter-Kopplung**: Jede Änderung an Kapital, Risiko %, Gebühren, Slippage, ATR-Stop, Exit-Modus oder erweiterten Schwellenwerten fließt direkt in die Backtest-Berechnung und die Pine-Script-v6-Codegenerierung ein.
- **Validierung, Laufzeit-Sperre & Abbruch**: Ungültige Eingaben (z. B. Kapital $\le 0$, Risiko $> 100\%$, Gebühren $< 0$) zeigen sofortige Inline-Fehlermeldungen und blockieren den Start. Während ein Job läuft, ist der Start-Button gesperrt und ein aktiver `Cancel Job`-Button bricht den laufenden Request über `AbortController` sauber ab.
- **Notfall-Glattstellung (Emergency Kill Switch)**: Ein zweistufig gesicherter Button im Header storniert über `/api/kraken/cli/paper/cancel-all` alle offenen Orders und schließt alle offenen Paper-Positionen sofort.
