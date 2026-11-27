# Analog-TV Börsenstudio Stream, Prop-Firm-Challenge-Arena & qwentts.cpp TTS-Bridge

Das Livestream-Interface wird als zweigeteiltes **Analog-Broadcast- und Vintage-TV-Börsenstudio** neu aufgebaut: **Stream-Seite 1** vereint analoge Studio-Hardware-Ästhetik (echtzeit-reaktive VU-Meter, taktile Kippschalter, On-Air-Leuchtmelder und Börsenticker-Laufband) mit drei umschaltbaren Studio-Ansichten für Chart-Zoom, Voice-Desk, News, Pionex & DEX; **Stream-Seite 2** bringt einen interaktiven **Prop-Firm-Challenge-Tester** nach dem Vorbild von LuxAlgo (`prop-firm-sim`) mit Monte-Carlo-Pfaden und Live-Regelprüfung; im Backend verbindet eine **qwentts.cpp TTS-Bridge** den lokalen OpenAI-kompatiblen Qwen3-TTS-Server samt Voice-Cloning mit automatischem Browser-Stimme-Fallback.

---

### User Review & Critical Decisions

> [!IMPORTANT] Alle Vorgaben aus dem Klärungsdialog werden vollständig und verlustfrei umgesetzt:

- **Bestätigte Entscheidung 1 (Studio-Ästhetik & 2. Stream-Seite)**: **Analog-Broadcast-Studio im Vintage-TV-Börsenstudio-Look** mit echten VU-Metern, taktilen Kippschaltern (`ON AIR`, `MIC`, `QWEN TTS`, `LAUFBAND`) und Börsenticker-Chyron — erweitert um eine umschaltbare **2. Stream-Seite zum aktiven Testen von Prop-Firm-Challenges** (inklusive Trailing/Static Drawdown, Daily Loss Limits, Profit Targets und Monte-Carlo-Wahrscheinlichkeitsanalyse angelehnt an `LuxAlgo/prop-firm-sim`).
- **Bestätigte Entscheidung 2 (`qwentts.cpp` Integration)**: **Backend TTS-Bridge plus Browser-Stimme-Fallback** — Serverseitige Anbindung an den bereits ins Projekt geklonten `qwentts.cpp`-Stack (`tts-server` HTTP-Bridge für Named Speakers & Voice Cloning per WAV) mit transparenter Verfügbarkeitsprüfung und verzögerungsfreiem Rückfall auf Web Speech Synthesis, falls kein lokaler GGUF-Model-Server läuft.
- **Bestätigte Entscheidung 3 (Stream-Ansichten & Funktionsfokus)**: Alle drei gewünschten Darstellungs-Modi sind per Studio-Umschalter direkt abrufbar:
  1. **Studio Komplett**: Live-Chart (mit Mausrad-Zoom & Drag-Pan), On-Air Voice-Desk, Yahoo/MSN/CMC News-Laufband sowie Pionex & CMC Decks.
  2. **Fokus Live-Chart & Transkript**: Großes TV-Börsenstudio-Chart-Bild, prominentes Teleprompter-Transkript und durchlaufender News-Ticker.
  3. **Split-Ansicht Radar & Audio**: Zweispaltiges Studio-Pult aus Pionex-/DEX-On-Chain-Radar auf der linken und Audio-Moderation + VU-Rack auf der rechten Seite.

---

## 1. Overview & Core Concept

- **Was es leistet**: Verwandelt den Fullscreen-Livestream in ein authentisches, YouTube-taugliches TV-Börsenstudio mit analogem Mischpult-Charakter, schaltet zwischen **Live Market Broadcast (Seite 1)** und **Prop Firm Challenge Arena (Seite 2)** um und veredelt die Sprachausgabe durch eine optionale **qwentts.cpp-TTS-Pipeline**.
- **Zielgruppe / Kontext**: Live-Streamer, Quant-Trader und Desk-Analysten, die Marktdaten, Orderflow, Pionex-Märkte und Strategie-Evaluierungen unter realen Prop-Firm-Bedingungen live präsentieren und kommentieren.
- **Kernnutzen**: Klar strukturierte, ablenkungsfreie Studio-Optik ohne Überladung, flexible Layout-Presets je nach Sendesegment, realistische Prop-Firm-Bestehenswahrscheinlichkeiten direkt aus echten Backtest-Trades oder freien Strategieparametern, und eine saubere Audio-Architektur zwischen lokalem neuronalem TTS und Browser-Speech.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Stream-Seite 1 — Analoges TV-Börsenstudio (3 Studio-Modi + Hardware-Pult)**:
   - Oben im Studio-Kopf sitzt eine klassische TV-Regie-Leiste mit **Page-Switcher (`STUDIO STREAM` | `PROP FIRM ARENA`)**, **Ansichts-Wahlschalter (`KOMPLETT` | `FOKUS CHART` | `RADAR & AUDIO`)**, mechanisch gestalteten **Kippschaltern** (Audio-Kommentar, Mikrofon-Befehle, Ticker-Laufband, Qwen-TTS-Engine) und **On-Air-Kontrollleuchte**.
   - Im **Studio-Audio-Pult** arbeitet ein zweikanaliges **Analog-VU-Meter** (Aussteuerung gekoppelt an aktive Web-Audio-/TTS-Wiedergabe und Mikrofon-Pegel), ergänzt durch Transportschalter (`PAUSE`, `SKIP`, `REPLAY`, `CMC BRIEFING`) und das Teleprompter-Fenster.
   - Unten am Studio-Bildschirm läuft ein kontrastreiches **Börsenstudio-Chyron-Laufband** (`YAHOO FINANCE · MSN FINANCE · CMC SIGNALS · PIONEX ALERT`), das per Kippschalter pausierbar ist und bei Klick auf eine Schlagzeile den Live-Kommentar triggert.
2. **Stream-Seite 2 — Prop Firm Challenge Arena (nach `LuxAlgo/prop-firm-sim`)**:
   - **Regelwerk-Wahl & Account-Konfiguration**: Vordefinierte Prop-Firm-Profile (`FTMO 100k 2-Step Static`, `Apex 50k Trailing Intraday`, `Topstep 100k EOD Trailing`, `FundingPips 100k 2-Step`, plus frei editierbare Regelparameter wie Profit Target Phase 1/2, Daily Loss Limit, Max Drawdown Static vs. Trailing, Challenge-Gebühr und Konsistenzregel).
   - **Datenquelle**: Mit einem Klick übernimmt die Simulation automatisch die Kennzahlen aus den aktuell im Terminal laufenden **Backtest-Trades** (`Winrate`, `Avg Win R`, `Avg Loss R`, `Trades/Tag`) oder nutzt manuell justierbare Schieberegler für „Was-wäre-wenn“-Tests.
   - **Live-Monte-Carlo & Aktive Challenge-Durchläufe**: Berechnet deterministisch bis zu `10.000` vollständige Challenge-Pfade (`< 80ms`) und rendert:
     - Pass-Wahrscheinlichkeit Phase 1, Phase 2 und Funded Payout in Prozent,
     - Erwartete Versuche, erwartete Gesamtkosten und Netto-EV,
     - Risiko-Optimierungskurve (`0.25%` bis `2.5%` Risk/Trade) zur Erkennung des idealen Risk-Sizings ohne Drawdown-Bruch,
     - Interaktives Pfad-Chart mit 25–40 repräsentativen Equity-Kurven gegen Profit Target und Trailing-/Static-Drawdown-Linien sowie einen **Step-by-Step Live-Challenge-Tester** (Einzelpfad mit Tages-/Trade-für-Trade-Ablauf zum Live-Vorführen im Stream).
3. **`qwentts.cpp` Backend TTS-Bridge**:
   - Im Audio-Desk lassen sich die TTS-Engine (`AUTO (Qwen3-TTS -> Browser)`, `QWEN3-TTS SERVER`, `BROWSER STIMME`), der Qwen-Sprecher (`ryan`, `vivian`, `serena`, `aiden`, `eric`, `dylan`) oder ein im Teach-Modal aufgenommener Voice-Clone-Clip wählen.
   - Verfügbarkeitsstatus und Modell-Pfade werden sauber im Backend abgefragt; ist der `qwentts.cpp` HTTP-Server lokal aktiv, liefert die Bridge WAV-Audio direkt ins Audio-Element (mit VU-Meter-Analyse); andernfalls schaltet der Kommentator nahtlos auf die Browser-Stimme zurück.

### Visual Identity & Theme

- **Aesthetic Direction**: **Warmes Analog-TV Börsenstudio meets Quant-Terminal** — tiefe Schiefer-/Röhrenmonitor-Flächen (`#0A0D12` / `#11161F`), gebürstete Studio-Pult-Rahmen (`#263042`), bernsteinfarbene Analog-Skalen (`#F59E0B` / `#D97706`), On-Air-Rubinrot (`#DC2626`) und klare Emerald-/Crimson-Kurse (`#089981` / `#F23645`). Keine generischen Neon-Verläufe, keine dekorativen Status-Punkt-Schwärme, keine Pill-Badges um Metadaten.
- **Typography & Numeric Precision**: `JetBrains Mono` mit striktem `tabular-nums` für alle Kurse, VU-Skalen, Drawdown-Schwellen, Gebühren-EVs und Timestamps; klare Groß-/Titelschrift (`Outfit` / bestehende System-Sans) für Broadcast-Chyrons und Regelkarten.
- **Single-Line Controls & Density**: Alle Umschalter, Kippschalter und Mode-Tabs bleiben strikt einzeilig (`whitespace-nowrap shrink-0`), mit sauberem Padding und klarer visueller Trennung durch `1px`-Haarlinien statt verschachtelter Karten-in-Karten.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Client- & Server-seitige Prop-Firm Monte-Carlo-Engine direkt in TypeScript nach `LuxAlgo/prop-firm-sim`-Regelmechanik**
  - *Gewählter Ansatz*: Exakte Nachbildung der zentralen Prop-Firm-Regelmathematik (Static vs. Intraday-Trailing vs. EOD-Trailing Drawdown, Daily Loss Reset, 2-Step-Evaluation + Funded-Payout-Gate, Poisson-verteilte Trade-Frequenz pro Tag und Risiko-Sweep) als schnelle TypeScript-Engine, speisbar aus echten Backtest-Ergebnissen oder manuellen Reglern.
  - *Warum*: Läuft ohne externe Paketkonflikte in unter `80ms` für `10.000` Pfade direkt im Browser/Server und erlaubt zusätzlich einen interaktiven Trade-by-Trade „Aktiven Challenge-Test“ live im Stream.
  - *Verworfene Alternative*: Einbindung einer externen CLI über Shell-Subprozesse pro UI-Reglerbewegung — würde bei schnellem Live-Tuning spürbare Latenz erzeugen.

- **Entscheidung 2: `qwentts.cpp` als optionale Backend-TTS-Bridge mit automatischem Browser-Fallback**
  - *Gewählter Ansatz*: Das geklonte `qwentts.cpp`-Repository bleibt als natives C++-TTS-Modul verankert; Express bietet einen konfigurierbaren Bridge-Endpunkt (`/api/tts/status`, `/api/tts/synthesize`, `/api/tts/voices`), der gegen einen lokal gestarteten `tts-server` (`QWENTTS_SERVER_URL`, Standard `http://127.0.0.1:8080`) spricht und WAV-Streams zurückgibt. Fehlt ein laufender GGUF-TTS-Daemon in der Container-Umgebung, übernimmt ohne Fehlermeldung die Browser-Web-Speech-Stimme.
  - *Warum*: Da für `qwentts.cpp` im Container weder `cmake` noch Gigabyte-große GGUF-Gewichte vorinstalliert sind, garantiert das Bridge-Muster volle Funktionsfähigkeit der TTS-Anbindung bei lokaler GPU/CPU-Nutzung, ohne den Live-Stream in Cloud-Umgebungen stumm zu schalten.

- **Entscheidung 3: Analoges Broadcast-Audio-Pult über echte Audio- & Synth-Signale**
  - *Gewählter Ansatz*: Das Dual-VU-Meter speist sich aus dem `AnalyserNode` des `arcadeSoundEngine` / HTMLAudioElements (Qwen-WAV & Custom Clips) sowie einer sanft gedämpften Sprachhüllkurve bei Web-Speech-Ausgabe (da Browser-`speechSynthesis` keine PCM-Node exponiert).
  - *Warum*: Sorgt für authentische, flüssige Zeigerausschläge im Broadcast-Pult, unabhängig davon ob Qwen-WAV, aufgenommener Clip oder Browser-Stimme spricht.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     Broadcast Studio Header & Hardware Deck                      │
│  [STUDIO STREAM | PROP FIRM ARENA] · [KOMPLETT | FOKUS | RADAR] · Kippschalter   │
└───────────────┬──────────────────────────────────────────────┬───────────────────┘
                │ Seite 1: Studio Stream                       │ Seite 2: Prop Firm Arena
                ▼                                              ▼
┌───────────────────────────────────────────┐  ┌───────────────────────────────────┐
│ Vintage TV Börsenstudio Surface           │  │ Prop-Firm Challenge Simulator     │
│ · Chart (Zoom/Pan/Reset) + Teleprompter   │  │ · Firm Presets (FTMO/Apex/Topstep)│
│ · Analog Dual VU-Meter & Transport Deck   │  │ · Backtest-Import & Risk-Sweep    │
│ · Pionex USDT, Yahoo/MSN, DEX & CMC       │  │ · 10.000-Pfad Monte Carlo Engine  │
│ · Pausierbares Börsenstudio-Laufband      │  │ · Equity-Pfad-Chart & Live-Tester │
└───────────────┬───────────────────────────┘  └───────────────┬───────────────────┘
                │                                              │ Briefing / Events
                ▼                                              ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                 Live Voice Commentator & Audio Routing Layer                     │
│  [Event Queue] ─► Gemini Key-Takeaways ─► Mode: Qwen3-TTS Bridge ─► <audio>+VU   │
│                                              └─(Fallback)─► Browser Speech + VU  │
└──────────────────────────────────────────────┬───────────────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│           Backend Server Proxy & Native qwentts.cpp Engine Module                │
│  Express: /api/tts/status · /api/tts/synthesize · /api/tts/voices                │
│     └─► HTTP Bridge zu qwentts.cpp `tts-server` (Named Voices & WAV Cloning)     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Broadcast Studio State**:
  - `streamPage`: `'STUDIO' | 'PROP_FIRM'`
  - `studioLayoutMode`: `'FULL' | 'FOCUS' | 'SPLIT'`
  - `tickerScrollPaused`: `boolean` (gesteuert über Analog-Kippschalter)
  - `vuLevels`: `{ leftDb: number; rightDb: number; peakHold: number }`
- **Prop-Firm Simulation Engine**:
  - `PropFirmPreset`: `{ id, name, category: 'CFD' | 'FUTURES', accountSize, feeUsd, phase1TargetPct, phase2TargetPct, maxDailyLossPct, maxTotalLossPct, drawdownMode: 'STATIC' | 'TRAILING_EOD' | 'TRAILING_INTRADAY', minTradingDays, consistencyMaxDayPct }`
  - `PropFirmSimInput`: `{ preset, winRatePct, avgWinR, avgLossR, riskPerTradePct, tradesPerDay, numPaths, seed }`
  - `PropFirmSimResult`: `{ passPhase1Pct, passPhase2Pct, fundedPayoutPct, failDailyLossPct, failMaxLossPct, avgDaysToPass, expectedAttempts, expectedFeeCostUsd, expectedNetEvUsd, riskSweep: Array<{ riskPct, passPct, breachPct, evUsd }>, samplePaths: Array<{ id, outcome, equitySeries }> }`
- **TTS Engine Bridge State**:
  - `TtsBackendStatus`: `{ configured, reachable, serverUrl, activeModel, speakers: string[], registeredCustomVoices: string[], lastCheckMs }`
  - `TtsPreference`: `engine: 'AUTO' | 'QWENTTS' | 'BROWSER'`, `qwenSpeaker: string`

### Interactive Component & State Mapping

- **Stream-Header Page Switcher & Studio Mode Tabs**: Umschalten zwischen `STUDIO STREAM` (3 Layout-Presets ohne Datenverlust) und `PROP FIRM ARENA` (behält Hintergrund-Voice-Queue und Chart-State intakt).
- **Analog Hardware Toggle Switches (Kippschalter)**: Jeder Schalter triggert reale State-Übergänge (`voiceCommentatorService.togglePause()`, `voiceCommandListener.start/stop()`, `tickerScrollPaused`, `ttsEngineMode` zwischen Qwen3-TTS und Browser).
- **Prop Firm Challenge Arena**:
  - Preset-Auswahl lädt firmenspezifische Drawdown- und Target-Regeln.
  - Button **„Backtest-Stats übernehmen“** extrahiert aus dem aktuellen `BacktestResult` die echte `winRate`, `avgWinR`, `avgLossR` und Handelsfrequenz und startet sofort eine neue Simulation.
  - Button **„Einzel-Challenge live testen“** simuliert einen vollständigen Schritt-für-Schritt-Challenge-Pfad (Phase 1 -> Phase 2 -> Funded) mit handelbarem Trade-Log, Drawdown-Schutzlinien im SVG-Chart und optionaler Live-Moderation durch den Voice-Anchor.
- **TTS Audio Pipeline (`voiceCommentatorService` -> `/api/tts/*`)**:
  - Bei `AUTO` oder `QWENTTS` sendet der Client zuerst den generierten Kommentartext (optional samt gewähltem Voice-Clip-Referenzprofil) an `POST /api/tts/synthesize`; antwortet der lokale `qwentts.cpp`-Server mit `audio/wav`, wird der Stream über Web Audio + VU-Meter abgespielt; schlägt die lokale Verbindung fehl, fällt der Ablauf automatisch und unterbrechungsfrei auf Web Speech Synthesis zurück.
