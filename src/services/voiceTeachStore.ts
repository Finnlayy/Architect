/**
 * OMEGA NIO — Voice Teach & Custom Event Audio Clip Store
 *
 * Persists:
 *  - Teachable Voice Command Bindings (phrases + optional 32-bin RMS envelope signature) in localStorage
 *  - Custom Event Audio Clips metadata in localStorage + raw audio Blobs in IndexedDB
 *
 * Strictly excludes Paper Order Fills and Backtest Results from voice clip triggers.
 */
import {
  CustomClipPlaybackMode,
  CustomEventAudioClipMeta,
  TeachableEventClipCategory,
  VoiceCommandBinding,
} from '../types/terminal';

const VOICE_TEACH_STORAGE_KEY = 'omega_voice_teach_prefs_v1';
const DB_NAME = 'omega_voice_clips_db_v1';
const STORE_NAME = 'event_audio_clips';
const SIGNATURE_BINS = 32;

export const DEFAULT_VOICE_COMMANDS: VoiceCommandBinding[] = [
  {
    id: 'cmd-toggle-pause',
    actionId: 'TOGGLE_PAUSE',
    label: 'Kommentator pausieren / fortsetzen',
    description: 'Schaltet den Live-Kommentator vorübergehend stumm oder setzt die Moderation fort.',
    phrases: ['kommentator pause', 'pause', 'weiter sprechen', 'kommentator weiter'],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'cmd-skip-event',
    actionId: 'SKIP_EVENT',
    label: 'Aktuelle Meldung überspringen',
    description: 'Bricht die laufende Sprachansage ab und springt zum nächsten Ereignis.',
    phrases: ['überspringen', 'nächstes event', 'nächste meldung', 'skip'],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'cmd-replay-last',
    actionId: 'REPLAY_LAST',
    label: 'Letzten Bericht wiederholen',
    description: 'Liest die zuletzt gesendete Analyse noch einmal vor.',
    phrases: ['wiederholen', 'nochmal', 'replay'],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'cmd-toggle-fullscreen',
    actionId: 'TOGGLE_FULLSCREEN',
    label: 'Livestream Fullscreen umschalten',
    description: 'Wechselt in den YouTube-Fullscreen-Modus (oder wieder zurück).',
    phrases: ['livestream starten', 'livestream beenden', 'vollbild', 'fullscreen'],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'cmd-read-cmc-pulse',
    actionId: 'READ_CMC_PULSE',
    label: 'CMC & DEX Markt-Überblick vorlesen',
    description: 'Startet sofort ein aktuelles Briefing mit Fear & Greed, BTC-Dominanz und Top-DEX-Flow.',
    phrases: ['markt überblick', 'cmc fakten', 'dex update', 'marktbericht'],
    enabled: true,
    isBuiltin: true,
  },
  {
    id: 'cmd-focus-symbol',
    actionId: 'FOCUS_LATEST_SYMBOL',
    label: 'Aktuelles Event-Symbol fokussieren',
    description: 'Öffnet das Symbol der aktuellen Moderation direkt im Live-Chart.',
    phrases: ['symbol zeigen', 'chart öffnen', 'fokus'],
    enabled: true,
    isBuiltin: true,
  },
];

export const DEFAULT_EVENT_CLIP_METAS: CustomEventAudioClipMeta[] = [
  {
    eventType: 'BROADCAST_INTRO',
    label: 'Sendungs-Intro / Begrüßung',
    description: 'Wird beim manuellen Start oder ersten Broadcast im Voice-Modus abgespielt.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'RVOL_SPIKE',
    label: 'RVOL Spike (>2.0x Volumen)',
    description: 'Eigener Voice-Drop oder Jingle bei neuen Volumen-Anomalien im Screener.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'VWAP',
    label: 'VWAP Cross',
    description: 'Eigener Clip, wenn ein Asset den volumengewichteten Durchschnitt kreuzt.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'HIGH_OF_DAY',
    label: 'High of Day Breakout',
    description: 'Eigener Clip bei neuen Tageshoch-Ausbrüchen im Live-Chronicle.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'ZSCORE_BREAK',
    label: 'Z-Score Spread Break',
    description: 'Eigener Clip bei statistischer Auslenkung (>= 2σ).',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'CMC_HEADLINE',
    label: 'CMC Headline, Trends & Community',
    description: 'Eigener Clip für neue Nachrichten, Community-Votings oder CMC-Momentum.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'CMC_DEX_FLOW',
    label: 'DEX On-Chain Liquiditätssprung',
    description: 'Eigener Clip für frische DEX-Pool-Zuflüsse und On-Chain-Aktivität.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
  {
    eventType: 'SHADOW_TRIGGER',
    label: 'Phase / Shadow Struktur-Event',
    description: 'Eigener Clip für Phasen- und Strukturverschiebungen im Live-Markt.',
    hasAudio: false,
    mimeType: '',
    durationMs: 0,
    playbackMode: 'INTRO_BEFORE_VOICE',
    enabled: true,
    updatedAt: 0,
  },
];

interface StoredVoiceTeachData {
  commands: VoiceCommandBinding[];
  clips: CustomEventAudioClipMeta[];
}

function openClipsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB Fehler'));
  });
}

export async function saveClipBlobToDb(
  eventType: TeachableEventClipCategory,
  blob: Blob
): Promise<void> {
  const db = await openClipsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, eventType);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Clip konnte nicht gespeichert werden'));
    };
  });
}

export async function loadClipBlobFromDb(
  eventType: TeachableEventClipCategory
): Promise<Blob | null> {
  try {
    const db = await openClipsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(eventType);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as Blob) || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

export async function deleteClipBlobFromDb(
  eventType: TeachableEventClipCategory
): Promise<void> {
  try {
    const db = await openClipsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(eventType);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // ignore cleanup error
  }
}

export function loadVoiceTeachData(): StoredVoiceTeachData {
  if (typeof window === 'undefined') {
    return {
      commands: DEFAULT_VOICE_COMMANDS.map((c) => ({ ...c, phrases: [...c.phrases] })),
      clips: DEFAULT_EVENT_CLIP_METAS.map((c) => ({ ...c })),
    };
  }
  try {
    const raw = window.localStorage.getItem(VOICE_TEACH_STORAGE_KEY);
    if (!raw) {
      return {
        commands: DEFAULT_VOICE_COMMANDS.map((c) => ({ ...c, phrases: [...c.phrases] })),
        clips: DEFAULT_EVENT_CLIP_METAS.map((c) => ({ ...c })),
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredVoiceTeachData>;
    const savedCmdMap = new Map((parsed.commands || []).map((c) => [c.id, c]));
    const mergedBuiltins = DEFAULT_VOICE_COMMANDS.map((def) => {
      const existing = savedCmdMap.get(def.id);
      return existing
        ? {
            ...def,
            ...existing,
            phrases:
              Array.isArray(existing.phrases) && existing.phrases.length > 0
                ? existing.phrases
                : [...def.phrases],
          }
        : { ...def, phrases: [...def.phrases] };
    });
    const customCmds = (parsed.commands || []).filter((c) => !c.isBuiltin);

    const savedClipMap = new Map((parsed.clips || []).map((c) => [c.eventType, c]));
    const mergedClips = DEFAULT_EVENT_CLIP_METAS.map((def) => {
      const existing = savedClipMap.get(def.eventType);
      return existing ? { ...def, ...existing } : { ...def };
    });

    return {
      commands: [...mergedBuiltins, ...customCmds],
      clips: mergedClips,
    };
  } catch {
    return {
      commands: DEFAULT_VOICE_COMMANDS.map((c) => ({ ...c, phrases: [...c.phrases] })),
      clips: DEFAULT_EVENT_CLIP_METAS.map((c) => ({ ...c })),
    };
  }
}

export function saveVoiceTeachData(data: StoredVoiceTeachData): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VOICE_TEACH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota errors
  }
}

export function normalizeSpeechPhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

export function matchTranscriptToCommand(
  transcript: string,
  commands: VoiceCommandBinding[]
): { command: VoiceCommandBinding; matchedPhrase: string; confidence: number } | null {
  const normInput = normalizeSpeechPhrase(transcript);
  if (!normInput || normInput.length < 2) return null;

  let best: { command: VoiceCommandBinding; matchedPhrase: string; confidence: number } | null =
    null;

  for (const cmd of commands) {
    if (!cmd.enabled) continue;
    for (const phrase of cmd.phrases) {
      const normPhrase = normalizeSpeechPhrase(phrase);
      if (!normPhrase) continue;

      if (normInput === normPhrase) {
        return { command: cmd, matchedPhrase: phrase, confidence: 1.0 };
      }

      if (normInput.includes(normPhrase) && normPhrase.length >= 4) {
        const score = 0.92;
        if (!best || score > best.confidence) {
          best = { command: cmd, matchedPhrase: phrase, confidence: score };
        }
        continue;
      }

      // Token / fuzzy comparison on tail window
      const inputWords = normInput.split(' ');
      const phraseWords = normPhrase.split(' ');
      const tailText = inputWords.slice(-Math.max(phraseWords.length + 1, 3)).join(' ');
      const dist = levenshtein(tailText, normPhrase);
      const maxLen = Math.max(tailText.length, normPhrase.length, 1);
      const sim = 1 - dist / maxLen;
      if (sim >= 0.72 && (!best || sim > best.confidence)) {
        best = { command: cmd, matchedPhrase: phrase, confidence: Number(sim.toFixed(2)) };
      }
    }
  }

  return best;
}

/**
 * Extracts a compact 32-bin normalized RMS energy envelope signature from a recorded Blob
 * so audio-pattern comparison can act as fallback when SpeechRecognition is unavailable.
 */
export async function extractAudioSignatureFromBlob(
  blob: Blob
): Promise<{ signature: number[]; durationMs: number }> {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return { signature: [], durationMs: 0 };
    const ctx = new AudioCtx();
    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      const channel = decoded.getChannelData(0);
      const durationMs = Math.round(decoded.duration * 1000);
      const signature = computeEnvelopeSignatureFromSamples(channel);
      return { signature, durationMs };
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch {
    return { signature: [], durationMs: 0 };
  }
}

export function computeEnvelopeSignatureFromSamples(samples: Float32Array): number[] {
  if (!samples || samples.length < SIGNATURE_BINS) return [];

  // Trim leading/trailing silence above threshold
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak < 0.008) return [];

  const gate = peak * 0.12;
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < gate) start++;
  while (end > start && Math.abs(samples[end]) < gate) end--;

  const activeLen = Math.max(SIGNATURE_BINS, end - start + 1);
  const binSize = Math.floor(activeLen / SIGNATURE_BINS);
  const rawBins: number[] = [];

  for (let b = 0; b < SIGNATURE_BINS; b++) {
    const bStart = start + b * binSize;
    const bEnd = b === SIGNATURE_BINS - 1 ? end + 1 : Math.min(samples.length, bStart + binSize);
    let sumSq = 0;
    let count = 0;
    for (let i = bStart; i < bEnd; i++) {
      sumSq += samples[i] * samples[i];
      count++;
    }
    rawBins.push(count > 0 ? Math.sqrt(sumSq / count) : 0);
  }

  // L2 normalize vector
  const norm = Math.sqrt(rawBins.reduce((acc, v) => acc + v * v, 0));
  if (norm <= 1e-6) return [];
  return rawBins.map((v) => Number((v / norm).toFixed(4)));
}

export function computeSignatureFromRmsFrames(frames: number[]): number[] {
  if (!frames || frames.length < 6) return [];
  let peak = 0;
  for (const v of frames) {
    if (v > peak) peak = v;
  }
  if (peak < 0.01) return [];

  const gate = peak * 0.15;
  let start = 0;
  let end = frames.length - 1;
  while (start < end && frames[start] < gate) start++;
  while (end > start && frames[end] < gate) end--;
  const slice = frames.slice(start, end + 1);
  if (slice.length < 4) return [];

  const bins: number[] = [];
  for (let b = 0; b < SIGNATURE_BINS; b++) {
    const pos = (b / (SIGNATURE_BINS - 1)) * (slice.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(slice.length - 1, lo + 1);
    const frac = pos - lo;
    bins.push(slice[lo] * (1 - frac) + slice[hi] * frac);
  }
  const norm = Math.sqrt(bins.reduce((acc, v) => acc + v * v, 0));
  if (norm <= 1e-6) return [];
  return bins.map((v) => Number((v / norm).toFixed(4)));
}

export function matchAudioSignature(
  sampleSig: number[],
  commands: VoiceCommandBinding[],
  threshold = 0.84
): { command: VoiceCommandBinding; similarity: number } | null {
  if (!sampleSig || sampleSig.length !== SIGNATURE_BINS) return null;
  let best: { command: VoiceCommandBinding; similarity: number } | null = null;

  for (const cmd of commands) {
    if (!cmd.enabled || !cmd.audioSignature || cmd.audioSignature.length !== SIGNATURE_BINS) {
      continue;
    }
    let dot = 0;
    for (let i = 0; i < SIGNATURE_BINS; i++) {
      dot += sampleSig[i] * cmd.audioSignature[i];
    }
    if (dot >= threshold && (!best || dot > best.similarity)) {
      best = { command: cmd, similarity: Number(dot.toFixed(3)) };
    }
  }
  return best;
}

export async function playCustomEventClipBlob(
  eventType: TeachableEventClipCategory,
  volume: number
): Promise<{ played: boolean; durationMs: number }> {
  const blob = await loadClipBlobFromDb(eventType);
  if (!blob) return { played: false, durationMs: 0 };

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    let settled = false;

    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      const dur = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
      URL.revokeObjectURL(objectUrl);
      resolve({ played, durationMs: dur });
    };

    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.play().catch(() => finish(false));
    window.setTimeout(() => finish(true), 12000);
  });
}

export function updateClipPlaybackMode(
  clips: CustomEventAudioClipMeta[],
  eventType: TeachableEventClipCategory,
  mode: CustomClipPlaybackMode
): CustomEventAudioClipMeta[] {
  return clips.map((c) => (c.eventType === eventType ? { ...c, playbackMode: mode } : c));
}
