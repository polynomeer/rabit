import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  get,
  setToken,
  SIGNED_OUT,
  OWNERSHIP_TEXT,
  REASON_TEXT,
  type Playability,
  type Playlist,
} from './api';
import { formatDate, t, tCode, type MessageKey } from './i18n';
import { usePlayer, type QueueEntry } from './player';
import { Cover, Icon, Mark } from './brand';
import { Orders, SubscriptionPanel } from './purchase';
import { setTheme, storedTheme, THEMES, type Theme } from './theme';
import { entityHref, navigate, searchHref } from './route';

export function Status({ p }: { p: Playability }) {
  // Never colour-only (NFR-A11Y-003): always a text label.
  return p.playable ? (
    <span className="ok">{t('item.playable')}</span>
  ) : (
    <span className="warn">{tCode(REASON_TEXT, p.reason ?? '')}</span>
  );
}

export function Ownership({ o }: { o: string | null }) {
  return o ? <span className={`badge own-${o}`}>{tCode(OWNERSHIP_TEXT, o)}</span> : null;
}

/** Catalog items link to their detail page; private audio has none. */
export function ItemTitle({
  refType,
  refId,
  title,
}: {
  refType: string;
  refId: string;
  title: string | null;
}) {
  if (title === null) return <>{t('common.deletedTitle')}</>;
  return refType === 'audio_source' ? <>{title}</> : <a href={entityHref(refId)}>{title}</a>;
}

/**
 * Saves a catalog item to the library. An item already saved shows as saved when the
 * button appears (`?ref_id=` lookup); after saving it says so and stays pressed.
 */
export function SaveButton({
  refType,
  refId,
  checkSaved = true,
}: {
  refType: 'recording' | 'release';
  refId: string;
  /** Look up the saved state on mount; lists with many buttons skip it (one request each). */
  checkSaved?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'failed'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  // Already in the library? Shown as saved from the start (no status line).
  useEffect(() => {
    if (!checkSaved) return;
    let stale = false;
    get<{ items: unknown[] }>(`/v1/library?ref_id=${refId}&limit=1`).then(
      (r) => {
        if (!stale && r.items.length > 0) setState((s) => (s === 'idle' ? 'saved' : s));
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [refId, checkSaved]);
  const saved = state === 'saved';
  return (
    <>
      <button
        type="button"
        aria-pressed={saved}
        disabled={state === 'busy' || saved}
        onClick={() => {
          setState('busy');
          api('POST', '/v1/library', { ref_type: refType, ref_id: refId }).then(
            () => {
              setState('saved');
              setMsg(t('details.library.saved'));
            },
            (e: unknown) => {
              const exists = e instanceof ApiError && e.code === 'ALREADY_EXISTS';
              setState(exists ? 'saved' : 'failed');
              setMsg(exists ? t('details.library.exists') : t('details.library.failed'));
            },
          );
        }}
      >
        {saved ? t('details.library.savedLabel') : t('details.library.save')}
      </button>
      {msg ? (
        <span role="status" className="small muted">
          {' '}
          {msg}
        </span>
      ) : null}
    </>
  );
}

export function errorText(e: unknown): string {
  return e instanceof ApiError
    ? t('error.withCode', { message: e.message, code: e.code })
    : (e as Error).message;
}

export const toEntry = (i: {
  ref_type: string;
  ref_id: string;
  title: string | null;
  subtitle: string | null;
  ownership: string | null;
  primary_release_id?: string | null;
}): QueueEntry => ({
  key: `${i.ref_type}:${i.ref_id}`,
  title: i.title ?? t('common.untitled'),
  subtitle: i.subtitle,
  ownership: i.ownership,
  cover_id: i.primary_release_id ?? undefined,
  ...(i.ref_type === 'audio_source' ? { audio_source_id: i.ref_id } : { recording_id: i.ref_id }),
});

export function Playlists() {
  const player = usePlayer();
  const [list, setList] = useState<{ playlist_id: string; title: string; item_count: number }[]>(
    [],
  );
  const [open, setOpen] = useState<Playlist | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    void get<{ items: typeof list }>('/v1/playlists').then((r) => {
      setList(r.items);
    });
  }, []);
  useEffect(load, [load]);

  const openPl = async (id: string) => {
    const r = await api<Playlist>('GET', `/v1/playlists/${id}`);
    setOpen(r.data);
    setEtag(r.etag);
  };
  // Later pages are bound to the version they were read with; a 409 means it changed.
  const loadMore = async () => {
    if (!open?.items_next_cursor) return;
    try {
      const page = await get<{ items: Playlist['items']; next_cursor: string | null }>(
        `/v1/playlists/${open.playlist_id}/items?limit=100&cursor=${encodeURIComponent(open.items_next_cursor)}`,
      );
      setOpen({
        ...open,
        items: [...open.items, ...page.items],
        items_next_cursor: page.next_cursor,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMsg(t('playlists.reloaded'));
        await openPl(open.playlist_id);
      } else setMsg(errorText(e));
    }
  };
  const mutate = async (method: string, path: string, body?: unknown) => {
    if (!etag) return;
    try {
      const r = await api<Playlist>(method, path, body, { 'if-match': etag });
      setOpen(r.data);
      setEtag(r.etag);
    } catch (e) {
      // 412: someone else changed it — reload instead of overwriting (concurrent edits).
      setMsg(e instanceof ApiError && e.status === 412 ? t('playlists.reloaded') : errorText(e));
      if (open) await openPl(open.playlist_id);
    }
  };

  return (
    <section aria-labelledby="pl-h" className="playlists">
      <p className="eyebrow">Library</p>
      <h2 id="pl-h">Playlists</h2>
      <form
        className="inline create"
        onSubmit={(e) => {
          e.preventDefault();
          const title = (e.currentTarget.elements.namedItem('title') as HTMLInputElement).value;
          void api('POST', '/v1/playlists', { title }).then(load);
        }}
      >
        <input
          name="title"
          placeholder={t('playlists.new.placeholder')}
          required
          maxLength={200}
          aria-label={t('playlists.new.label')}
        />
        <button type="submit">{t('playlists.new.submit')}</button>
      </form>
      {msg ? <p role="status">{msg}</p> : null}
      <div className="pl-layout">
        <ul className="pl-list" aria-label={t('playlists.list')}>
          {list.map((p) => (
            <li
              key={p.playlist_id}
              className={open?.playlist_id === p.playlist_id ? 'current' : undefined}
            >
              <Cover id={p.playlist_id} size={48} round={12} />
              <span className="pl-name">
                <button type="button" className="link" onClick={() => void openPl(p.playlist_id)}>
                  {p.title}
                </button>
                <span className="muted small">
                  {t('playlists.itemCount', { count: p.item_count })}
                </span>
              </span>
            </li>
          ))}
          {list.length === 0 ? <li className="muted">{t('playlists.empty')}</li> : null}
        </ul>
        {open ? (
          <div className="card pl-open">
            <div className="pl-head">
              <Cover id={open.playlist_id} size={96} round={20} />
              <div>
                <h3>{open.title}</h3>
                <p className="muted small">
                  {t('playlists.itemCount', { count: open.item_count })}
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={!open.items.some((i) => i.playability.playable)}
                  onClick={() => {
                    player.play(
                      open.items.map(toEntry),
                      open.items.findIndex((i) => i.playability.playable),
                    );
                  }}
                >
                  {t('playlists.playAll')}
                </button>
              </div>
            </div>
            <form
              className="inline"
              aria-label={t('playlists.rename.label')}
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement;
                const title = input.value.trim();
                if (!title || title === open.title) return;
                void mutate('PATCH', `/v1/playlists/${open.playlist_id}`, { title }).then(load);
              }}
            >
              <label htmlFor={`pl-title-${open.playlist_id}`} className="visually-hidden">
                {t('playlists.rename.field')}
              </label>
              <input
                id={`pl-title-${open.playlist_id}`}
                key={open.title}
                name="title"
                defaultValue={open.title}
                maxLength={200}
                required
              />{' '}
              <button type="submit">{t('playlists.rename.submit')}</button>{' '}
              <button
                type="button"
                onClick={() => {
                  if (!etag || !confirm(t('playlists.delete.confirm', { title: open.title })))
                    return;
                  api('DELETE', `/v1/playlists/${open.playlist_id}`, undefined, {
                    'if-match': etag,
                  }).then(
                    () => {
                      setOpen(null);
                      setEtag(null);
                      setMsg(t('playlists.delete.done'));
                      load();
                    },
                    (e: unknown) => {
                      setMsg(errorText(e));
                    },
                  );
                }}
              >
                {t('playlists.delete.submit')}
              </button>
            </form>
            <ol className="rows">
              {open.items.map((i, idx) => (
                <li key={i.item_id}>
                  <Mark
                    id={i.primary_release_id ?? i.ref_id}
                    kind={
                      i.ref_type === 'audio_source'
                        ? i.ownership === 'audio_log'
                          ? 'audio_log'
                          : 'private_audio'
                        : i.ref_type
                    }
                    name={i.title ?? ''}
                    size={44}
                  />
                  <div className="row-main">
                    <strong>
                      <ItemTitle refType={i.ref_type} refId={i.ref_id} title={i.title} />
                    </strong>{' '}
                    <span className="muted">{i.subtitle}</span> <Ownership o={i.ownership} />{' '}
                    <Status p={i.playability} />
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={!i.playability.playable}
                      onClick={() => {
                        player.play(open.items.map(toEntry), idx);
                      }}
                    >
                      {t('common.play')}
                    </button>
                    <button
                      type="button"
                      aria-label={t('playlists.item.up')}
                      disabled={i.position === 0}
                      onClick={() =>
                        void mutate(
                          'POST',
                          `/v1/playlists/${open.playlist_id}/items/${i.item_id}/move`,
                          { position: i.position - 1 },
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void mutate(
                          'DELETE',
                          `/v1/playlists/${open.playlist_id}/items/${i.item_id}`,
                        )
                      }
                    >
                      {t('playlists.item.remove')}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {open.items_next_cursor ? (
              <button type="button" onClick={() => void loadMore()}>
                {t('playlists.more', { loaded: open.items.length, total: open.item_count })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Search result kind → label (unknown kinds show as sent). */
const KIND_TEXT: Record<string, MessageKey> = {
  recording: 'common.recording',
  release: 'common.release',
  artist: 'dig.entity.artist',
  person: 'dig.entity.person',
  label: 'dig.entity.label',
  private_audio: 'ownership.private',
  audio_log: 'ownership.audio_log',
};

export function Search({ query, onDig }: { query: string; onDig: (entityId: string) => void }) {
  const player = usePlayer();
  const [results, setResults] = useState<
    {
      kind: string;
      id: string;
      title: string;
      subtitle: string | null;
      match: string;
      scope: string;
      primary_release_id?: string | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(false);
  // The query lives in the URL, so returning from a detail page shows the same results.
  useEffect(() => {
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    let stale = false;
    setLoading(true);
    get<{ items: typeof results }>(`/v1/search?q=${encodeURIComponent(query)}`).then(
      (r) => {
        if (stale) return;
        setResults(r.items);
        setLoading(false);
      },
      () => {
        if (stale) return;
        setResults([]);
        setLoading(false);
      },
    );
    return () => {
      stale = true;
    };
  }, [query]);
  return (
    <section aria-labelledby="search-h" className="search">
      <p className="eyebrow">Listen</p>
      <h2 id="search-h">Search</h2>
      <form
        role="search"
        className="search-field big"
        onSubmit={(e) => {
          e.preventDefault();
          const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim();
          if (q) navigate(searchHref(q));
        }}
      >
        <Icon name="search" size={20} />
        <input
          name="q"
          type="search"
          placeholder={t('search.placeholder')}
          required
          maxLength={200}
          aria-label={t('search.label')}
          defaultValue={query}
          key={query}
        />
        <button type="submit">{t('search.submit')}</button>
      </form>
      {query ? null : <p className="muted">{t('search.hint')}</p>}
      {query && loading ? (
        <p role="status" className="muted">
          {t('common.loading')}
        </p>
      ) : null}
      {query && !loading && results.length === 0 ? (
        <p role="status" className="muted">
          {t('search.empty', { query })}
        </p>
      ) : null}
      <ul className="rows" aria-label={t('search.results')}>
        {results.map((r) => (
          <li key={r.id}>
            <Mark id={r.primary_release_id ?? r.id} kind={r.kind} name={r.title} size={52} />
            <div className="row-main">
              <strong>
                {r.scope === 'catalog' ? <a href={entityHref(r.id)}>{r.title}</a> : r.title}
              </strong>
              <span className="muted small">
                {r.subtitle}
                {r.subtitle ? ' · ' : ''}
                {tCode(KIND_TEXT, r.kind)}
                {r.scope === 'mine' ? ` · ${t('search.mine')}` : ''}
              </span>
            </div>
            <div className="actions">
              {r.kind === 'recording' || r.kind === 'private_audio' || r.kind === 'audio_log' ? (
                <button
                  type="button"
                  onClick={() => {
                    player.play([
                      {
                        key: r.id,
                        title: r.title,
                        subtitle: r.subtitle,
                        ...(r.kind === 'recording'
                          ? { recording_id: r.id, cover_id: r.primary_release_id ?? undefined }
                          : { audio_source_id: r.id }),
                      },
                    ]);
                  }}
                >
                  {t('common.play')}
                </button>
              ) : null}
              {r.scope === 'catalog' ? (
                <button
                  type="button"
                  onClick={() => {
                    onDig(r.id);
                  }}
                >
                  DIG
                </button>
              ) : null}
              {r.kind === 'recording' || r.kind === 'release' ? (
                <SaveButton refType={r.kind} refId={r.id} checkSaved={false} />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Subscription {
  plan: string;
  state: 'active' | 'past_due' | 'cancelled' | 'expired';
  paid_through: string;
  source: 'operator' | 'sandbox';
}
interface Entitlement {
  entitlement_id: string;
  scope: 'catalog_all' | 'release' | 'recording';
  resource_id: string | null;
  origin: 'subscription' | 'purchase' | 'grant';
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  valid_from: string;
  valid_to: string | null;
}

const SUB_STATE: Record<string, MessageKey> = {
  active: 'account.sub.state.active',
  past_due: 'account.sub.state.past_due',
  cancelled: 'account.sub.state.cancelled',
  expired: 'account.sub.state.expired',
  none: 'account.sub.state.none',
};
// Plans are configuration placeholders until pricing is decided (Q03).
const PLAN_TEXT: Record<string, MessageKey> = { listen_sandbox: 'account.plan.listen_sandbox' };
const SCOPE_TEXT: Record<string, MessageKey> = {
  catalog_all: 'account.scope.catalog_all',
  release: 'account.scope.release',
  recording: 'account.scope.recording',
};
const ORIGIN_TEXT: Record<string, MessageKey> = {
  subscription: 'account.origin.subscription',
  purchase: 'account.origin.purchase',
  grant: 'account.origin.grant',
};
const ENT_STATUS: Record<string, MessageKey> = {
  active: 'account.entStatus.active',
  suspended: 'account.entStatus.suspended',
  revoked: 'account.entStatus.revoked',
  expired: 'account.entStatus.expired',
};

/** Names a release or recording an entitlement covers (catalog metadata only). */
function ResourceName({ id }: { id: string }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    void get<{ name: string }>(`/v1/entities/${id}`).then(
      (e) => {
        if (!stale) setName(e.name);
      },
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [id]);
  return <a href={entityHref(id)}>{name ?? id}</a>;
}

/** What the account may play and why (ADR-0016): subscription and each entitlement. */
function Entitlements() {
  const [sub, setSub] = useState<Subscription | null | undefined>(undefined);
  const [ents, setEnts] = useState<Entitlement[]>([]);
  useEffect(() => {
    void get<{ subscription: Subscription | null }>('/v1/subscription').then((r) => {
      setSub(r.subscription);
    });
    void get<{ items: Entitlement[] }>('/v1/entitlements').then((r) => {
      setEnts(r.items);
    });
  }, []);
  if (sub === undefined) return null;
  return (
    <section className="card" aria-labelledby="ent-h">
      <h3 id="ent-h">{t('account.entitlements.heading')}</h3>
      {sub ? (
        <p>
          {tCode(PLAN_TEXT, sub.plan)} · <strong>{tCode(SUB_STATE, sub.state)}</strong> ·{' '}
          {t('account.sub.paidThrough', { date: formatDate(sub.paid_through) })}
          {sub.source !== 'sandbox' ? (
            <span className="small muted"> {t('account.sub.operatorSet')}</span>
          ) : null}
        </p>
      ) : (
        <p>{t('account.sub.state.none')}</p>
      )}
      <ul className="list" aria-label={t('account.entitlements.list')}>
        {ents.map((e) => (
          <li key={e.entitlement_id}>
            <div>
              <strong>
                {e.resource_id ? <ResourceName id={e.resource_id} /> : tCode(SCOPE_TEXT, e.scope)}
              </strong>{' '}
              {e.resource_id ? <span className="badge">{tCode(SCOPE_TEXT, e.scope)}</span> : null}{' '}
              <span className="badge">{tCode(ORIGIN_TEXT, e.origin)}</span>
              <br />
              <span className="small">
                <span className={e.status === 'active' ? 'ok' : 'warn'}>
                  {tCode(ENT_STATUS, e.status)}
                </span>{' '}
                ·{' '}
                {t('account.entitlements.period', {
                  from: formatDate(e.valid_from),
                  to: e.valid_to ? formatDate(e.valid_to) : t('common.noEndDate'),
                })}
              </span>
            </div>
          </li>
        ))}
        {ents.length === 0 ? <li className="muted">{t('account.entitlements.empty')}</li> : null}
      </ul>
      <p className="small muted">{t('account.entitlements.note')}</p>
    </section>
  );
}

export function Account() {
  const [me, setMe] = useState<{
    user_id: string;
    subscription_state: string;
    license_country: string | null;
    quota: { used_bytes: number; max_total_bytes: number };
  } | null>(null);
  const [exp, setExp] = useState<{ state: string; download_url: string | null } | null>(null);
  useEffect(() => {
    void get<NonNullable<typeof me>>('/v1/me').then(setMe);
  }, []);
  const quota = me?.quota;
  return (
    <section aria-labelledby="acct-h" className="account">
      <h2 id="acct-h">Account</h2>
      {me ? (
        <div className="card profile">
          <span className="profile-mark" aria-hidden="true">
            <Icon name="account" size={28} />
          </span>
          <dl className="facts">
            <div>
              <dt>{t('account.subscription')}</dt>
              <dd>{tCode(SUB_STATE, me.subscription_state)}</dd>
            </div>
            <div>
              <dt>{t('account.licenseCountry')}</dt>
              <dd>{me.license_country ?? t('account.licenseCountry.unset')}</dd>
            </div>
            <div>
              <dt>{t('account.storage')}</dt>
              <dd>
                {quota ? (
                  <>
                    <meter
                      min={0}
                      max={quota.max_total_bytes}
                      value={quota.used_bytes}
                      aria-label={t('account.storage')}
                    />
                    <span className="small">
                      {t('account.storage.usage', {
                        used: (quota.used_bytes / 1024 ** 2).toFixed(1),
                        max: (quota.max_total_bytes / 1024 ** 3).toFixed(1),
                      })}
                    </span>
                  </>
                ) : null}
              </dd>
            </div>
            <div className="wide">
              <dt>{t('account.supportId')}</dt>
              <dd>
                <code>{me.user_id}</code>
                <span className="small muted"> {t('account.supportId.hint')}</span>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
      <ThemeChoice />
      <Entitlements />
      <SubscriptionPanel />
      <Orders />
      <div className="card">
        <h3>{t('account.export.heading')}</h3>
        <p className="small muted">{t('account.export.note')}</p>
        <button
          type="button"
          onClick={() => {
            void api<{ export_id: string }>(
              'POST',
              '/v1/exports',
              { include_originals: true },
              { 'idempotency-key': `exp-${crypto.randomUUID()}` },
            ).then(async ({ data }) => {
              for (let i = 0; i < 120; i++) {
                const e = await get<{ state: string; download_url: string | null }>(
                  `/v1/exports/${data.export_id}`,
                );
                setExp(e);
                if (e.state !== 'requested' && e.state !== 'building') break;
                await new Promise((r) => setTimeout(r, 1000));
              }
            });
          }}
        >
          {t('account.export.request')}
        </button>
        {exp ? (
          <p role="status">
            {exp.state}
            {exp.download_url ? (
              <>
                {' '}
                — <a href={exp.download_url}>{t('account.export.download')}</a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      <DeleteAccount />
    </section>
  );
}

const THEME_TEXT: Record<Theme, MessageKey> = {
  system: 'account.theme.system',
  dark: 'account.theme.dark',
  light: 'account.theme.light',
};

/** Dark, light or the device setting; stored on this device only. */
function ThemeChoice() {
  const [theme, setChoice] = useState<Theme>(storedTheme);
  return (
    <section className="card" aria-labelledby="theme-h">
      <h3 id="theme-h">{t('account.theme.heading')}</h3>
      <fieldset className="chips">
        <legend>{t('account.theme.heading')}</legend>
        {THEMES.map((v) => (
          <label key={v}>
            <input
              type="radio"
              name="theme"
              checked={theme === v}
              onChange={() => {
                setChoice(v);
                setTheme(v);
              }}
            />
            {t(THEME_TEXT[v])}
          </label>
        ))}
      </fieldset>
      <p className="small muted">{t('account.theme.note')}</p>
    </section>
  );
}

/**
 * Account deletion (invariant 12, LIB-008): the account is blocked at once and
 * every module deletes its data in the background. There is no grace period yet
 * (DM-02 is open), so the user types a word to confirm.
 */
function DeleteAccount() {
  const word = t('account.delete.word');
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="card danger"
      aria-label={t('account.delete.heading')}
      onSubmit={(e) => {
        e.preventDefault();
        if (typed.trim() !== word) return;
        api('DELETE', '/v1/me', undefined, {
          'idempotency-key': `del-${crypto.randomUUID()}`,
        }).then(
          () => {
            setToken(null);
            window.dispatchEvent(new Event(SIGNED_OUT));
          },
          (x: unknown) => {
            setMsg(errorText(x));
          },
        );
      }}
    >
      <h3>{t('account.delete.heading')}</h3>
      <p className="small">{t('account.delete.note')}</p>
      <label htmlFor="delete-confirm">{t('account.delete.confirm', { word })}</label>{' '}
      <input
        id="delete-confirm"
        value={typed}
        autoComplete="off"
        onChange={(e) => {
          setTyped(e.target.value);
        }}
      />{' '}
      <button type="submit" disabled={typed.trim() !== word}>
        {t('account.delete.submit')}
      </button>
      {msg ? <p role="status">{msg}</p> : null}
    </form>
  );
}
