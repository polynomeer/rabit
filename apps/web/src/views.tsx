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
  return o ? <span className="badge">{tCode(OWNERSHIP_TEXT, o)}</span> : null;
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
}): QueueEntry => ({
  key: `${i.ref_type}:${i.ref_id}`,
  title: i.title ?? t('common.untitled'),
  subtitle: i.subtitle,
  ownership: i.ownership,
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
    <section aria-labelledby="pl-h">
      <h2 id="pl-h">Playlists</h2>
      <form
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
      <ul className="list">
        {list.map((p) => (
          <li key={p.playlist_id}>
            <button type="button" className="link" onClick={() => void openPl(p.playlist_id)}>
              {p.title}
            </button>{' '}
            <span className="muted">{t('playlists.itemCount', { count: p.item_count })}</span>
          </li>
        ))}
      </ul>
      {msg ? <p role="status">{msg}</p> : null}
      {open ? (
        <div className="card">
          <h3>{open.title}</h3>
          <ol className="list">
            {open.items.map((i, idx) => (
              <li key={i.item_id}>
                <div>
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
                      void mutate('DELETE', `/v1/playlists/${open.playlist_id}/items/${i.item_id}`)
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
    </section>
  );
}

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
    }[]
  >([]);
  // The query lives in the URL, so returning from a detail page shows the same results.
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let stale = false;
    void get<{ items: typeof results }>(`/v1/search?q=${encodeURIComponent(query)}`).then((r) => {
      if (!stale) setResults(r.items);
    });
    return () => {
      stale = true;
    };
  }, [query]);
  return (
    <section aria-labelledby="search-h">
      <h2 id="search-h">Search</h2>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim();
          if (q) navigate(searchHref(q));
        }}
      >
        <input
          name="q"
          placeholder={t('search.placeholder')}
          required
          maxLength={200}
          aria-label={t('search.label')}
          defaultValue={query}
          key={query}
        />
        <button type="submit">{t('search.submit')}</button>
      </form>
      <ul className="list">
        {results.map((r) => (
          <li key={r.id}>
            <div>
              <strong>
                {r.scope === 'catalog' ? <a href={entityHref(r.id)}>{r.title}</a> : r.title}
              </strong>{' '}
              <span className="muted">{r.subtitle}</span>{' '}
              <span className="badge">{r.scope === 'mine' ? t('search.mine') : r.kind}</span>
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
                          ? { recording_id: r.id }
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
                <button
                  type="button"
                  onClick={() =>
                    void api('POST', '/v1/library', { ref_type: r.kind, ref_id: r.id }).catch(
                      () => undefined,
                    )
                  }
                >
                  {t('common.save')}
                </button>
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
    <section aria-labelledby="acct-h">
      <h2 id="acct-h">Account</h2>
      {me ? (
        <dl className="card">
          <dt>{t('account.subscription')}</dt>
          <dd>{tCode(SUB_STATE, me.subscription_state)}</dd>
          <dt>{t('account.licenseCountry')}</dt>
          <dd>{me.license_country ?? t('account.licenseCountry.unset')}</dd>
          <dt>{t('account.supportId')}</dt>
          <dd>
            <code>{me.user_id}</code>
            <span className="small muted"> {t('account.supportId.hint')}</span>
          </dd>
          <dt>{t('account.storage')}</dt>
          <dd>
            {quota
              ? t('account.storage.usage', {
                  used: (quota.used_bytes / 1024 ** 2).toFixed(1),
                  max: (quota.max_total_bytes / 1024 ** 3).toFixed(1),
                })
              : ''}
          </dd>
        </dl>
      ) : null}
      <Entitlements />
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
