/**
 * OMEGA NIO — Hybrid Voice Command Listener
 *
 * Primary: Browser SpeechRecognition (`de-DE`, continuous + interim) with normalized/fuzzy phrase matching.
 * Fallback: Web Audio API microphone RMS-segment detector + 32-bin audio envelope cosine matching
 *           against taught audio signatures when SpeechRecognition is unavailable or fails.
 */
import { VoiceCommandBinding } from '../types/terminal';
import {
  computeSignatureFromRmsFrames,
  matchAudioSignature,
  matchTranscriptToCommand,
} from './voiceTeachStore';

export type VoiceListenerMode = 'OFF' | 'STT_AND_FALLBACK' | 'AUDIO_FALLBACK_ONLY';

export interface VoiceListenerSnapshot {
  isListening: boolean;
  mode: VoiceListenerMode;
  sttSupported: boolean;
  micLevel: number; // 0..1
  lastTranscript: string;
  lastMatchedLabel: string | null;
  lastMatchMethod: 'STT' | 'AUDIO_COMPARE' | null;
  error: string | null;
}

export type VoiceCommandMatchCallback = (
  command: VoiceCommandBinding,
  detail: { method: 'STT' | 'AUDIO_COMPARE'; transcript?: string; confidence: number }
) => void;

type SnapshotListener = (snap: VoiceListenerSnapshot) => void;

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, any>;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

class VoiceCommandListenerService {
  private sttSupported = !!getSpeechRecognitionCtor();
  private recognition: SpeechRecognitionInstance | null = null;
  private isListening = false;
  private isSuppressedForPlayback = false;
  private commands: VoiceCommandBinding[] = [];
  private onMatch: VoiceCommandMatchCallback | null = null;
  private listeners: Set<SnapshotListener> = new Set();

  // Audio fallback / level meter state
  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId: number | null = null;
  private activeSegmentRms: number[] = [];
  private silenceFrames = 0;
  private lastCommandTriggerAt = 0;
  private fallbackActive = false;

  private snapshot: VoiceListenerSnapshot = {
    isListening: false,
    mode: 'OFF',
    sttSupported: this.sttSupported,
    micLevel: 0,
    lastTranscript: '',
    lastMatchedLabel: null,
    lastMatchMethod: null,
    error: null,
  };

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<VoiceListenerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const snapCopy = { ...this.snapshot };
    for (const l of this.listeners) {
      try {
        l(snapCopy);
      } catch {
        // ignore listener error
      }
    }
  }

  public setCommands(commands: VoiceCommandBinding[]): void {
    this.commands = commands;
  }

  public setOnMatch(cb: VoiceCommandMatchCallback | null): void {
    this.onMatch = cb;
  }

  public setSuppressedForPlayback(suppressed: boolean): void {
    this.isSuppressedForPlayback = suppressed;
    if (suppressed) {
      this.activeSegmentRms = [];
      this.silenceFrames = 0;
    }
  }

  public getSnapshot(): VoiceListenerSnapshot {
    return { ...this.snapshot };
  }

  public async start(): Promise<void> {
    if (this.isListening) return;
    if (typeof window === 'undefined') return;

    this.isListening = true;
    this.emit({ error: null });

    // Start microphone analyser for level display & Audio-Compare fallback
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.audioCtx = new AudioCtx();
          const source = this.audioCtx.createMediaStreamSource(this.micStream);
          this.analyser = this.audioCtx.createAnalyser();
          this.analyser.fftSize = 512;
          source.connect(this.analyser);
          this.startAudioMonitorLoop();
        }
      }
    } catch {
      this.isListening = false;
      this.emit({
        isListening: false,
        mode: 'OFF',
        error: 'Mikrofonzugriff wurde abgelehnt oder ist nicht verfügbar.',
      });
      return;
    }

    const SpeechCtor = getSpeechRecognitionCtor();
    if (SpeechCtor) {
      this.fallbackActive = false;
      this.startSpeechRecognition(SpeechCtor);
      this.emit({
        isListening: true,
        sttSupported: true,
        mode: 'STT_AND_FALLBACK',
      });
    } else {
      this.fallbackActive = true;
      this.emit({
        isListening: true,
        sttSupported: false,
        mode: 'AUDIO_FALLBACK_ONLY',
      });
    }
  }

  private startSpeechRecognition(SpeechCtor: new () => SpeechRecognitionInstance): void {
    try {
      const rec = new SpeechCtor();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event: any) => {
        if (!this.isListening || this.isSuppressedForPlayback) return;
        const resultIdx = event.results.length - 1;
        if (resultIdx < 0) return;
        const result = event.results[resultIdx];
        const transcript = String(result?.[0]?.transcript || '').trim();
        if (!transcript) return;

        this.emit({ lastTranscript: transcript });
        const now = Date.now();
        if (now - this.lastCommandTriggerAt < 1800) return;

        const match = matchTranscriptToCommand(transcript, this.commands);
        if (match && (result.isFinal || match.confidence >= 0.92)) {
          this.lastCommandTriggerAt = now;
          this.emit({
            lastMatchedLabel: match.command.label,
            lastMatchMethod: 'STT',
          });
          this.onMatch?.(match.command, {
            method: 'STT',
            transcript,
            confidence: match.confidence,
          });
        }
      };

      rec.onerror = (ev: any) => {
        const errCode = ev?.error || '';
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          this.fallbackActive = true;
          this.emit({
            mode: 'AUDIO_FALLBACK_ONLY',
            error: 'Browser Speech-to-Text blockiert — Audio-Vergleichs-Fallback aktiv.',
          });
          return;
        }
        if (errCode === 'network' || errCode === 'language-not-supported') {
          this.fallbackActive = true;
          this.emit({ mode: 'AUDIO_FALLBACK_ONLY' });
        }
      };

      rec.onend = () => {
        if (this.isListening && !this.fallbackActive) {
          window.setTimeout(() => {
            if (this.isListening && !this.fallbackActive) {
              try {
                rec.start();
              } catch {
                this.fallbackActive = true;
                this.emit({ mode: 'AUDIO_FALLBACK_ONLY' });
              }
            }
          }, 250);
        }
      };

      this.recognition = rec;
      rec.start();
    } catch {
      this.fallbackActive = true;
      this.emit({ mode: 'AUDIO_FALLBACK_ONLY' });
    }
  }

  private startAudioMonitorLoop(): void {
    if (!this.analyser) return;
    const data = new Float32Array(this.analyser.fftSize);

    const tick = () => {
      if (!this.isListening || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(data);

      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        sumSq += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSq / data.length);
      const normalizedLevel = Math.min(1, rms * 6.5);
      this.emit({ micLevel: normalizedLevel });

      // Audio comparison fallback segment capture when speaker is silent
      if (!this.isSuppressedForPlayback && this.fallbackActive) {
        if (rms > 0.032) {
          this.activeSegmentRms.push(rms);
          this.silenceFrames = 0;
          if (this.activeSegmentRms.length > 150) {
            this.evaluateAudioSegment();
          }
        } else if (this.activeSegmentRms.length > 0) {
          this.silenceFrames++;
          this.activeSegmentRms.push(rms);
          if (this.silenceFrames >= 14) {
            this.evaluateAudioSegment();
          }
        }
      }

      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  private evaluateAudioSegment(): void {
    const frames = this.activeSegmentRms;
    this.activeSegmentRms = [];
    this.silenceFrames = 0;

    if (frames.length < 12) return;
    const now = Date.now();
    if (now - this.lastCommandTriggerAt < 2000) return;

    const sig = computeSignatureFromRmsFrames(frames);
    if (sig.length === 0) return;

    const match = matchAudioSignature(sig, this.commands, 0.85);
    if (match) {
      this.lastCommandTriggerAt = now;
      this.emit({
        lastMatchedLabel: match.command.label,
        lastMatchMethod: 'AUDIO_COMPARE',
        lastTranscript: `[Audio-Muster ${Math.round(match.similarity * 100)}%]`,
      });
      this.onMatch?.(match.command, {
        method: 'AUDIO_COMPARE',
        confidence: match.similarity,
      });
    }
  }

  public stop(): void {
    this.isListening = false;
    this.fallbackActive = false;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyser = null;
    this.activeSegmentRms = [];
    this.emit({
      isListening: false,
      mode: 'OFF',
      micLevel: 0,
    });
  }
}

export const voiceCommandListener = new VoiceCommandListenerService();
