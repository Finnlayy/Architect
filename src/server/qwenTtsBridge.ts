/**
 * OMEGA NIO — qwentts.cpp Backend TTS Bridge
 *
 * Connects Express to a locally compiled/running ServeurpersoCom/qwentts.cpp `tts-server`
 * daemon (OpenAI-compatible /v1/audio/speech + /v1/audio/voices).
 * When no GGUF daemon is active, reports clean status so the client falls back
 * seamlessly to Browser Web Speech Synthesis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TtsBackendStatus } from '../types/terminal';

const QWEN_BUILTIN_SPEAKERS = [
  'ryan',
  'vivian',
  'serena',
  'aiden',
  'ono_anna',
  'sohee',
  'uncle_fu',
  'eric',
  'dylan',
];

function sanitizeServerUrl(raw?: string): string {
  const fallback = 'http://127.0.0.1:8080';
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed = new URL(raw.trim());
    const host = parsed.hostname.toLowerCase();
    const isLocalHost =
      host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === 'qwentts';
    if (!isLocalHost && parsed.protocol !== 'https:') {
      return fallback;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    return parsed.origin;
  } catch {
    return fallback;
  }
}

export function cleanTtsText(raw: unknown, maxLen = 1000): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

let cachedStatus: TtsBackendStatus | null = null;
let cachedAt = 0;

export async function getQwenTtsStatus(force = false): Promise<TtsBackendStatus> {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < 10_000) {
    return cachedStatus;
  }

  const serverUrl = sanitizeServerUrl(process.env.QWENTTS_SERVER_URL);
  const repoDir = path.resolve(process.cwd(), 'vendor', 'qwentts.cpp');
  const repoInstalled = fs.existsSync(path.join(repoDir, 'CMakeLists.txt'));
  const builtBinaryFound =
    fs.existsSync(path.join(repoDir, 'build', 'tts-server')) ||
    fs.existsSync(path.join(repoDir, 'build', 'qwen-tts'));

  let reachable = false;
  let activeModel: string | null = null;
  let registeredVoices: string[] = [];
  let note = repoInstalled
    ? 'qwentts.cpp Repository integriert · warte auf lokalen tts-server / GGUF-Modelle'
    : 'qwentts.cpp nicht gefunden';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1600);
    const resp = await fetch(`${serverUrl}/v1/models`, {
      method: 'GET',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (resp.ok) {
      reachable = true;
      const json: any = await resp.json().catch(() => null);
      if (Array.isArray(json?.data) && json.data.length > 0) {
        activeModel = String(json.data[0].id || 'qwen3-tts');
      } else {
        activeModel = 'qwen3-tts';
      }
      note = `qwentts.cpp tts-server aktiv (${serverUrl})`;
    }
  } catch {
    reachable = false;
  }

  if (reachable) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1600);
      const voicesResp = await fetch(`${serverUrl}/v1/audio/voices`, {
        method: 'GET',
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (voicesResp.ok) {
        const vJson: any = await voicesResp.json().catch(() => null);
        if (Array.isArray(vJson?.voices)) {
          registeredVoices = vJson.voices
            .map((v: any) => (typeof v === 'string' ? v : String(v?.name || '')))
            .filter(Boolean);
        }
      }
    } catch {
      // optional endpoint
    }
  }

  cachedStatus = {
    configured: Boolean(process.env.QWENTTS_SERVER_URL) || builtBinaryFound || reachable,
    reachable,
    serverUrl,
    repoInstalled,
    builtBinaryFound,
    activeModel,
    speakers: QWEN_BUILTIN_SPEAKERS,
    registeredVoices,
    lastCheckedAt: now,
    note,
  };
  cachedAt = now;
  return cachedStatus;
}

export interface SynthesizeQwenParams {
  text: string;
  voice?: string;
  language?: string;
  seed?: number;
}

export async function synthesizeWithQwenTts(
  params: SynthesizeQwenParams
): Promise<{ ok: true; audioBuffer: Buffer; contentType: string } | { ok: false; reason: string }> {
  const input = cleanTtsText(params.text, 900);
  if (!input) {
    return { ok: false, reason: 'Leerer Sprechtext.' };
  }

  const status = await getQwenTtsStatus(false);
  if (!status.reachable) {
    return {
      ok: false,
      reason: 'Lokaler qwentts.cpp tts-server nicht erreichbar — Browser-Fallback aktiv.',
    };
  }

  const voice = cleanTtsText(params.voice || 'ryan', 48) || 'ryan';
  const language = cleanTtsText(params.language || 'German', 24) || 'German';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(`${status.serverUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input,
        voice,
        language,
        response_format: 'wav',
        seed: typeof params.seed === 'number' ? params.seed : 42,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      return {
        ok: false,
        reason: `qwentts.cpp HTTP ${resp.status}`,
      };
    }

    const arrayBuf = await resp.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength < 64) {
      return { ok: false, reason: 'Ungültige Audio-Antwort von qwentts.cpp.' };
    }

    return {
      ok: true,
      audioBuffer: Buffer.from(arrayBuf),
      contentType: resp.headers.get('content-type') || 'audio/wav',
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: err?.message || 'qwentts.cpp Timeout oder Verbindungsfehler',
    };
  }
}

export async function registerQwenClonedVoice(payload: {
  name: string;
  refText: string;
  wavB64?: string;
  spkB64?: string;
  rvqB64?: string;
}): Promise<{ ok: boolean; message: string }> {
  const status = await getQwenTtsStatus(true);
  if (!status.reachable) {
    return {
      ok: false,
      message: 'qwentts.cpp tts-server ist lokal nicht gestartet.',
    };
  }

  const name = cleanTtsText(payload.name, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
  const refText = cleanTtsText(payload.refText, 400);
  if (!name) {
    return { ok: false, message: 'Ungültiger Stimmname.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const resp = await fetch(`${status.serverUrl}/v1/audio/voices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        ref_text: refText,
        ...(payload.wavB64 ? { wav_b64: payload.wavB64 } : {}),
        ...(payload.spkB64 ? { spk_b64: payload.spkB64 } : {}),
        ...(payload.rvqB64 ? { rvq_b64: payload.rvqB64 } : {}),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      return { ok: false, message: `Voice-Registrierung fehlgeschlagen (${resp.status}).` };
    }
    cachedAt = 0;
    return { ok: true, message: `Stimme "${name}" in qwentts.cpp registriert.` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Verbindungsfehler zu qwentts.cpp.' };
  }
}
