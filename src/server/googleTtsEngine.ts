/**
 * OMEGA NIO — Google Natural Voices TTS Engine (Server-Side)
 *
 * Uses @google/genai (`gemini-3.8-flash-lite-tts`) strictly server-side via process.env.GEMINI_API_KEY
 * to synthesize studio-quality natural voice WAV audio for the Live Broadcast Commentator.
 *
 * Returns complete binary WAV buffers directly from Gemini `inlineData` (24kHz mono 16-bit PCM WAV)
 * with a strictly bounded O(1) LRU byte-budgeted cache so memory usage remains flat 24/7.
 */
import { GoogleGenAI } from '@google/genai';
import { GoogleNaturalVoiceMeta, GoogleTtsStatus } from '../types/terminal';

export const GOOGLE_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;
const MAX_CACHE_BYTES = 8 * 1024 * 1024; // 8 MB hard cap

export const GOOGLE_NATURAL_VOICES: GoogleNaturalVoiceMeta[] = [
  {
    id: 'Kore',
    label: 'Kore · Studio Anchor (Klar)',
    style: 'Clear, natural, authoritative German financial broadcast news anchor',
    pitchHint: 'Studio Balanced',
  },
  {
    id: 'Charon',
    label: 'Charon · Chef-Analyst (Tief)',
    style: 'Deep, calm, analytical German institutional market strategist',
    pitchHint: 'Deep & Calm',
  },
  {
    id: 'Puck',
    label: 'Puck · Breaking News (Dynamisch)',
    style: 'Crisp, energetic, fast-paced German live market ticker reporter',
    pitchHint: 'Bright & Crisp',
  },
  {
    id: 'Fenrir',
    label: 'Fenrir · Quant Desk (Kraftvoll)',
    style: 'Confident, resonant, decisive German quantitative desk commentator',
    pitchHint: 'Resonant',
  },
  {
    id: 'Zephyr',
    label: 'Zephyr · Closing Bell (Warm)',
    style: 'Warm, articulate, poised German financial studio host',
    pitchHint: 'Warm & Smooth',
  },
];

const VOICE_MAP = new Map<string, GoogleNaturalVoiceMeta>(
  GOOGLE_NATURAL_VOICES.map((v) => [v.id.toLowerCase(), v])
);

interface CachedAudioEntry {
  audioBuffer: Buffer;
  contentType: string;
  voiceName: string;
  expiresAt: number;
}

const audioCache = new Map<string, CachedAudioEntry>();
let totalCachedBytes = 0;

const sharedClients = new Map<string, GoogleGenAI>();
let lastApiKeyUsed = '';
let preferredAttemptIdx = 0;

function getGeminiClient(apiVersion?: 'v1beta' | 'v1alpha'): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  if (lastApiKeyUsed !== apiKey) {
    lastApiKeyUsed = apiKey;
    sharedClients.clear();
  }
  const cacheKey = apiVersion || 'default';
  let client = sharedClients.get(cacheKey);
  if (!client) {
    client = new GoogleGenAI({
      apiKey,
      httpOptions: {
        ...(apiVersion ? { apiVersion } : {}),
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    sharedClients.set(cacheKey, client);
  }
  return client;
}

function cleanSpeechText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

function evictCacheKey(key: string): void {
  const existing = audioCache.get(key);
  if (!existing) return;
  totalCachedBytes = Math.max(0, totalCachedBytes - existing.audioBuffer.byteLength);
  audioCache.delete(key);
}

function setCachedAudio(key: string, entry: CachedAudioEntry): void {
  if (entry.audioBuffer.byteLength > MAX_CACHE_BYTES / 2) return;
  evictCacheKey(key);
  audioCache.set(key, entry);
  totalCachedBytes += entry.audioBuffer.byteLength;

  const now = Date.now();
  for (const [k, v] of audioCache.entries()) {
    if (v.expiresAt <= now) {
      evictCacheKey(k);
    }
  }
  while (audioCache.size > MAX_CACHE_ENTRIES || totalCachedBytes > MAX_CACHE_BYTES) {
    const oldestKey = audioCache.keys().next().value;
    if (!oldestKey) break;
    evictCacheKey(oldestKey);
  }
}

export function pruneGoogleTtsCache(aggressive = false): void {
  const now = Date.now();
  for (const [k, v] of audioCache.entries()) {
    if (v.expiresAt <= now) {
      evictCacheKey(k);
    }
  }
  const targetMax = aggressive ? 4 : MAX_CACHE_ENTRIES;
  while (audioCache.size > targetMax || totalCachedBytes > MAX_CACHE_BYTES) {
    const oldestKey = audioCache.keys().next().value;
    if (!oldestKey) break;
    evictCacheKey(oldestKey);
  }
}

export function getGoogleTtsStatus(): GoogleTtsStatus {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  return {
    available: Boolean(apiKey),
    model: GOOGLE_TTS_MODEL,
    defaultVoice: 'Kore',
    voices: GOOGLE_NATURAL_VOICES,
  };
}

export interface GoogleTtsSynthesizeRequest {
  text: unknown;
  voice?: unknown;
  style?: unknown;
}

export type GoogleTtsSynthesizeResult =
  | {
      ok: true;
      audioBuffer: Buffer;
      contentType: string;
      voiceName: string;
      model: string;
    }
  | {
      ok: false;
      statusCode: number;
      reason: string;
    };

export async function synthesizeWithGoogleTts(
  req: GoogleTtsSynthesizeRequest
): Promise<GoogleTtsSynthesizeResult> {
  const cleanText = cleanSpeechText(req.text);
  if (!cleanText) {
    return { ok: false, statusCode: 400, reason: 'Kein Sprechtext übergeben.' };
  }

  if (!(process.env.GEMINI_API_KEY || '').trim()) {
    return {
      ok: false,
      statusCode: 503,
      reason: 'GEMINI_API_KEY ist auf dem Server nicht konfiguriert.',
    };
  }

  const requestedVoice = typeof req.voice === 'string' ? req.voice.trim().toLowerCase() : 'kore';
  const voiceMeta = VOICE_MAP.get(requestedVoice) || GOOGLE_NATURAL_VOICES[0];
  const customStyle = cleanSpeechText(req.style);
  const style = customStyle || voiceMeta.style;

  const cacheKey = `${voiceMeta.id}|${style}|${cleanText}`;
  const cached = audioCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    audioCache.delete(cacheKey);
    audioCache.set(cacheKey, cached);
    return {
      ok: true,
      audioBuffer: cached.audioBuffer,
      contentType: cached.contentType,
      voiceName: cached.voiceName,
      model: GOOGLE_TTS_MODEL,
    };
  }

  const attempts: Array<{
    apiVersion?: 'v1beta' | 'v1alpha';
    model: string;
    includeSpeechMetadata: boolean;
    includeSpeechConfig: boolean;
  }> = [
    {
      apiVersion: 'v1beta',
      model: GOOGLE_TTS_MODEL,
      includeSpeechMetadata: true,
      includeSpeechConfig: true,
    },
    {
      apiVersion: 'v1alpha',
      model: GOOGLE_TTS_MODEL,
      includeSpeechMetadata: true,
      includeSpeechConfig: true,
    },
    {
      apiVersion: 'v1beta',
      model: GOOGLE_TTS_MODEL,
      includeSpeechMetadata: false,
      includeSpeechConfig: true,
    },
    {
      apiVersion: 'v1beta',
      model: 'gemini-2.5-flash-preview-tts',
      includeSpeechMetadata: false,
      includeSpeechConfig: true,
    },
  ];

  let lastErrStatus = 502;
  let lastErrMessage = 'Google Natural Voice API Fehler.';

  const orderedAttempts =
    preferredAttemptIdx > 0 && preferredAttemptIdx < attempts.length
      ? [attempts[preferredAttemptIdx], ...attempts.filter((_, i) => i !== preferredAttemptIdx)]
      : attempts;

  for (const attempt of orderedAttempts) {
    const attemptIdx = attempts.indexOf(attempt);
    const ai = getGeminiClient(attempt.apiVersion);
    if (!ai) continue;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const part: any = attempt.includeSpeechMetadata
        ? {
            text: cleanText,
            speechMetadata: { style },
          }
        : {
            text: `${style}: ${cleanText}`,
          };

      const config: any = {
        responseModalities: ['AUDIO'],
      };
      if (attempt.includeSpeechConfig) {
        config.speechConfig = {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceMeta.id,
            },
          },
        };
      }

      const apiPromise = ai.models.generateContent({
        model: attempt.model,
        contents: [{ role: 'user', parts: [part] }],
        config,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('Google Natural Voice Synthese Timeout (15s).'));
        }, REQUEST_TIMEOUT_MS);
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);
      const audioPart = response?.candidates?.[0]?.content?.parts?.find(
        (p: any) => p?.inlineData?.data
      );
      const inlineData = audioPart?.inlineData;
      if (!inlineData?.data) {
        lastErrStatus = 502;
        lastErrMessage = 'Google TTS lieferte keine Audio-Daten zurück.';
        continue;
      }

      const audioBuffer = Buffer.from(inlineData.data, 'base64');
      if (audioBuffer.byteLength < 64) {
        lastErrStatus = 502;
        lastErrMessage = 'Google TTS lieferte ein ungültiges/leeres Audio-Fragment.';
        continue;
      }

      const contentType =
        typeof inlineData.mimeType === 'string' && inlineData.mimeType.startsWith('audio/')
          ? inlineData.mimeType
          : 'audio/wav';

      if (attemptIdx >= 0) {
        preferredAttemptIdx = attemptIdx;
      }

      setCachedAudio(cacheKey, {
        audioBuffer,
        contentType,
        voiceName: voiceMeta.id,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return {
        ok: true,
        audioBuffer,
        contentType,
        voiceName: voiceMeta.id,
        model: attempt.model,
      };
    } catch (err: any) {
      lastErrStatus =
        typeof err?.status === 'number' && err.status >= 400 && err.status < 600
          ? err.status
          : 502;
      lastErrMessage = err?.message || 'Google Natural Voice API Fehler.';
      const isSchemaOrModelMismatch =
        lastErrStatus === 400 ||
        lastErrStatus === 404 ||
        /Cannot find field|Unknown name|not found|not supported/i.test(lastErrMessage);
      if (!isSchemaOrModelMismatch) {
        break;
      }
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  return {
    ok: false,
    statusCode: lastErrStatus,
    reason: lastErrMessage,
  };
}
