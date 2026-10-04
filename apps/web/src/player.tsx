import type Hls from 'hls.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, OWNERSHIP_TEXT, REASON_TEXT } from './api';

/** A queue entry references an id — never a file URL (PB Phase 13). */
export interface QueueEntry {
  key: string;
  title: string;
  subtitle?: string | null | undefined;
  ownership?: string | null | undefined;
  audio_source_id?: string | undefined;
  recording_id?: string | undefined;
}

interface Session {
  session_id: string;
  manifest_url: string;
  expires_at: string;
  quality: { codec: string; bitrate_kbps: number; lossless: boolean; provisional: boolean };
  source: string;
}

interface PlayerApi {
  queue: QueueEntry[];
  index: number;
  play(entries: QueueEntry[], start?: number): void;
  message: string | null;
}

const Ctx = createContext<PlayerApi | null>(null);
const DEVICE_KEY = 'rabit.device';

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Media tokens live in the URL path; every request is rewritten to the latest token. */
function withToken(url: string, token: string): string {
  return url.replace(/\/media\/v1\/[^/]+\//, `/media/v1/${token}/`);
}
const tokenOf = (manifest: string) => /\/media\/v1\/([^/]+)\//.exec(manifest)?.[1] ?? '';

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const hls = useRef<Hls | null>(null);
  const token = useRef('');
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const seq = useRef(0);
  const lastBeat = useRef(0);

  const send = useCallback((type: string, s: Session) => {
    const el = audio.current;
    if (!el) return;
    const now = performance.now();
    const played = lastBeat.current ? Math.round(now - lastBeat.current) : 0;
    lastBeat.current = now;
    void api('POST', '/v1/listening-events/batch', {
      events: [
        {
          event_id: crypto.randomUUID(),
          session_id: s.session_id,
          sequence: seq.current++,
          type,
          position_ms: Math.round(el.currentTime * 1000),
          played_ms: el.paused && type !== 'paused' && type !== 'ended' ? 0 : played,
          client_time: new Date().toISOString(),
        },
      ],
    }).catch(() => undefined);
  }, []);

  const start = useCallback(async (entry: QueueEntry) => {
    setMessage(null);
    try {
      const { data } = await api<Session>('POST', '/v1/playback-sessions', {
        ...(entry.audio_source_id
          ? { audio_source_id: entry.audio_source_id }
          : { recording_id: entry.recording_id }),
        device_id: deviceId(),
      });
      token.current = tokenOf(data.manifest_url);
      seq.current = 0;
      lastBeat.current = 0;
      setSession(data);
      const el = audio.current;
      if (!el) return;
      hls.current?.destroy();
      // hls.js is loaded on first playback to keep the initial bundle small.
      const { default: HlsLib } = await import('hls.js');
      if (HlsLib.isSupported()) {
        const h = new HlsLib({
          xhrSetup: (xhr, url) => {
            xhr.open('GET', withToken(url, token.current), true);
          },
        });
        h.loadSource(data.manifest_url);
        h.attachMedia(el);
        hls.current = h;
      } else {
        el.src = data.manifest_url;
      }
      await el.play().catch(() => undefined);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const text: Record<string, string> = {
        SUBSCRIPTION_REQUIRED: REASON_TEXT['subscription_required'] ?? '',
        RIGHTS_UNAVAILABLE: REASON_TEXT['rights_unavailable'] ?? '',
        NOT_FOUND: REASON_TEXT['not_found'] ?? '',
        INVALID_STATE: REASON_TEXT['not_ready'] ?? '',
      };
      setMessage(`재생할 수 없습니다: ${text[code] ?? (e as Error).message}`);
    }
  }, []);

  // Refresh the session (and media token) while playing; the server re-checks rights.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      api<Session>('POST', `/v1/playback-sessions/${session.session_id}/refresh`)
        .then(({ data }) => {
          token.current = tokenOf(data.manifest_url);
        })
        .catch((e: unknown) => {
          hls.current?.destroy();
          audio.current?.pause();
          setMessage(`재생이 중단되었습니다: ${e instanceof ApiError ? e.message : '오류'}`);
        });
    }, 40_000);
    const beat = setInterval(() => {
      if (audio.current && !audio.current.paused) send('heartbeat', session);
    }, 15_000);
    return () => {
      clearInterval(t);
      clearInterval(beat);
    };
  }, [session, send]);

  useEffect(() => {
    const entry = queue[index];
    if (entry) void start(entry);
  }, [index, queue, start]);

  const playNext = () => {
    if (session) send('ended', session);
    // Unplayable items are skipped by the server's answer, keeping their position.
    if (index + 1 < queue.length) setIndex(index + 1);
  };

  const current = queue[index];
  const api_: PlayerApi = {
    queue,
    index,
    message,
    play(entries, at = 0) {
      setQueue(entries);
      setIndex(-1);
      setTimeout(() => {
        setIndex(at);
      }, 0);
    },
  };

  return (
    <Ctx.Provider value={api_}>
      {children}
      <footer className="player" aria-label="플레이어">
        <div className="now">
          {current ? (
            <>
              <strong>{current.title}</strong>
              {current.subtitle ? <span className="muted"> · {current.subtitle}</span> : null}
              {current.ownership ? (
                <span className="badge">
                  {OWNERSHIP_TEXT[current.ownership] ?? current.ownership}
                </span>
              ) : null}
              {session ? (
                <span className="muted small">
                  {' '}
                  {session.quality.codec.toUpperCase()} {session.quality.bitrate_kbps}kbps
                  {session.quality.lossless ? ' · lossless' : ''}
                  {session.quality.provisional ? ' (임시 설정)' : ''}
                </span>
              ) : null}
            </>
          ) : (
            <span className="muted">재생 중인 오디오 없음</span>
          )}
          {message ? (
            <p role="status" className="warn">
              {message}
            </p>
          ) : null}
        </div>
        <audio
          ref={audio}
          controls
          aria-label="오디오 컨트롤"
          onPlay={() => {
            if (session) send('started', session);
          }}
          onPause={() => {
            if (session) send('paused', session);
          }}
          onEnded={playNext}
        />
        <button type="button" onClick={playNext} disabled={index + 1 >= queue.length}>
          다음
        </button>
      </footer>
    </Ctx.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const p = useContext(Ctx);
  if (!p) throw new Error('PlayerProvider missing');
  return p;
}
