import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Mic, Radio, ScrollText, Cpu, Save, Check } from 'lucide-react';
import { TtsEngineMode } from '../types/terminal';
import {
  voiceCommentatorService,
  VoiceCommentatorSnapshot,
  VuMeterReading,
} from '../services/voiceCommentatorService';
import { VoiceListenerSnapshot } from '../services/voiceCommandListener';

interface AnalogVuDialProps {
  label: string;
  channelTag: string;
  level: number; // 0..1
  peak: number; // 0..1
  isActive: boolean;
}

const AnalogVuDial: React.FC<AnalogVuDialProps> = ({
  label,
  channelTag,
  level,
  peak,
  isActive,
}) => {
  // Clamp level -> needle angle from -44 deg (-20dB) to +42 deg (+3dB)
  const clamped = Math.max(0, Math.min(1, level));
  const angleDeg = -44 + clamped * 86;
  const isOverload = clamped > 0.78 || peak > 0.85;

  return (
    <div className="flex-1 bg-[#0B0F15] border border-[#263042] p-2">
      <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-[#8B95A5] mb-1">
        <span className="font-bold tracking-wider text-[#E6EDF3]">{label}</span>
        <span>{channelTag}</span>
      </div>
      <svg viewBox="0 0 180 88" className="w-full h-[68px] block bg-[#12161E] border border-[#1E2634]">
        <defs>
          <linearGradient id={`vu-warm-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2B2314" />
            <stop offset="100%" stopColor="#16130D" />
          </linearGradient>
        </defs>
        {/* Warm Analog Backlit Window */}
        <rect
          x="6"
          y="6"
          width="168"
          height="76"
          rx="3"
          fill={`url(#vu-warm-${label})`}
          stroke="#352B19"
          strokeWidth="1"
        />

        {/* Normal Scale Arc (-20 dB .. 0 dB) */}
        <path
          d="M 28 66 A 68 68 0 0 1 134 32"
          fill="none"
          stroke="#E7C278"
          strokeWidth="1.6"
          strokeOpacity="0.85"
        />
        {/* Overload Red Zone Arc (0 dB .. +3 dB) */}
        <path
          d="M 134 32 A 68 68 0 0 1 154 44"
          fill="none"
          stroke="#EF4444"
          strokeWidth="2.4"
        />

        {/* Scale Ticks & Labels */}
        {[
          { deg: -40, lbl: '-20', red: false },
          { deg: -24, lbl: '-10', red: false },
          { deg: -8, lbl: '-5', red: false },
          { deg: 8, lbl: '-2', red: false },
          { deg: 22, lbl: '0', red: true },
          { deg: 36, lbl: '+3', red: true },
        ].map((t) => {
          const rad = ((t.deg - 90) * Math.PI) / 180;
          const cx = 90;
          const cy = 94;
          const x1 = cx + Math.cos(rad) * 56;
          const y1 = cy + Math.sin(rad) * 56;
          const x2 = cx + Math.cos(rad) * 63;
          const y2 = cy + Math.sin(rad) * 63;
          const tx = cx + Math.cos(rad) * 47;
          const ty = cy + Math.sin(rad) * 47;
          return (
            <g key={t.lbl}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={t.red ? '#EF4444' : '#E7C278'}
                strokeWidth="1.2"
              />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                fill={t.red ? '#EF4444' : '#D9B872'}
                fontSize="7"
                fontFamily="JetBrains Mono, monospace"
              >
                {t.lbl}
              </text>
            </g>
          );
        })}

        <text
          x="90"
          y="74"
          textAnchor="middle"
          fill="#A88B52"
          fontSize="8"
          fontWeight="bold"
          fontFamily="JetBrains Mono, monospace"
        >
          VU
        </text>

        {/* Peak LED */}
        <circle
          cx="162"
          cy="17"
          r="3"
          fill={isOverload && isActive ? '#EF4444' : '#3A1818'}
        />
        <text
          x="154"
          y="19"
          textAnchor="end"
          fill="#8B95A5"
          fontSize="6"
          fontFamily="JetBrains Mono, monospace"
        >
          PEAK
        </text>

        {/* Damped Analog Needle */}
        <g
          style={{
            transform: `rotate(${angleDeg}deg)`,
            transformOrigin: '90px 94px',
            transition: 'transform 75ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <line
            x1="90"
            y1="94"
            x2="90"
            y2="24"
            stroke="#FDE68A"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
        <circle cx="90" cy="82" r="5" fill="#1F2937" stroke="#525E72" strokeWidth="1" />
      </svg>
    </div>
  );
};

interface HardwareToggleSwitchProps {
  label: string;
  subLabel: string;
  active: boolean;
  accentColor?: 'amber' | 'red' | 'emerald' | 'cyan';
  onToggle: () => void;
  icon?: React.ReactNode;
}

export const HardwareToggleSwitch: React.FC<HardwareToggleSwitchProps> = ({
  label,
  subLabel,
  active,
  accentColor = 'amber',
  onToggle,
  icon,
}) => {
  const lampColors =
    accentColor === 'red'
      ? active
        ? 'bg-[#EF4444] text-[#EF4444]'
        : 'bg-[#2B1517] text-[#566173]'
      : accentColor === 'emerald'
      ? active
        ? 'bg-[#10B981] text-[#10B981]'
        : 'bg-[#112620] text-[#566173]'
      : accentColor === 'cyan'
      ? active
        ? 'bg-[#00E5FF] text-[#00E5FF]'
        : 'bg-[#11252B] text-[#566173]'
      : active
      ? 'bg-[#F59E0B] text-[#F59E0B]'
      : 'bg-[#292012] text-[#566173]';

  const borderActive =
    accentColor === 'red'
      ? 'border-[#EF4444]/60'
      : accentColor === 'emerald'
      ? 'border-[#10B981]/60'
      : accentColor === 'cyan'
      ? 'border-[#00E5FF]/60'
      : 'border-[#F59E0B]/60';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2.5 py-1.5 bg-[#0C1118] border flex items-center gap-2 text-left transition-colors whitespace-nowrap shrink-0 ${
        active ? borderActive : 'border-[#222B3A] hover:border-[#37455C]'
      }`}
    >
      {/* Tactile Vertical Rocker Switch Housing */}
      <span className="w-4 h-7 bg-[#070A0F] border border-[#323E52] p-0.5 flex flex-col justify-between shrink-0">
        <span
          className={`w-full h-2.5 transition-colors ${
            active ? 'bg-[#D1D5DB]' : 'bg-[#1A212E]'
          }`}
        />
        <span
          className={`w-full h-2.5 transition-colors ${
            !active ? 'bg-[#64748B]' : 'bg-[#1A212E]'
          }`}
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-[#E6EDF3]">
          <span className={`w-1.5 h-1.5 inline-block ${lampColors.split(' ')[0]}`} />
          {icon}
          <span>{label}</span>
        </span>
        <span className="text-[9px] font-mono tabular-nums text-[#8B95A5]">
          {subLabel}
        </span>
      </span>
    </button>
  );
};

interface AnalogStudioRackProps {
  voiceSnap: VoiceCommentatorSnapshot;
  listenerSnap: VoiceListenerSnapshot;
  tickerPaused: boolean;
  onToggleTickerPaused: () => void;
  onToggleVoicePaused: () => void;
  onToggleMic: () => void;
}

export const AnalogStudioRack: React.FC<AnalogStudioRackProps> = ({
  voiceSnap,
  listenerSnap,
  tickerPaused,
  onToggleTickerPaused,
  onToggleVoicePaused,
  onToggleMic,
}) => {
  const [vu, setVu] = useState<VuMeterReading>({
    left: 0,
    right: 0,
    peak: 0,
    activeSource: 'IDLE',
  });
  const [checkingTts, setCheckingTts] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return voiceCommentatorService.subscribeVu((next) => {
      setVu(next);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const handleSaveSettings = () => {
    voiceCommentatorService.saveAllPreferences();
    setSavedNotice(true);
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
    }
    savedTimerRef.current = window.setTimeout(() => {
      setSavedNotice(false);
      savedTimerRef.current = null;
    }, 2000);
  };

  const ttsStatus = voiceSnap.ttsStatus;
  const currentEngine: TtsEngineMode = voiceSnap.prefs.ttsEngineMode || 'AUTO';
  const googleTts = ttsStatus?.googleTts;
  const googleAvailable = Boolean(googleTts?.available);
  const googleVoices =
    googleTts?.voices && googleTts.voices.length > 0
      ? googleTts.voices
      : [
          { id: 'Kore', label: 'Kore · Studio Anchor (Klar)', style: '', pitchHint: '' },
          { id: 'Charon', label: 'Charon · Chef-Analyst (Tief)', style: '', pitchHint: '' },
          { id: 'Puck', label: 'Puck · Breaking News (Dynamisch)', style: '', pitchHint: '' },
          { id: 'Fenrir', label: 'Fenrir · Quant Desk (Kraftvoll)', style: '', pitchHint: '' },
          { id: 'Zephyr', label: 'Zephyr · Closing Bell (Warm)', style: '', pitchHint: '' },
        ];
  const speakers =
    ttsStatus?.speakers && ttsStatus.speakers.length > 0
      ? [...ttsStatus.speakers, ...(ttsStatus.registeredVoices || [])]
      : ['ryan', 'vivian', 'serena', 'aiden', 'eric', 'dylan'];

  const handleEngineCycle = () => {
    const order: TtsEngineMode[] = ['AUTO', 'GOOGLE_NATURAL', 'QWENTTS', 'BROWSER'];
    const idx = order.indexOf(currentEngine);
    const next = order[(idx + 1) % order.length];
    voiceCommentatorService.updatePrefs({ ttsEngineMode: next });
  };

  const handleRefreshTts = async () => {
    setCheckingTts(true);
    await voiceCommentatorService.refreshTtsBackendStatus(true);
    setCheckingTts(false);
  };

  const isSpeaking = voiceSnap.status === 'SPEAKING';

  const ttsSwitchLabel =
    currentEngine === 'GOOGLE_NATURAL'
      ? 'TTS: GOOGLE HD'
      : `TTS: ${currentEngine}`;

  const ttsSwitchSubLabel =
    currentEngine === 'GOOGLE_NATURAL'
      ? googleAvailable
        ? 'GEMINI 3.8 TTS'
        : 'API KEY FEHLT'
      : currentEngine === 'QWENTTS'
      ? ttsStatus?.reachable
        ? 'QWEN ONLINE'
        : 'QWEN OFFLINE'
      : currentEngine === 'BROWSER'
      ? 'WEB NATURAL DE'
      : googleAvailable
      ? 'GOOGLE NATURAL'
      : ttsStatus?.reachable
      ? 'QWEN ONLINE'
      : 'WEB NATURAL';

  const ttsSwitchAccent: 'emerald' | 'amber' | 'cyan' =
    currentEngine === 'BROWSER'
      ? 'cyan'
      : googleAvailable || ttsStatus?.reachable
      ? 'emerald'
      : 'amber';

  return (
    <div className="bg-[#090D14] border-b border-[#263042] p-2.5 space-y-2 shrink-0">
      {/* Dual Analog VU-Meters */}
      <div className="flex items-stretch gap-2">
        <AnalogVuDial
          label="CH-1 MODERATION"
          channelTag={
            isSpeaking
              ? voiceSnap.lastTtsProviderUsed === 'GOOGLE_NATURAL'
                ? 'GOOGLE-HD'
                : voiceSnap.lastTtsProviderUsed === 'QWENTTS'
                ? 'QWEN-WAV'
                : voiceSnap.lastTtsProviderUsed === 'CLIP'
                ? 'CLIP'
                : 'WEB-SPEECH'
              : 'STANDBY'
          }
          level={vu.left}
          peak={vu.peak}
          isActive={isSpeaking}
        />
        <AnalogVuDial
          label="CH-2 STUDIO BUS"
          channelTag={listenerSnap.isListening ? 'MIC LIVE' : 'MONITOR'}
          level={listenerSnap.isListening ? Math.max(vu.right, 0.14) : vu.right * 0.92}
          peak={vu.peak}
          isActive={isSpeaking || listenerSnap.isListening}
        />
      </div>

      {/* Hardware Rocker Switches Row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <HardwareToggleSwitch
          label="ON AIR"
          subLabel={voiceSnap.isPaused ? 'PAUSIERT' : isSpeaking ? 'SENDET' : 'BEREIT'}
          active={!voiceSnap.isPaused}
          accentColor={isSpeaking ? 'red' : 'emerald'}
          onToggle={onToggleVoicePaused}
          icon={<Radio className="w-2.5 h-2.5" />}
        />
        <HardwareToggleSwitch
          label="MIC"
          subLabel={listenerSnap.isListening ? 'AKTIV' : 'STUMM'}
          active={listenerSnap.isListening}
          accentColor="amber"
          onToggle={onToggleMic}
          icon={<Mic className="w-2.5 h-2.5" />}
        />
        <HardwareToggleSwitch
          label="LAUFBAND"
          subLabel={tickerPaused ? 'HALT' : 'LÄUFT'}
          active={!tickerPaused}
          accentColor="cyan"
          onToggle={onToggleTickerPaused}
          icon={<ScrollText className="w-2.5 h-2.5" />}
        />
        <HardwareToggleSwitch
          label={ttsSwitchLabel}
          subLabel={ttsSwitchSubLabel}
          active={currentEngine !== 'BROWSER'}
          accentColor={ttsSwitchAccent}
          onToggle={handleEngineCycle}
          icon={<Cpu className="w-2.5 h-2.5" />}
        />
      </div>

      {/* Google Natural Voices / qwentts.cpp Studio Voice Bar */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#0C1118] border border-[#1E2634] text-[10px] font-mono tabular-nums">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[#8B95A5] whitespace-nowrap">
            {currentEngine === 'QWENTTS'
              ? 'qwentts.cpp:'
              : currentEngine === 'BROWSER'
              ? 'Browser DE:'
              : 'Google Voice:'}
          </span>
          <span
            className={`truncate ${
              currentEngine === 'QWENTTS'
                ? ttsStatus?.reachable
                  ? 'text-[#10B981]'
                  : 'text-[#F59E0B]'
                : currentEngine === 'BROWSER'
                ? 'text-[#00E5FF]'
                : googleAvailable
                ? 'text-[#10B981]'
                : 'text-[#F59E0B]'
            }`}
            title={ttsStatus?.note || ''}
          >
            {currentEngine === 'QWENTTS'
              ? ttsStatus?.reachable
                ? `VERBUNDEN (${ttsStatus.activeModel || 'qwen3-tts'})`
                : 'OFFLINE · FALLBACK'
              : currentEngine === 'BROWSER'
              ? 'WEB SPEECH NATURAL'
              : googleAvailable
              ? `NATURAL HD (${googleTts?.model || 'gemini-3.8-flash-lite-tts'})`
              : ttsStatus?.reachable
              ? 'QWEN / BROWSER FALLBACK'
              : 'API KEY FEHLT · FALLBACK'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {currentEngine === 'QWENTTS' ? (
            <select
              value={voiceSnap.prefs.qwenSpeaker || 'ryan'}
              onChange={(e) =>
                voiceCommentatorService.updatePrefs({ qwenSpeaker: e.target.value })
              }
              aria-label="Qwen3-TTS Sprecher"
              className="bg-[#07090E] border border-[#263042] text-[#E6EDF3] text-[10px] px-1.5 py-0.5 font-mono max-w-[165px]"
            >
              {speakers.map((sp) => (
                <option key={sp} value={sp}>
                  {sp}
                </option>
              ))}
            </select>
          ) : currentEngine === 'BROWSER' ? (
            <select
              value={voiceSnap.prefs.voiceName}
              onChange={(e) =>
                voiceCommentatorService.updatePrefs({ voiceName: e.target.value })
              }
              aria-label="Browser Sprecherstimme"
              className="bg-[#07090E] border border-[#263042] text-[#E6EDF3] text-[10px] px-1.5 py-0.5 font-mono max-w-[165px]"
            >
              {voiceSnap.availableVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          ) : (
            <select
              value={voiceSnap.prefs.googleVoice || 'Kore'}
              onChange={(e) =>
                voiceCommentatorService.updatePrefs({ googleVoice: e.target.value })
              }
              aria-label="Google Natural Voice Sprecher"
              className="bg-[#07090E] border border-[#263042] text-[#E6EDF3] text-[10px] px-1.5 py-0.5 font-mono max-w-[175px]"
            >
              {googleVoices.map((gv) => (
                <option key={gv.id} value={gv.id}>
                  {gv.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() =>
              voiceCommentatorService.speakDirectSentence(
                'Hier ist das Börsenstudio mit der natürlichen Google Live-Stimme.',
                'VOICE TEST'
              )
            }
            title="Ausgewählte Stimme jetzt testen"
            className="px-1.5 py-0.5 border border-[#263042] bg-[#07090E] text-[#089981] hover:border-[#089981] text-[9px] font-bold"
          >
            TEST
          </button>
          <button
            type="button"
            onClick={handleSaveSettings}
            title="Eingestellte Studio- und Stimmen-Werte dauerhaft speichern"
            className={`px-1.5 py-0.5 border text-[9px] font-bold flex items-center gap-1 whitespace-nowrap transition-colors ${
              savedNotice
                ? 'border-[#10B981] bg-[#10B981]/20 text-[#10B981]'
                : 'border-[#F59E0B]/60 bg-[#07090E] text-[#F59E0B] hover:border-[#F59E0B]'
            }`}
          >
            {savedNotice ? <Check className="w-2.5 h-2.5" /> : <Save className="w-2.5 h-2.5" />}
            <span>{savedNotice ? 'GESPEICHERT' : 'SPEICHERN'}</span>
          </button>
          <button
            type="button"
            onClick={handleRefreshTts}
            title="TTS Engine Status erneut prüfen"
            className="p-1 border border-[#263042] bg-[#07090E] text-[#8B95A5] hover:text-[#E6EDF3]"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${checkingTts ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {voiceSnap.lastError && (
        <div className="px-2 py-1 bg-[#1A1012] border border-[#F23645]/40 text-[9px] font-mono text-[#FCA5A5] truncate">
          TTS Hinweis: {voiceSnap.lastError}
        </div>
      )}
    </div>
  );
};
