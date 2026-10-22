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
import { api, ApiError, hasToken, type Schemas } from './api';
import { Cover, Icon, Mark } from './brand';
import { t, type MessageKey } from './i18n';
import { normalizeEnabled, onNormalizeChange, volumeFor } from './normalize';
import { QualityTracker } from './qoe';
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
  /** Server queue (ADR-0026): the item, who put it there and why, and its place. */
  item_id?: string | undefined;
  origin?: 'user' | 'autoplay' | undefined;
  reason?: QueueReason | null | undefined;
  state?: 'played' | 'current' | 'upcoming' | undefined;
  playable?: boolean | undefined;
}

export type ServerQueue = Schemas['Queue'];
export type QueueReason = NonNullable<ServerQueue['items'][number]['reason']>;
export type QueueSettings = Pick<ServerQueue, 'mode' | 'autoplay' | 'include_inferred'>;
type QueueRef = { recording_id: string } | { audio_source_id: string };

const refOf = (e: QueueEntry): QueueRef =>
  e.audio_source_id
    ? { audio_source_id: e.audio_source_id }
    : { recording_id: e.recording_id ?? '' };

function entryOf(i: ServerQueue['items'][number]): QueueEntry {
  return {
    key: i.item_id,
    item_id: i.item_id,
    title: i.title ?? t('common.untitled'),
    subtitle: i.subtitle,
    ...(i.recording_id ? { recording_id: i.recording_id } : {}),
    ...(i.audio_source_id ? { audio_source_id: i.audio_source_id } : {}),
    cover_id: i.cover_id,
    origin: i.origin,
    reason: i.reason,
    state: i.state,
    playable: i.playable,
  };
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
  media_token_expires_at: string;
  quality: {
    codec: string;
    bitrate_kbps: number;
    renditions_kbps: number[];
    lossless: boolean;
    provisional: boolean;
  };
  source: string;
  loudness: { gain_db: number } | null;
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
  /** Plays `entries` from `start` now; the rest of the queue stays (ADR-0026). */
  play(entries: QueueEntry[], start?: number): void;
  /** Right after the current item, or after the listener's other choices. */
  enqueue(entries: QueueEntry[], placement: 'next' | 'end'): Promise<void>;
  /** Starts over from this track: what was coming is replaced by its suggestions. */
  startRadio(entry: QueueEntry): void;
  remove(entry: QueueEntry): Promise<void>;
  keep(entry: QueueEntry): Promise<void>;
  clear(scope: 'upcoming' | 'suggestions' | 'history' | 'all'): Promise<void>;
  refreshSuggestions(): Promise<void>;
  settings: QueueSettings;
  updateSettings(patch: Partial<QueueSettings>): Promise<void>;
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

/** How close to the end a stall counts as the end of the track (see `onWaiting`). */
const END_SLACK_S = 0.3;

/**
 * The media is buffered to its end and playback stopped just short of it. With
 * gapless edit lists (ADR-0008) Chrome trims the encoder padding, and hls.js then
 * never signals the end of the stream, so `ended` never fires.
 */
function stalledAtEnd(a: HTMLAudioElement): boolean {
  if (a.paused || !Number.isFinite(a.duration) || a.duration - a.currentTime > END_SLACK_S) {
    return false;
  }
  const n = a.buffered.length;
  return n > 0 && a.buffered.end(n - 1) >= a.duration - END_SLACK_S;
}

/** How long before a track ends the next one is prepared. */
export const PREPARE_NEXT_S = 30;

interface Prepared {
  /** Queue position and entry key the session was opened for. */
  index: number;
  key: string;
  session: Session;
}

function openSession(entry: QueueEntry) {
  return api<Session>('POST', '/v1/playback-sessions', {
    ...(entry.audio_source_id
      ? { audio_source_id: entry.audio_source_id }
      : { recording_id: entry.recording_id }),
    device_id: deviceId(),
  }).then(({ data }) => data);
}

/**
 * Fetches the playlists, init segment and first media segment of a prepared
 * session, so the browser cache answers hls.js when the track starts. Ladder
 * sessions warm the `standard` rung, where players start (ADR-0008). Segment
 * responses are cacheable for the token's lifetime; failures only cost the head start.
 */
async function warm(s: Session): Promise<void> {
  const base = s.manifest_url.replace(/(master|index)\.m3u8$/, '');
  const rung = s.manifest_url.endsWith('/master.m3u8') ? 'standard/' : '';
  const files = [
    ...(rung ? ['master.m3u8'] : []),
    `${rung}index.m3u8`,
    `${rung}init.mp4`,
    `${rung}seg_00000.m4s`,
  ];
  for (const file of files) {
    const res = await fetch(`${base}${file}`);
    if (!res.ok) return;
    await res.arrayBuffer();
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const hls = useRef<Hls | null>(null);
  const token = useRef('');
  /** Session whose end was handled (by `ended` or a stall at the end), at most once. */
  const finished = useRef<string | null>(null);
  /** Quality measurement of the current session (QoE), reported when it ends. */
  const qoe = useRef<QualityTracker | null>(null);
  const prepared = useRef<Prepared | null>(null);
  /** Queue position whose session is being (or was) prepared. */
  const preparing = useRef(-1);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const [settings, setSettings] = useState<QueueSettings>({
    mode: 'queue',
    autoplay: true,
    include_inferred: false,
  });
  /** A Blind Digging round plays from a local list: its tracks must stay hidden (DIG-010). */
  const local = useRef(false);
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
    qoe.current?.send();
    qoe.current = null;
    const requestedAt = performance.now();
    try {
      // A session opened ahead of time for this entry (prepareNext) saves a round trip;
      // its media token is renewed when it is close to expiry.
      const ready = prepared.current;
      prepared.current = null;
      preparing.current = -1;
      let data: Session;
      if (ready && ready.key === entry.key) {
        data =
          new Date(ready.session.media_token_expires_at).getTime() - Date.now() > 15_000
            ? ready.session
            : (
                await api<Session>(
                  'POST',
                  `/v1/playback-sessions/${ready.session.session_id}/refresh`,
                )
              ).data;
      } else {
        data = await openSession(entry);
      }
      token.current = tokenOf(data.manifest_url);
      qoe.current = new QualityTracker(data.session_id, requestedAt);
      seq.current = 0;
      lastBeat.current = 0;
      setSession(data);
      const el = audio.current;
      if (!el) return;
      el.volume = volumeFor(data.loudness?.gain_db, normalizeEnabled());
      hls.current?.destroy();
      // hls.js is loaded on first playback to keep the initial bundle small.
      const { default: HlsLib } = await import('hls.js');
      if (HlsLib.isSupported()) {
        const h = new HlsLib({
          xhrSetup: (xhr, url) => {
            xhr.open('GET', withToken(url, token.current), true);
          },
        });
        h.on(HlsLib.Events.ERROR, (_event, d) => {
          if (!d.fatal) return;
          qoe.current?.failed(
            d.type === HlsLib.ErrorTypes.NETWORK_ERROR
              ? 'network'
              : d.type === HlsLib.ErrorTypes.MEDIA_ERROR
                ? 'media'
                : 'other',
          );
          qoe.current?.send();
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

  // Normalisation can be switched under Account while a track plays.
  useEffect(
    () =>
      onNormalizeChange(() => {
        if (audio.current)
          audio.current.volume = volumeFor(session?.loudness?.gain_db, normalizeEnabled());
      }),
    [session],
  );

  // Leaving the page ends the session: report its quality (best effort).
  useEffect(() => {
    const leave = () => {
      qoe.current?.send();
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
    };
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
          qoe.current?.send();
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

  /** Mirrors the server queue; returns the index of its current item. */
  const fromServer = useCallback((q: ServerQueue): number => {
    local.current = false;
    const entries = q.items.map(entryOf);
    const at = q.items.findIndex((i) => i.state === 'current');
    setQueue(entries);
    setIndex(at);
    setSettings({ mode: q.mode, autoplay: q.autoplay, include_inferred: q.include_inferred });
    return at;
  }, []);

  // The account's queue, as another device left it (nothing starts by itself).
  useEffect(() => {
    if (!hasToken()) return;
    api<ServerQueue>('GET', '/v1/queue').then(
      ({ data }) => fromServer(data),
      () => undefined,
    );
  }, [fromServer]);

  const queueCall = useCallback(
    async (
      method: string,
      path: string,
      body?: unknown,
    ): Promise<{ entries: QueueEntry[]; at: number }> => {
      const { data } = await api<ServerQueue>(method, path, body);
      const at = fromServer(data);
      return { entries: data.items.map(entryOf), at };
    },
    [fromServer],
  );

  /** Moves to an item (the client went on or the listener picked it) and plays it. */
  const go = useCallback(
    async (entries: QueueEntry[], at: number) => {
      const entry = entries[at];
      if (!entry) return;
      if (local.current || !entry.item_id) {
        setIndex(at);
        await start(entry);
        return;
      }
      const r = await queueCall('POST', '/v1/queue/current', { item_id: entry.item_id }).catch(
        () => null,
      );
      const now = r ? r.entries[r.at] : entry;
      if (now) await start(now);
    },
    [queueCall, start],
  );

  /** Opens and warms the next entry's session near the end of the current track. */
  const prepareNext = () => {
    const el = audio.current;
    const nextEntry = queue[index + 1];
    if (!el || !nextEntry || preparing.current === index + 1) return;
    if (!Number.isFinite(el.duration) || el.duration - el.currentTime > PREPARE_NEXT_S) return;
    preparing.current = index + 1;
    const at = index + 1;
    openSession(nextEntry).then(
      (s) => {
        prepared.current = { index: at, key: nextEntry.key, session: s };
        return warm(s);
      },
      // Not playable or offline: starting the track reports it as usual.
      () => undefined,
    );
  };

  /** The next item that can play: unplayable ones are passed over, keeping their place (PLY-006). */
  const nextPlayable = (from: number) => {
    for (let i = from + 1; i < queue.length; i++) if (queue[i]?.playable !== false) return i;
    return -1;
  };

  const playNext = () => {
    if (session) send('ended', session);
    const at = nextPlayable(index);
    if (at >= 0) void go(queue, at);
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
          // The ladder adapts to the network: show its range (ADR-0008).
          kbps:
            session.quality.renditions_kbps.length > 1
              ? `${Math.min(...session.quality.renditions_kbps)}–${session.quality.bitrate_kbps}`
              : session.quality.bitrate_kbps,
        }),
        session.quality.lossless ? t('player.quality.lossless') : '',
        session.quality.provisional ? t('player.quality.provisional') : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const jump = (at: number) => {
    void go(queue, at);
  };
  const toggle = () => {
    const el = audio.current;
    if (!el || !current) return;
    // A queue restored from the account has no session yet: start its current item.
    if (!session) {
      void start(current);
      return;
    }
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };
  const previous = () => {
    const el = audio.current;
    // Like most players: past the first seconds, "previous" restarts the track.
    if (el && el.currentTime > 3) el.currentTime = 0;
    else if (index > 0) jump(index - 1);
  };
  const playNow = async (entries: QueueEntry[], at: number) => {
    if (entries.some((e) => e.hidden)) {
      local.current = true;
      setQueue(entries);
      setIndex(at);
      await start(entries[at] as QueueEntry);
      return;
    }
    try {
      const r = await queueCall('POST', '/v1/queue/items', {
        items: entries.slice(at).map(refOf),
        placement: 'now',
      });
      const now = r.entries[r.at];
      if (now) await start(now);
    } catch (e) {
      setMessage(
        t('player.cannotPlay', {
          reason: e instanceof ApiError ? e.message : (e as Error).message,
        }),
      );
    }
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
    settings,
    play(entries, at = 0) {
      void playNow(entries, at);
    },
    async enqueue(entries, placement) {
      await queueCall('POST', '/v1/queue/items', { items: entries.map(refOf), placement });
    },
    startRadio(entry) {
      void (async () => {
        await queueCall('POST', '/v1/queue/clear', { scope: 'upcoming' }).catch(() => null);
        await playNow([entry], 0);
      })();
    },
    async remove(entry) {
      if (entry.item_id) await queueCall('DELETE', `/v1/queue/items/${entry.item_id}`);
    },
    async keep(entry) {
      if (entry.item_id) await queueCall('POST', `/v1/queue/items/${entry.item_id}/keep`);
    },
    async clear(scope) {
      await queueCall('POST', '/v1/queue/clear', { scope });
    },
    async refreshSuggestions() {
      await queueCall('POST', '/v1/queue/suggestions/refresh');
    },
    async updateSettings(patch) {
      // Shown at once; the server's answer (with new suggestions) follows.
      const before = settings;
      setSettings({ ...settings, ...patch });
      try {
        await queueCall('PATCH', '/v1/queue/settings', patch);
      } catch (e) {
        setSettings(before);
        throw e;
      }
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
            className="round quiet player-previous"
            aria-label={t('player.previous')}
            disabled={!current}
            onClick={previous}
          >
            <Icon name="previous" size={18} />
          </button>
          <button
            type="button"
            className="round player-toggle"
            aria-label={playing ? t('player.pause') : t('player.resume')}
            disabled={!current}
            onClick={toggle}
          >
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <button
            type="button"
            className="round quiet"
            aria-label={t('player.next')}
            disabled={nextPlayable(index) < 0}
            onClick={playNext}
          >
            <Icon name="next" size={18} />
          </button>
        </div>
        {current ? <PlayerTimeline audio={audio} /> : null}
        {current && session ? (
          <span className="badge player-quality" title={quality ?? undefined}>
            {t('player.quality', {
              codec: session.quality.codec.toUpperCase(),
              kbps: session.quality.bitrate_kbps,
            })}
          </span>
        ) : null}
        {current ? (
          <a className="button player-queue" href={nowPlayingHref}>
            <Icon name="playlists" size={16} />
            {t('player.queue', { count: queue.length - index })}
          </a>
        ) : null}
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
        onPlaying={() => {
          qoe.current?.playing();
        }}
        onSeeking={() => {
          qoe.current?.seekStarted();
        }}
        onError={() => {
          qoe.current?.failed('media');
        }}
        onPause={() => {
          qoe.current?.paused();
          setPlaying(false);
          if (session) send('paused', session);
        }}
        onTimeUpdate={prepareNext}
        onEnded={() => {
          qoe.current?.send();
          if (finished.current === session?.session_id) return;
          finished.current = session?.session_id ?? null;
          setPlaying(false);
          playNext();
        }}
        onWaiting={(e) => {
          const el = e.currentTarget;
          qoe.current?.waiting(stalledAtEnd(el));
          if (!stalledAtEnd(el) || finished.current === session?.session_id) return;
          qoe.current?.send();
          finished.current = session?.session_id ?? null;
          if (nextPlayable(index) >= 0) {
            setPlaying(false);
            playNext();
          } else {
            el.pause();
          }
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
 * The bar's position: both times and a line on wide screens, only the line on phones.
 * Decorative: Now Playing has the labelled slider.
 */
function PlayerTimeline({ audio }: { audio: RefObject<HTMLAudioElement | null> }) {
  const { time, duration } = useAudioClock(audio);
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
  return (
    <span className="player-timeline" aria-hidden="true">
      <span className="player-time">{clockText(time)}</span>
      <span className="progress-thin">
        <span style={{ width: `${String(ratio * 100)}%` }} />
      </span>
      <span className="player-time">{clockText(duration)}</span>
    </span>
  );
}

/**
 * Playback position: a labelled slider (keyboard: arrows seek by 1 s) with both times.
 */
export function Progress({ audio }: { audio: RefObject<HTMLAudioElement | null> }) {
  const { time, duration } = useAudioClock(audio);
  const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
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
