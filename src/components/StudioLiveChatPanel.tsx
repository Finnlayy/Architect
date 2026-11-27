import React, { useState } from 'react';
import { MessageSquare, Send, Volume2, Youtube, Link2Off, RefreshCw } from 'lucide-react';
import { StudioChatMessage, StudioLiveChatState } from '../types/terminal';

interface StudioLiveChatPanelProps {
  chatState: StudioLiveChatState;
  isPolling: boolean;
  replyingIds: Record<string, boolean>;
  errorMsg: string | null;
  onConnectYoutube: (urlOrId: string) => Promise<void>;
  onDisconnectYoutube: () => Promise<void>;
  onPollNow: () => Promise<void>;
  onSendStudioMessage: (author: string, text: string) => Promise<void>;
  onToggleAutoAnswer: (enabled: boolean) => Promise<void>;
  onReplyAndSpeak: (msg: StudioChatMessage) => Promise<void>;
  onReplayQa: (msg: StudioChatMessage) => void;
}

export const StudioLiveChatPanel: React.FC<StudioLiveChatPanelProps> = ({
  chatState,
  isPolling,
  replyingIds,
  errorMsg,
  onConnectYoutube,
  onDisconnectYoutube,
  onPollNow,
  onSendStudioMessage,
  onToggleAutoAnswer,
  onReplyAndSpeak,
  onReplayQa,
}) => {
  const [ytInput, setYtInput] = useState<string>('');
  const [ytConnecting, setYtConnecting] = useState<boolean>(false);
  const [authorInput, setAuthorInput] = useState<string>('Zuschauer');
  const [msgInput, setMsgInput] = useState<string>('');
  const [sendingMsg, setSendingMsg] = useState<boolean>(false);

  const handleConnectYt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytInput.trim() || ytConnecting) return;
    setYtConnecting(true);
    try {
      await onConnectYoutube(ytInput.trim());
    } finally {
      setYtConnecting(false);
    }
  };

  const handleSendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim() || sendingMsg) return;
    setSendingMsg(true);
    try {
      await onSendStudioMessage(authorInput.trim() || 'Zuschauer', msgInput.trim());
      setMsgInput('');
    } finally {
      setSendingMsg(false);
    }
  };

  const messagesOrdered = [...chatState.messages].reverse();

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0B0F15]">
      {/* YouTube Live Stream Connector + Auto-Q&A Switch */}
      <div className="p-2.5 bg-[#07090E] border-b border-[#263042] space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#E6EDF3]">
            <Youtube className="w-3.5 h-3.5 text-[#EF4444]" />
            <span className="font-bold uppercase">YouTube Live &amp; Studio Chat</span>
          </div>

          <button
            type="button"
            onClick={() => void onToggleAutoAnswer(!chatState.autoAnswerQuestions)}
            className={`px-2 py-0.5 border text-[9px] font-mono font-bold whitespace-nowrap transition-colors ${
              chatState.autoAnswerQuestions
                ? 'border-[#089981] bg-[#089981]/15 text-[#089981]'
                : 'border-[#263042] bg-[#0C1118] text-[#8B95A5]'
            }`}
          >
            AUTO-Q&amp;A ON AIR: {chatState.autoAnswerQuestions ? 'AN' : 'AUS'}
          </button>
        </div>

        {chatState.youtubeConnected ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-[#0C1118] border border-[#089981]/50 text-[10px] font-mono">
            <div className="min-w-0 truncate text-[#089981]">
              VERBUNDEN: <span className="text-[#E6EDF3]">{chatState.youtubeTitle || chatState.youtubeVideoId}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void onPollNow()}
                title="YouTube Chat jetzt aktualisieren"
                className="p-1 border border-[#263042] text-[#8B95A5] hover:text-[#E6EDF3]"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${isPolling ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => void onDisconnectYoutube()}
                className="px-1.5 py-0.5 border border-[#F23645]/60 text-[#F23645] flex items-center gap-1 text-[9px] font-bold"
              >
                <Link2Off className="w-2.5 h-2.5" />
                <span>TRENNEN</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleConnectYt} className="flex items-center gap-1.5">
            <input
              type="text"
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="YouTube Live URL oder Video-ID einfügen…"
              className="flex-1 min-w-0 bg-[#0C1118] border border-[#263042] px-2 py-1 text-[10px] font-mono text-[#E6EDF3] placeholder:text-[#566173]"
            />
            <button
              type="submit"
              disabled={ytConnecting || !ytInput.trim()}
              className="px-2 py-1 border border-[#EF4444]/60 bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-[#FCA5A5] text-[10px] font-mono font-bold whitespace-nowrap disabled:opacity-40"
            >
              {ytConnecting ? 'VERBINDE…' : 'YT VERBINDEN'}
            </button>
          </form>
        )}

        {(chatState.pollError || errorMsg) && (
          <div className="px-2 py-1 bg-[#1A1012] border border-[#F23645]/40 text-[10px] font-mono text-[#FCA5A5]">
            {errorMsg || chatState.pollError}
          </div>
        )}
      </div>

      {/* Live Chat & Q&A Feed */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1E2634] font-mono text-[11px]">
        {messagesOrdered.length === 0 ? (
          <div className="p-4 text-center text-[11px] font-mono text-[#8B95A5] space-y-1">
            <MessageSquare className="w-5 h-5 mx-auto text-[#566173]" />
            <div>Noch keine Live-Chat-Nachrichten.</div>
            <div className="text-[10px] text-[#566173]">
              Stelle unten eine Zuschauerfrage (z. B. „Wie ist die BTC Prognose?“), oder verbinde einen aktiven YouTube Livestream.
            </div>
          </div>
        ) : (
          messagesOrdered.map((msg) => {
            const isReplying = Boolean(replyingIds[msg.id]);
            return (
              <div key={msg.id} className="p-2.5 space-y-1.5 hover:bg-[#0F1520]">
                <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#8B95A5]">{msg.timeFormatted}</span>
                    <span
                      className={`font-bold ${
                        msg.source === 'YOUTUBE' ? 'text-[#EF4444]' : 'text-[#00E5FF]'
                      }`}
                    >
                      {msg.source}
                    </span>
                    <span className="font-bold text-[#E6EDF3] truncate">{msg.author}</span>
                    {msg.isQuestion && (
                      <span className="text-[#F59E0B] font-bold">FRAGE</span>
                    )}
                  </div>

                  {msg.status !== 'ANSWERED' && (
                    <button
                      type="button"
                      disabled={isReplying}
                      onClick={() => void onReplyAndSpeak(msg)}
                      className="px-1.5 py-0.5 border border-[#F59E0B]/60 hover:bg-[#F59E0B]/15 text-[#F59E0B] text-[9px] font-bold flex items-center gap-1 shrink-0 disabled:opacity-50"
                    >
                      <Volume2 className="w-2.5 h-2.5" />
                      <span>{isReplying ? 'ANTWORTE…' : 'ANTWORTEN'}</span>
                    </button>
                  )}
                </div>

                <div className="text-[#E6EDF3] font-sans text-xs leading-snug">{msg.text}</div>

                {msg.status === 'ANSWERED' && msg.answerText && (
                  <div className="p-2 bg-[#07090E] border border-[#089981]/50 space-y-1">
                    <div className="flex items-center justify-between text-[9px] text-[#089981]">
                      <span className="font-bold">STUDIO-ANTWORT ({msg.answeredBy === 'gemini' ? 'GEMINI' : 'DESK'})</span>
                      <button
                        type="button"
                        onClick={() => onReplayQa(msg)}
                        className="hover:underline flex items-center gap-1 text-[#00E5FF]"
                      >
                        <Volume2 className="w-2.5 h-2.5" />
                        <span>VORLESEN</span>
                      </button>
                    </div>
                    <p className="font-sans text-[11px] text-[#C9D1D9] leading-snug">
                      {msg.answerText}
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Built-In Studio Chat Composer */}
      <form
        onSubmit={handleSendMsg}
        className="p-2 bg-[#07090E] border-t border-[#263042] flex items-center gap-1.5 shrink-0"
      >
        <input
          type="text"
          value={authorInput}
          onChange={(e) => setAuthorInput(e.target.value)}
          placeholder="Name"
          aria-label="Zuschauer-Name"
          className="w-24 bg-[#0C1118] border border-[#263042] px-2 py-1 text-[10px] font-mono text-[#E6EDF3]"
        />
        <input
          type="text"
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          placeholder="Live-Chat Frage stellen…"
          aria-label="Live-Chat Nachricht"
          className="flex-1 min-w-0 bg-[#0C1118] border border-[#263042] px-2 py-1 text-[11px] font-mono text-[#E6EDF3] placeholder:text-[#566173]"
        />
        <button
          type="submit"
          disabled={sendingMsg || !msgInput.trim()}
          className="px-2.5 py-1 border border-[#00E5FF] bg-[#00E5FF]/15 hover:bg-[#00E5FF]/25 text-[#00E5FF] text-[10px] font-mono font-bold flex items-center gap-1 shrink-0 disabled:opacity-40"
        >
          <Send className="w-3 h-3" />
          <span>SENDEN</span>
        </button>
      </form>
    </div>
  );
};
