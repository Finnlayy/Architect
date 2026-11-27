import React from 'react';
import {
  Mic,
  Pause,
  Play,
  SkipForward,
  RotateCcw,
  Maximize2,
  SlidersHorizontal,
  Globe,
  Radio,
} from 'lucide-react';
import { CmcIntelligencePayload } from '../types/terminal';
import {
  voiceCommentatorService,
  VoiceCommentatorSnapshot,
} from '../services/voiceCommentatorService';
import {
  voiceCommandListener,
  VoiceListenerSnapshot,
} from '../services/voiceCommandListener';

interface LiveCommentatorDeskProps {
  voiceSnap: VoiceCommentatorSnapshot;
  listenerSnap: VoiceListenerSnapshot;
  cmcData: CmcIntelligencePayload | null;
  activeSymbol: string;
  onOpenTeachModal: () => void;
  onEnterFullscreenStream: () => void;
}

export const LiveCommentatorDesk: React.FC<LiveCommentatorDeskProps> = ({
  voiceSnap,
  listenerSnap,
  cmcData,
  activeSymbol,
  onOpenTeachModal,
  onEnterFullscreenStream,
}) => {
  const activeOrLast = voiceSnap.currentItem || voiceSnap.history[0] || null;
  const isSpeaking = voiceSnap.status === 'SPEAKING';
  const isGenerating = voiceSnap.status === 'GENERATING';

  return (
    <div className="bg-[#07090E] border-b border-[#1B2230] p-2.5 space-y-2 shrink-0">
      {/* Top Bar: Desk Title + On-Air Status + Fullscreen YouTube Stream Button */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Mic
            className={`w-3.5 h-3.5 shrink-0 ${
              isSpeaking
                ? 'text-[#EF4444]'
                : voiceSnap.isVoiceModeActive
                ? 'text-[#089981]'
                : 'text-[#8B95A5]'
            }`}
          />
          <span className="text-[10px] font-bold tracking-wider uppercase text-[#E6EDF3] truncate">
            LIVE VOICE DESK
          </span>
          <span
            className={`text-[9px] font-mono font-bold whitespace-nowrap ${
              isSpeaking
                ? 'text-[#EF4444]'
                : isGenerating
                ? 'text-[#00E5FF]'
                : voiceSnap.isPaused
                ? 'text-[#F59E0B]'
                : voiceSnap.isVoiceModeActive
                ? 'text-[#089981]'
                : 'text-[#566173]'
            }`}
          >
            {isSpeaking
              ? 'ON AIR'
              : isGenerating
              ? 'TEXTET…'
              : voiceSnap.isPaused
              ? 'PAUSIERT'
              : voiceSnap.isVoiceModeActive
              ? 'BEREIT'
              : 'STIL 5 AUS'}
          </span>
        </div>

        <button
          type="button"
          onClick={onEnterFullscreenStream}
          title="Fullscreen Live-Kommentator Stream ohne Backtest- und Paper-Bereiche öffnen (YouTube Livestream)"
          className="px-2 py-0.5 bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 border border-[#00E5FF]/60 text-[#00E5FF] text-[9px] font-mono font-bold flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <Maximize2 className="w-2.5 h-2.5" />
          <span>LIVESTREAM</span>
        </button>
      </div>

      {/* Quick Activation Banner when user is not yet on 5th Sound Style */}
      {!voiceSnap.isVoiceModeActive && (
        <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#0C1017] border border-[#1B2230] text-[10px]">
          <span className="text-[#8B95A5] truncate">
            5. Sound-Stil für Live-Kommentar aktivieren
          </span>
          <button
            type="button"
            onClick={() => {
              voiceCommentatorService.activateVoiceMode();
              voiceCommentatorService.announceCmcMarketPulse(cmcData, activeSymbol);
            }}
            className="px-2 py-0.5 bg-[#089981]/20 border border-[#089981] text-[#089981] font-mono font-bold text-[9px] whitespace-nowrap shrink-0"
          >
            AKTIVIEREN
          </button>
        </div>
      )}

      {/* Live Transcript Box */}
      <div className="bg-[#0C1017] border border-[#1B2230] p-2 space-y-1">
        {activeOrLast ? (
          <>
            <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-[#8B95A5]">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span>{activeOrLast.timeFormatted}</span>
                <span aria-hidden="true">·</span>
                <span className="text-[#00E5FF] font-bold">{activeOrLast.symbol}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {activeOrLast.generatedBy === 'gemini'
                    ? 'Gemini Anchor'
                    : activeOrLast.generatedBy === 'custom_clip'
                    ? 'Eigener Clip'
                    : 'Live-Desk'}
                </span>
              </div>
              {voiceSnap.queue.length > 0 && (
                <span className="text-[#F59E0B] shrink-0">+{voiceSnap.queue.length} Queue</span>
              )}
            </div>
            <p className="text-[11px] leading-snug text-[#E6EDF3] line-clamp-3">
              {activeOrLast.spokenText}
            </p>
            {activeOrLast.metaFactSummary && (
              <div className="text-[9px] font-mono text-[#8B95A5] truncate pt-0.5 border-t border-[#1B2230]/70">
                {activeOrLast.metaFactSummary}
              </div>
            )}
          </>
        ) : (
          <div className="text-[10px] text-[#8B95A5] leading-snug">
            Wartet auf neue Chronicle-, Headline- oder DEX-Events. Paper-Fills &amp; Backtests werden ignoriert.
          </div>
        )}
      </div>

      {/* Controls Strip + Teach Modal Trigger */}
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => voiceCommentatorService.togglePause()}
            title={voiceSnap.isPaused ? 'Kommentator fortsetzen' : 'Kommentator pausieren'}
            className={`px-1.5 py-1 border text-[9px] font-mono flex items-center gap-1 whitespace-nowrap ${
              voiceSnap.isPaused
                ? 'border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/15'
                : 'border-[#1B2230] text-[#E6EDF3] bg-[#0C1017] hover:border-[#00E5FF]'
            }`}
          >
            {voiceSnap.isPaused ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
            <span>{voiceSnap.isPaused ? 'WEITER' : 'PAUSE'}</span>
          </button>

          <button
            type="button"
            onClick={() => voiceCommentatorService.skipCurrent()}
            title="Aktuelle Meldung überspringen"
            className="p-1 border border-[#1B2230] bg-[#0C1017] text-[#8B95A5] hover:text-[#E6EDF3]"
          >
            <SkipForward className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => voiceCommentatorService.replayLast()}
            title="Letzten Bericht wiederholen"
            className="p-1 border border-[#1B2230] bg-[#0C1017] text-[#8B95A5] hover:text-[#E6EDF3]"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={() => voiceCommentatorService.announceCmcMarketPulse(cmcData, activeSymbol)}
            title="CMC & DEX Markt-Überblick jetzt vorlesen"
            className="px-1.5 py-1 border border-[#1B2230] bg-[#0C1017] text-[#60A5FA] hover:border-[#60A5FA] text-[9px] font-mono flex items-center gap-1 whitespace-nowrap"
          >
            <Globe className="w-2.5 h-2.5" />
            <span>CMC</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (listenerSnap.isListening) {
                voiceCommandListener.stop();
              } else {
                void voiceCommandListener.start();
              }
            }}
            title="Sprachbefehl-Mikrofon ein-/ausschalten"
            className={`px-1.5 py-1 border text-[9px] font-mono flex items-center gap-1 whitespace-nowrap ${
              listenerSnap.isListening
                ? 'border-[#F59E0B] text-[#F59E0B] bg-[#F59E0B]/15'
                : 'border-[#1B2230] text-[#8B95A5] bg-[#0C1017] hover:text-[#E6EDF3]'
            }`}
          >
            <Radio className="w-2.5 h-2.5" />
            <span>{listenerSnap.isListening ? 'MIC AN' : 'MIC'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenTeachModal}
            title="Sprachbefehle anlernen und eigene Event-Audio-Clips aufnehmen"
            className="px-1.5 py-1 border border-[#089981]/60 bg-[#089981]/15 text-[#089981] hover:bg-[#089981]/25 text-[9px] font-mono font-bold flex items-center gap-1 whitespace-nowrap"
          >
            <SlidersHorizontal className="w-2.5 h-2.5" />
            <span>BEFEHLE &amp; CLIPS</span>
          </button>
        </div>
      </div>

      {listenerSnap.lastMatchedLabel && (
        <div className="text-[9px] font-mono text-[#F59E0B] truncate">
          Sprachbefehl: {listenerSnap.lastMatchedLabel} ({listenerSnap.lastMatchMethod})
        </div>
      )}
    </div>
  );
};
