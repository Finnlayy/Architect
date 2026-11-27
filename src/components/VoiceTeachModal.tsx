import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Play,
  Trash2,
  Plus,
  X,
  Volume2,
  Check,
  RotateCcw,
  Radio,
} from 'lucide-react';
import {
  CustomClipPlaybackMode,
  CustomEventAudioClipMeta,
  TeachableEventClipCategory,
  VoiceCommandBinding,
} from '../types/terminal';
import {
  DEFAULT_VOICE_COMMANDS,
  deleteClipBlobFromDb,
  extractAudioSignatureFromBlob,
  loadVoiceTeachData,
  playCustomEventClipBlob,
  saveClipBlobToDb,
  saveVoiceTeachData,
  updateClipPlaybackMode,
} from '../services/voiceTeachStore';
import {
  voiceCommandListener,
  VoiceListenerSnapshot,
} from '../services/voiceCommandListener';
import { arcadeSoundEngine } from '../services/arcadeSoundEngine';

interface VoiceTeachModalProps {
  isOpen: boolean;
  onClose: () => void;
  commands: VoiceCommandBinding[];
  onCommandsChange: (next: VoiceCommandBinding[]) => void;
  onExecuteCommandTest: (cmd: VoiceCommandBinding) => void;
}

type TeachTab = 'COMMANDS' | 'CLIPS';

interface SpeechRecOnce {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: any) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecCtor(): (new () => SpeechRecOnce) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, any>;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const VoiceTeachModal: React.FC<VoiceTeachModalProps> = ({
  isOpen,
  onClose,
  commands,
  onCommandsChange,
  onExecuteCommandTest,
}) => {
  const [activeTab, setActiveTab] = useState<TeachTab>('COMMANDS');
  const [clips, setClips] = useState<CustomEventAudioClipMeta[]>(
    () => loadVoiceTeachData().clips
  );
  const [listenerSnap, setListenerSnap] = useState<VoiceListenerSnapshot>(() =>
    voiceCommandListener.getSnapshot()
  );

  // Recording state shared safely (one active recorder at a time)
  const [recordingCommandId, setRecordingCommandId] = useState<string | null>(null);
  const [recordingClipCategory, setRecordingClipCategory] =
    useState<TeachableEventClipCategory | null>(null);
  const [recElapsedMs, setRecElapsedMs] = useState<number>(0);
  const [recLevel, setRecLevel] = useState<number>(0);
  const [recStatusMsg, setRecStatusMsg] = useState<string | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [playingClipCategory, setPlayingClipCategory] =
    useState<TeachableEventClipCategory | null>(null);

  // Manual phrase input state per command
  const [phraseDrafts, setPhraseDrafts] = useState<Record<string, string>>({});

  // Custom voice command creator
  const [newCmdPhrase, setNewCmdPhrase] = useState<string>('');
  const [newCmdReply, setNewCmdReply] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const sttRecRef = useRef<SpeechRecOnce | null>(null);
  const capturedTranscriptRef = useRef<string>('');

  useEffect(() => {
    return voiceCommandListener.subscribe((snap) => setListenerSnap(snap));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanupActiveRecording();
    } else {
      setClips(loadVoiceTeachData().clips);
      setRecError(null);
      setRecStatusMsg(null);
    }
    return () => {
      cleanupActiveRecording();
    };
  }, [isOpen]);

  const persistAll = (
    nextCommands: VoiceCommandBinding[],
    nextClips: CustomEventAudioClipMeta[]
  ) => {
    saveVoiceTeachData({ commands: nextCommands, clips: nextClips });
  };

  const cleanupActiveRecording = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (sttRecRef.current) {
      try {
        sttRecRef.current.stop();
      } catch {
        // ignore
      }
      sttRecRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setRecordingCommandId(null);
    setRecordingClipCategory(null);
    setRecElapsedMs(0);
    setRecLevel(0);
  };

  const startMicCapture = async (
    maxDurationMs: number,
    withStt: boolean,
    onDoneBlob: (blob: Blob, transcript: string, elapsedMs: number) => Promise<void>
  ) => {
    cleanupActiveRecording();
    setRecError(null);
    setRecStatusMsg(null);
    capturedTranscriptRef.current = '';

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRecError('Mikrofon wird von diesem Browser nicht unterstützt.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Audio level meter via AnalyserNode
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          setRecLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6.5));
          rafRef.current = window.requestAnimationFrame(loop);
        };
        rafRef.current = window.requestAnimationFrame(loop);
      }

      // Parallel one-shot SpeechRecognition to capture spoken trigger text automatically
      if (withStt) {
        const Ctor = getSpeechRecCtor();
        if (Ctor) {
          try {
            const sr = new Ctor();
            sr.lang = 'de-DE';
            sr.continuous = true;
            sr.interimResults = true;
            sr.onresult = (ev: any) => {
              const last = ev.results[ev.results.length - 1];
              const txt = String(last?.[0]?.transcript || '').trim();
              if (txt) capturedTranscriptRef.current = txt;
            };
            sr.onerror = () => {};
            sr.start();
            sttRecRef.current = sr;
          } catch {
            // ignore STT init error; audio signature fallback still works
          }
        }
      }

      const chunks: BlobPart[] = [];
      const mimeCandidate = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';
      const recorder = mimeCandidate
        ? new MediaRecorder(stream, { mimeType: mimeCandidate })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        const el = Date.now() - startedAt;
        setRecElapsedMs(el);
        if (el >= maxDurationMs && recorder.state === 'recording') {
          recorder.stop();
        }
      }, 100);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      recorder.onstop = async () => {
        const elapsed = Date.now() - startedAt;
        const transcript = capturedTranscriptRef.current;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        cleanupActiveRecording();
        await onDoneBlob(blob, transcript, elapsed);
      };

      recorder.start(100);
    } catch {
      cleanupActiveRecording();
      setRecError('Mikrofon-Freigabe abgelehnt. Bitte Browser-Berechtigung prüfen.');
    }
  };

  const handleTeachCommandMic = async (cmdId: string) => {
    if (recordingCommandId === cmdId) {
      mediaRecorderRef.current?.stop();
      return;
    }
    setRecordingCommandId(cmdId);
    await startMicCapture(3500, true, async (blob, transcript, elapsedMs) => {
      const { signature, durationMs } = await extractAudioSignatureFromBlob(blob);
      const next = commands.map((c) => {
        if (c.id !== cmdId) return c;
        const nextPhrases =
          transcript && !c.phrases.some((p) => p.toLowerCase() === transcript.toLowerCase())
            ? [transcript.toLowerCase(), ...c.phrases]
            : c.phrases;
        return {
          ...c,
          phrases: nextPhrases,
          audioSignature: signature.length > 0 ? signature : c.audioSignature,
          audioDurationMs: durationMs || elapsedMs,
          lastTrainedAt: Date.now(),
        };
      });
      onCommandsChange(next);
      persistAll(next, clips);
      arcadeSoundEngine.play('UI_FEEDBACK', { force: true });
      setRecStatusMsg(
        transcript
          ? `Befehl angelernt: "${transcript}" + Audio-Muster gespeichert.`
          : 'Audio-Vergleichsmuster gespeichert (Phrase optional manuell ergänzen).'
      );
    });
  };

  const handleRecordEventClip = async (eventType: TeachableEventClipCategory) => {
    if (recordingClipCategory === eventType) {
      mediaRecorderRef.current?.stop();
      return;
    }
    setRecordingClipCategory(eventType);
    await startMicCapture(9500, false, async (blob, _transcript, elapsedMs) => {
      await saveClipBlobToDb(eventType, blob);
      const nextClips = clips.map((c) =>
        c.eventType === eventType
          ? {
              ...c,
              hasAudio: true,
              mimeType: blob.type || 'audio/webm',
              durationMs: elapsedMs,
              enabled: true,
              updatedAt: Date.now(),
            }
          : c
      );
      setClips(nextClips);
      persistAll(commands, nextClips);
      arcadeSoundEngine.play('UI_FEEDBACK', { force: true });
      setRecStatusMsg(`Eigener Audio-Clip für ${eventType} gespeichert (${(elapsedMs / 1000).toFixed(1)}s).`);
    });
  };

  const handlePreviewClip = async (eventType: TeachableEventClipCategory) => {
    if (playingClipCategory) return;
    setPlayingClipCategory(eventType);
    const vol = arcadeSoundEngine.getPreferences().volume;
    await playCustomEventClipBlob(eventType, Math.max(0.25, vol));
    setPlayingClipCategory(null);
  };

  const handleDeleteClip = async (eventType: TeachableEventClipCategory) => {
    await deleteClipBlobFromDb(eventType);
    const nextClips = clips.map((c) =>
      c.eventType === eventType
        ? { ...c, hasAudio: false, durationMs: 0, updatedAt: Date.now() }
        : c
    );
    setClips(nextClips);
    persistAll(commands, nextClips);
  };

  const handleAddPhrase = (cmdId: string) => {
    const draft = (phraseDrafts[cmdId] || '').trim().toLowerCase();
    if (!draft) return;
    const next = commands.map((c) => {
      if (c.id !== cmdId) return c;
      if (c.phrases.includes(draft)) return c;
      return { ...c, phrases: [...c.phrases, draft] };
    });
    onCommandsChange(next);
    persistAll(next, clips);
    setPhraseDrafts((prev) => ({ ...prev, [cmdId]: '' }));
  };

  const handleRemovePhrase = (cmdId: string, phrase: string) => {
    const next = commands.map((c) => {
      if (c.id !== cmdId) return c;
      const filtered = c.phrases.filter((p) => p !== phrase);
      return { ...c, phrases: filtered.length > 0 ? filtered : c.phrases };
    });
    onCommandsChange(next);
    persistAll(next, clips);
  };

  const handleToggleCommand = (cmdId: string) => {
    const next = commands.map((c) =>
      c.id === cmdId ? { ...c, enabled: !c.enabled } : c
    );
    onCommandsChange(next);
    persistAll(next, clips);
  };

  const handleResetBuiltinPhrases = (cmdId: string) => {
    const def = DEFAULT_VOICE_COMMANDS.find((d) => d.id === cmdId);
    if (!def) return;
    const next = commands.map((c) =>
      c.id === cmdId
        ? { ...c, phrases: [...def.phrases], audioSignature: undefined, lastTrainedAt: undefined }
        : c
    );
    onCommandsChange(next);
    persistAll(next, clips);
  };

  const handleCreateCustomCommand = () => {
    const phrase = newCmdPhrase.trim().toLowerCase();
    const reply = newCmdReply.trim();
    if (!phrase || !reply) return;
    const created: VoiceCommandBinding = {
      id: `custom-cmd-${Date.now()}`,
      actionId: 'CUSTOM_SPEAK',
      label: `Eigene Ansage: "${phrase}"`,
      description: `Antwortet mit: ${reply}`,
      phrases: [phrase],
      customResponseText: reply,
      enabled: true,
      isBuiltin: false,
    };
    const next = [...commands, created];
    onCommandsChange(next);
    persistAll(next, clips);
    setNewCmdPhrase('');
    setNewCmdReply('');
  };

  const handleDeleteCustomCommand = (cmdId: string) => {
    const next = commands.filter((c) => c.id !== cmdId);
    onCommandsChange(next);
    persistAll(next, clips);
  };

  const handleClipModeChange = (
    eventType: TeachableEventClipCategory,
    mode: CustomClipPlaybackMode
  ) => {
    const nextClips = updateClipPlaybackMode(clips, eventType, mode);
    setClips(nextClips);
    persistAll(commands, nextClips);
  };

  const handleToggleClipEnabled = (eventType: TeachableEventClipCategory) => {
    const nextClips = clips.map((c) =>
      c.eventType === eventType ? { ...c, enabled: !c.enabled } : c
    );
    setClips(nextClips);
    persistAll(commands, nextClips);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 font-sans">
      <div className="w-full max-w-4xl max-h-[88vh] bg-[#0C1017] border border-[#263042] flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#07090E] border-b border-[#1B2230] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Mic className="w-4 h-4 text-[#00E5FF] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#E6EDF3] truncate">
                Sprachbefehle anlernen &amp; eigene Event-Clips aufnehmen
              </h2>
              <p className="text-[11px] text-[#8B95A5] truncate">
                Browser Speech-to-Text + Audio-Vergleich Fallback · Paper-Fills &amp; Backtests bleiben ausgeschlossen
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (listenerSnap.isListening) {
                  voiceCommandListener.stop();
                } else {
                  void voiceCommandListener.start();
                }
              }}
              className={`px-3 py-1.5 text-[11px] font-mono font-bold border flex items-center gap-1.5 whitespace-nowrap ${
                listenerSnap.isListening
                  ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]'
                  : 'bg-[#0C1017] border-[#1B2230] text-[#E6EDF3] hover:border-[#00E5FF]'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>
                {listenerSnap.isListening
                  ? listenerSnap.mode === 'STT_AND_FALLBACK'
                    ? 'MIC AKTIV (STT + AUDIO)'
                    : 'MIC AKTIV (AUDIO-VERGLEICH)'
                  : 'SPRACHSTEUERUNG STARTEN'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Modal schließen"
              className="p-1.5 bg-[#0C1017] border border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-4 bg-[#07090E] border-b border-[#1B2230] flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('COMMANDS')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap ${
                activeTab === 'COMMANDS'
                  ? 'border-[#00E5FF] text-[#00E5FF]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              1. Sprachbefehle teachen ({commands.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('CLIPS')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap ${
                activeTab === 'CLIPS'
                  ? 'border-[#089981] text-[#089981]'
                  : 'border-transparent text-[#8B95A5] hover:text-[#E6EDF3]'
              }`}
            >
              2. Eigene Event-Audio-Clips ({clips.filter((c) => c.hasAudio).length}/{clips.length})
            </button>
          </div>
          {listenerSnap.lastTranscript && (
            <div className="text-[11px] font-mono text-[#8B95A5] truncate max-w-[300px]">
              Zuletzt gehört: <span className="text-[#00E5FF]">{listenerSnap.lastTranscript}</span>
            </div>
          )}
        </div>

        {/* Recording Live Bar / Status */}
        {(recordingCommandId || recordingClipCategory || recStatusMsg || recError) && (
          <div
            className={`px-4 py-2 border-b text-xs font-mono flex items-center justify-between gap-3 ${
              recError
                ? 'bg-[#F23645]/10 border-[#F23645]/40 text-[#F23645]'
                : recordingCommandId || recordingClipCategory
                ? 'bg-[#F59E0B]/10 border-[#F59E0B]/40 text-[#F59E0B]'
                : 'bg-[#089981]/10 border-[#089981]/40 text-[#089981]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span>
                {recError
                  ? recError
                  : recordingCommandId || recordingClipCategory
                  ? `Aufnahme läuft · ${(recElapsedMs / 1000).toFixed(1)}s — Bitte jetzt klar sprechen`
                  : recStatusMsg}
              </span>
            </div>
            {(recordingCommandId || recordingClipCategory) && (
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-28 h-2 bg-[#07090E] border border-[#1B2230] overflow-hidden">
                  <div
                    className="h-full bg-[#F59E0B] transition-all duration-75"
                    style={{ width: `${Math.round(recLevel * 100)}%` }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => mediaRecorderRef.current?.stop()}
                  className="px-2 py-0.5 bg-[#F23645] text-white font-bold text-[10px] flex items-center gap-1"
                >
                  <Square className="w-2.5 h-2.5" />
                  STOPP
                </button>
              </div>
            )}
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {activeTab === 'COMMANDS' && (
            <>
              <div className="divide-y divide-[#1B2230] border border-[#1B2230] bg-[#07090E]">
                {commands.map((cmd) => {
                  const isRecThis = recordingCommandId === cmd.id;
                  return (
                    <div key={cmd.id} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-[#E6EDF3]">{cmd.label}</span>
                            <span className="text-[#566173]" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-[10px] text-[#8B95A5]">
                              {cmd.audioSignature && cmd.audioSignature.length > 0
                                ? `Audio-Muster angelernt (${((cmd.audioDurationMs || 0) / 1000).toFixed(1)}s)`
                                : 'Nur Text-Trigger'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8B95A5] mt-0.5">{cmd.description}</p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleTeachCommandMic(cmd.id)}
                            className={`px-2.5 py-1 text-[10px] font-mono font-bold border flex items-center gap-1 whitespace-nowrap ${
                              isRecThis
                                ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]'
                                : 'bg-[#0C1017] border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF]/10'
                            }`}
                          >
                            {isRecThis ? (
                              <>
                                <Square className="w-3 h-3" />
                                <span>STOPP ({(recElapsedMs / 1000).toFixed(1)}s)</span>
                              </>
                            ) : (
                              <>
                                <Mic className="w-3 h-3" />
                                <span>PER MIC TEACHEN</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => onExecuteCommandTest(cmd)}
                            className="px-2 py-1 text-[10px] font-mono border border-[#1B2230] bg-[#0C1017] text-[#E6EDF3] hover:border-[#089981] hover:text-[#089981] flex items-center gap-1 whitespace-nowrap"
                          >
                            <Play className="w-2.5 h-2.5" />
                            <span>TESTEN</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleCommand(cmd.id)}
                            className={`px-2 py-1 text-[10px] font-mono font-bold border whitespace-nowrap ${
                              cmd.enabled
                                ? 'border-[#089981]/60 text-[#089981] bg-[#089981]/10'
                                : 'border-[#1B2230] text-[#566173]'
                            }`}
                          >
                            {cmd.enabled ? 'AKTIV' : 'AUS'}
                          </button>

                          {cmd.isBuiltin ? (
                            <button
                              type="button"
                              onClick={() => handleResetBuiltinPhrases(cmd.id)}
                              title="Trigger-Phrasen und Audio-Muster zurücksetzen"
                              className="p-1 border border-[#1B2230] text-[#8B95A5] hover:text-[#E6EDF3]"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomCommand(cmd.id)}
                              title="Eigenen Befehl löschen"
                              className="p-1 border border-[#1B2230] text-[#8B95A5] hover:text-[#F23645]"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Taught Trigger Phrases + Add Phrase Input */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] font-mono text-[#566173] mr-1">
                          TRIGGER-PHRASEN:
                        </span>
                        {cmd.phrases.map((phrase) => (
                          <span
                            key={phrase}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#E6EDF3]"
                          >
                            <span>"{phrase}"</span>
                            {cmd.phrases.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemovePhrase(cmd.id, phrase)}
                                aria-label={`Phrase ${phrase} entfernen`}
                                className="text-[#566173] hover:text-[#F23645]"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </span>
                        ))}
                        <div className="inline-flex items-center gap-1 ml-1">
                          <input
                            type="text"
                            placeholder="Neue Phrase…"
                            value={phraseDrafts[cmd.id] || ''}
                            onChange={(e) =>
                              setPhraseDrafts((prev) => ({ ...prev, [cmd.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddPhrase(cmd.id);
                              }
                            }}
                            className="w-36 px-2 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddPhrase(cmd.id)}
                            className="px-1.5 py-0.5 bg-[#0C1017] border border-[#1B2230] text-[10px] font-mono text-[#00E5FF] hover:border-[#00E5FF]"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Custom Spoken Response Command */}
              <div className="p-3 bg-[#07090E] border border-[#1B2230] space-y-2">
                <div className="text-xs font-semibold text-[#E6EDF3]">
                  Eigenen Sprachbefehl hinzufügen (z. B. für Stream-Begrüßung oder Info-Ansage)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input
                    type="text"
                    placeholder="Trigger-Wort (z. B. stream status)"
                    value={newCmdPhrase}
                    onChange={(e) => setNewCmdPhrase(e.target.value)}
                    className="md:col-span-4 px-2.5 py-1.5 bg-[#0C1017] border border-[#1B2230] text-xs font-mono text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                  />
                  <input
                    type="text"
                    placeholder="Gesprochene Antwort des Kommentators…"
                    value={newCmdReply}
                    onChange={(e) => setNewCmdReply(e.target.value)}
                    className="md:col-span-6 px-2.5 py-1.5 bg-[#0C1017] border border-[#1B2230] text-xs text-[#E6EDF3] focus:outline-none focus:border-[#00E5FF]"
                  />
                  <button
                    type="button"
                    onClick={handleCreateCustomCommand}
                    disabled={!newCmdPhrase.trim() || !newCmdReply.trim()}
                    className="md:col-span-2 px-3 py-1.5 bg-[#089981]/20 border border-[#089981] text-[#089981] text-xs font-mono font-bold flex items-center justify-center gap-1 disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>HINZUFÜGEN</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'CLIPS' && (
            <div className="divide-y divide-[#1B2230] border border-[#1B2230] bg-[#07090E]">
              {clips.map((clip) => {
                const isRecThis = recordingClipCategory === clip.eventType;
                const isPlayingThis = playingClipCategory === clip.eventType;
                return (
                  <div
                    key={clip.eventType}
                    className="p-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-[#E6EDF3]">{clip.label}</span>
                        <span className="text-[#566173]" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-[10px] text-[#8B95A5]">
                          {clip.hasAudio
                            ? `Aufgenommen (${(clip.durationMs / 1000).toFixed(1)}s)`
                            : 'Noch kein Clip'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8B95A5] mt-0.5">{clip.description}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {/* Record / Stop Button */}
                      <button
                        type="button"
                        onClick={() => void handleRecordEventClip(clip.eventType)}
                        className={`px-2.5 py-1 text-[10px] font-mono font-bold border flex items-center gap-1 whitespace-nowrap ${
                          isRecThis
                            ? 'bg-[#F23645]/20 border-[#F23645] text-[#F23645]'
                            : 'bg-[#0C1017] border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF]/10'
                        }`}
                      >
                        {isRecThis ? (
                          <>
                            <Square className="w-3 h-3" />
                            <span>STOPP ({(recElapsedMs / 1000).toFixed(1)}s)</span>
                          </>
                        ) : (
                          <>
                            <Mic className="w-3 h-3" />
                            <span>{clip.hasAudio ? 'NEU AUFNEHMEN' : 'AUFNEHMEN'}</span>
                          </>
                        )}
                      </button>

                      {/* Playback & Mode when recorded */}
                      {clip.hasAudio && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handlePreviewClip(clip.eventType)}
                            disabled={isPlayingThis}
                            className="px-2 py-1 text-[10px] font-mono border border-[#1B2230] bg-[#0C1017] text-[#E6EDF3] hover:border-[#089981] hover:text-[#089981] flex items-center gap-1 whitespace-nowrap"
                          >
                            <Volume2 className="w-3 h-3" />
                            <span>{isPlayingThis ? 'SPIELT…' : 'ABHÖREN'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleClipModeChange(
                                clip.eventType,
                                clip.playbackMode === 'INTRO_BEFORE_VOICE'
                                  ? 'REPLACE_VOICE'
                                  : 'INTRO_BEFORE_VOICE'
                              )
                            }
                            className="px-2 py-1 text-[10px] font-mono border border-[#1B2230] bg-[#0C1017] text-[#8B95A5] hover:text-[#E6EDF3] whitespace-nowrap"
                            title="Wählen, ob der eigene Clip als Intro vor dem Gemini-Kommentar oder anstelle der TTS-Stimme abgespielt wird"
                          >
                            {clip.playbackMode === 'INTRO_BEFORE_VOICE'
                              ? 'MODUS: INTRO + GEMINI'
                              : 'MODUS: NUR CLIP'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleClipEnabled(clip.eventType)}
                            className={`px-2 py-1 text-[10px] font-mono font-bold border whitespace-nowrap ${
                              clip.enabled
                                ? 'border-[#089981]/60 text-[#089981] bg-[#089981]/10'
                                : 'border-[#1B2230] text-[#566173]'
                            }`}
                          >
                            {clip.enabled ? (
                              <span className="inline-flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" /> AKTIV
                              </span>
                            ) : (
                              'AUS'
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteClip(clip.eventType)}
                            title="Aufgenommenen Clip löschen"
                            className="p-1 border border-[#1B2230] text-[#8B95A5] hover:text-[#F23645]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
