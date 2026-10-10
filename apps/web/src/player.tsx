import type Hls from 'hls.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { api, ApiError } from './api';
import { Cover, Icon, Mark } from './brand';
import { t, type MessageKey } from './i18n';
import { nowPlayingHref, useRoute } from './route';

/** A queue entry references an id — never a file URL (PB Phase 13). */
export interface QueueEntry {
  key: string;
  title: string;
  subtitle?: string | null | undefined;
  ownership?: string | null | undefined;
  audio_source_id?: string | undefined;
  recording_id?: string | undefined;
  /** Which stand-in cover to show (the release's, when known). */
  cover_id?: string | undefined;
  /**
   * Blind Digging: the track's identity is hidden until Keep/Pass, so the player shows
   * no cover and no links that would reveal it (DIG-010).
   */
  hidden?: boolean | undefined;
}

/** The cover shown for a queue entry: its release when known, else the item itself. */
export const coverOf = (e: QueueEntry): string =>
  e.cover_id ?? e.recording_id ?? e.audio_source_id ?? e.key;

/**
 * A queue entry's picture: catalog tracks get their stand-in cover, private audio
 * and Audio Logs the same icon tile as in Studio and the Archive (never an album look).
 */
export function EntryArt({ entry, size }: { entry: QueueEntry; size: number }) {
  if (entry.hidden) return <Mark id="hidden" kind="hidden" name="?" size={size} />;
  if (entry.audio_source_id)
    return (
      <Mark
        id={entry.audio_source_id}
        kind={entry.ownership === 'audio_log' ? 'audio_log' : 'private_audio'}
        name={entry.title}
        size={size}
      />
    );
  return <Cover id={coverOf(entry)} size={size} round={Math.round(size / 11)} />;
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
  current: QueueEntry | undefined;
  playing: boolean;
  /** "AAC 256kbps · lossless"-style text for the current session, if any. */
  quality: string | null;
  /** Private audio's waveform peaks (catalog playback has none). */
  peaks: number[] | null;
  /** The media element, for components that follow the playback position. */
  audio: RefObject<HTMLAudioElement | null>;
  play(entries: QueueEntry[], start?: number): void;
  jump: (index: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  message: string | null;
}

const Ctx = createContext<PlayerApi | null>(null);

/** Playback-session error codes the listener gets a plain explanation for. */
const START_ERROR_TEXT: Record<string, MessageKey> = {
  SUBSCRIPTION_REQUIRED: 'reason.subscription_required',
  RIGHTS_UNAVAILABLE: 'reason.rights_unavailable',
  NOT_FOUND: 'reason.not_found',
  INVALID_STATE: 'reason.not_ready',
};
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
  const [playing, setPlaying] = useState(false);
  const route = useRoute();
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
      const key: MessageKey | undefined = START_ERROR_TEXT[e instanceof ApiError ? e.code : ''];
      setMessage(t('player.cannotPlay', { reason: key ? t(key) : (e as Error).message }));
    }
  }, []);

  // Refresh the session (and media token) while playing; the server re-checks rights.
  useEffect(() => {
    if (!session) return;
    const refresh = setInterval(() => {
      api<Session>('POST', `/v1/playback-sessions/${session.session_id}/refresh`)
        .then(({ data }) => {
          token.current = tokenOf(data.manifest_url);
        })
        .catch((e: unknown) => {
          hls.current?.destroy();
          audio.current?.pause();
          setMessage(
            t('player.stopped', { reason: e instanceof ApiError ? e.message : t('player.error') }),
          );
        });
    }, 40_000);
    const beat = setInterval(() => {
      if (audio.current && !audio.current.paused) send('heartbeat', session);
    }, 15_000);
    return () => {
      clearInterval(refresh);
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
  const waveformSource = current?.audio_source_id ?? null;
  const [peaks, setPeaks] = useState<number[] | null>(null);
  // Private audio has a waveform (processing output); catalog playback does not.
  useEffect(() => {
    setPeaks(null);
    if (!waveformSource) return;
    let stale = false;
    api<{ peaks: number[] }>('GET', `/v1/audio-sources/${waveformSource}/waveform`).then(
      ({ data }) => {
        if (!stale) setPeaks(data.peaks);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [waveformSource]);
  const quality = session
    ? [
        t('player.quality', {
          codec: session.quality.codec.toUpperCase(),
          kbps: session.quality.bitrate_kbps,
        }),
        session.quality.lossless ? t('player.quality.lossless') : '',
        session.quality.provisional ? t('player.quality.provisional') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const jump = (at: number) => {
    // Re-selecting the same index restarts it: reset first, then select.
    setIndex(-1);
    setTimeout(() => {
      setIndex(at);
    }, 0);
  };
  const toggle = () => {
    const el = audio.current;
    if (!el || !current) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };
  const previous = () => {
    const el = audio.current;
    // Like most players: past the first seconds, "previous" restarts the track.
    if (el && el.currentTime > 3) el.currentTime = 0;
    else if (index > 0) jump(index - 1);
  };
  const api_: PlayerApi = {
    queue,
    index,
    current,
    playing,
    quality,
    peaks,
    audio,
    message,
    play(entries, at = 0) {
      setQueue(entries);
      jump(at);
    },
    jump,
    toggle,
    next: playNext,
    previous,
  };
  const onNowPlaying = route.kind === 'now';

  return (
    <Ctx.Provider value={api_}>
      {children}
      <footer className="player" aria-label={t('player.region')} hidden={onNowPlaying}>
        {current ? (
          <a className="player-now" href={nowPlayingHref}>
            <EntryArt entry={current} size={44} />
            <span className="player-text">
              <strong>{current.title}</strong>
              {current.subtitle ? <span className="muted small">{current.subtitle}</span> : null}
            </span>
            <span className="visually-hidden">{t('player.open')}</span>
          </a>
        ) : (
          <span className="muted player-idle">{t('player.idle')}</span>
        )}
        <div className="player-buttons">
          <button
            type="button"
            className="round primary"
            aria-label={playing ? t('player.pause') : t('player.resume')}
            disabled={!current}
            onClick={toggle}
          >
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <button
            type="button"
            className="round"
            aria-label={t('player.next')}
            disabled={index + 1 >= queue.length}
            onClick={playNext}
          >
            <Icon name="next" size={18} />
          </button>
        </div>
        {current ? <Progress audio={audio} thin /> : null}
        {message ? (
          <p role="status" className="warn player-message">
            {message}
          </p>
        ) : null}
      </footer>
      <audio
        ref={audio}
        aria-label={t('player.controls')}
        onPlay={() => {
          setPlaying(true);
          if (session) send('started', session);
        }}
        onPause={() => {
          setPlaying(false);
          if (session) send('paused', session);
        }}
        onEnded={() => {
          setPlaying(false);
          playNext();
        }}
      />
    </Ctx.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const p = useContext(Ctx);
  if (!p) throw new Error('PlayerProvider missing');
  return p;
}

/** Follows the media element's position without re-rendering every player consumer. */
export function useAudioClock(audio: RefObject<HTMLAudioElement | null>): {
  time: number;
  duration: number;
} {
  const [clock, setClock] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const update = () => {
      setClock({
        time: el.currentTime,
        duration: Number.isFinite(el.duration) ? el.duration : 0,
      });
    };
    update();
    el.addEventListener('timeupdate', update);
    el.addEventListener('durationchange', update);
    el.addEventListener('emptied', update);
    return () => {
      el.removeEventListener('timeupdate', update);
      el.removeEventListener('durationchange', update);
      el.removeEventListener('emptied', update);
    };
  }, [audio]);
  return clock;
}

export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Playback position. `thin` is the decorative line in the mini player; the full
 * version is a labelled slider (keyboard: arrows seek by 1 s) with both times.
 */
export function Progress({
  audio,
  thin = false,
}: {
  audio: RefObject<HTMLAudioElement | null>;
  thin?: boolean;
}) {
  const { time, duration } = useAudioClock(audio);
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
  if (thin)
    return (
      <span className="progress-thin" aria-hidden="true">
        <span style={{ width: `${String(ratio * 100)}%` }} />
      </span>
    );
  return (
    <div className="progress">
      <input
        type="range"
        min={0}
        max={duration > 0 ? Math.floor(duration) : 0}
        // Step 1: with a coarser step the thumb snaps back to 0 on short audio.
        step={1}
        value={Math.floor(time)}
        disabled={duration <= 0}
        aria-label={t('player.position')}
        aria-valuetext={t('player.positionText', {
          time: clockText(time),
          duration: clockText(duration),
        })}
        style={{ '--ratio': `${String(ratio * 100)}%` } as CSSProperties}
        onChange={(e) => {
          const el = audio.current;
          if (el) el.currentTime = Number(e.target.value);
        }}
      />
      <div className="progress-times" aria-hidden="true">
        <span>{clockText(time)}</span>
        <span>{clockText(duration)}</span>
      </div>
    </div>
  );
}

/**
 * Decorative peak overview with the played part highlighted; the position slider
 * stays the accessible control.
 */
export function Waveform({
  peaks,
  audio,
}: {
  peaks: number[];
  audio: RefObject<HTMLAudioElement | null>;
}) {
  const { time, duration } = useAudioClock(audio);
  const progress = duration > 0 ? time / duration : 0;
  const bars = 120;
  const step = peaks.length / bars;
  const values = Array.from({ length: bars }, (_, i) => {
    const from = Math.floor(i * step);
    return Math.max(0.04, ...peaks.slice(from, Math.max(Math.floor((i + 1) * step), from + 1)));
  });
  return (
    <svg
      className="waveform"
      viewBox={`0 0 ${String(bars)} 40`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {values.map((v, i) => (
        <rect
          key={i}
          x={i + 0.15}
          width={0.7}
          y={20 - v * 19}
          height={v * 38}
          className={i / bars < progress ? 'played' : ''}
        />
      ))}
    </svg>
  );
}
