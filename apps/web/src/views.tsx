import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  get,
  OWNERSHIP_TEXT,
  REASON_TEXT,
  type Playability,
  type Playlist,
} from './api';
import { usePlayer, type QueueEntry } from './player';
import { entityHref, navigate, searchHref } from './route';

export function Status({ p }: { p: Playability }) {
  // Never colour-only (NFR-A11Y-003): always a text label.
  return p.playable ? (
    <span className="ok">재생 가능</span>
  ) : (
    <span className="warn">{REASON_TEXT[p.reason ?? ''] ?? p.reason}</span>
  );
}

export function Ownership({ o }: { o: string | null }) {
  return o ? <span className="badge">{OWNERSHIP_TEXT[o] ?? o}</span> : null;
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
  if (title === null) return <>(삭제됨)</>;
  return refType === 'audio_source' ? <>{title}</> : <a href={entityHref(refId)}>{title}</a>;
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? `${e.message} (${e.code})` : (e as Error).message;
}

export const toEntry = (i: {
  ref_type: string;
  ref_id: string;
  title: string | null;
  subtitle: string | null;
  ownership: string | null;
}): QueueEntry => ({
  key: `${i.ref_type}:${i.ref_id}`,
  title: i.title ?? '(제목 없음)',
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
        setMsg('다른 곳에서 변경되어 다시 불러왔습니다.');
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
      setMsg(
        e instanceof ApiError && e.status === 412
          ? '다른 곳에서 변경되어 다시 불러왔습니다.'
          : errorText(e),
      );
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
          placeholder="새 플레이리스트 이름"
          required
          maxLength={200}
          aria-label="플레이리스트 이름"
        />
        <button type="submit">만들기</button>
      </form>
      <ul className="list">
        {list.map((p) => (
          <li key={p.playlist_id}>
            <button type="button" className="link" onClick={() => void openPl(p.playlist_id)}>
              {p.title}
            </button>{' '}
            <span className="muted">{p.item_count}곡</span>
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
                    재생
                  </button>
                  <button
                    type="button"
                    aria-label="위로"
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
                    빼기
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {open.items_next_cursor ? (
            <button type="button" onClick={() => void loadMore()}>
              더 보기 ({open.items.length}/{open.item_count})
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
          placeholder="아티스트, 곡, 사람, 내 녹음"
          required
          maxLength={200}
          aria-label="검색어"
          defaultValue={query}
          key={query}
        />
        <button type="submit">검색</button>
      </form>
      <ul className="list">
        {results.map((r) => (
          <li key={r.id}>
            <div>
              <strong>
                {r.scope === 'catalog' ? <a href={entityHref(r.id)}>{r.title}</a> : r.title}
              </strong>{' '}
              <span className="muted">{r.subtitle}</span>{' '}
              <span className="badge">{r.scope === 'mine' ? '내 오디오' : r.kind}</span>
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
                  재생
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
                  저장
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
          <dt>구독</dt>
          <dd>{me.subscription_state}</dd>
          <dt>라이선스 지역</dt>
          <dd>{me.license_country ?? '미설정'}</dd>
          <dt>지원 문의 ID</dt>
          <dd>
            <code>{me.user_id}</code>
            <span className="small muted"> 문의할 때 이 ID를 알려 주세요.</span>
          </dd>
          <dt>저장 공간</dt>
          <dd>
            {quota
              ? `${(quota.used_bytes / 1024 ** 2).toFixed(1)} MiB / ${(quota.max_total_bytes / 1024 ** 3).toFixed(1)} GiB`
              : ''}
          </dd>
        </dl>
      ) : null}
      <div className="card">
        <h3>내보내기</h3>
        <p className="small muted">
          내가 올린 원본과 기록(라이브러리, 플레이리스트, Audio Log, DIG 기록)을 받습니다. 카탈로그
          음원은 포함되지 않습니다.
        </p>
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
          내보내기 요청
        </button>
        {exp ? (
          <p role="status">
            {exp.state}
            {exp.download_url ? (
              <>
                {' '}
                — <a href={exp.download_url}>다운로드 (15분 유효)</a>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
