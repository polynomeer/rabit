import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, type Schemas } from './api';
import { Icon } from './brand';
import { formatDate, t, type MessageKey } from './i18n';
import { usePlayer } from './player';
import { digHref, entityHref, lineageHref } from './route';
import { Status } from './views';

/**
 * Original-song lineage (DIG-003, TRU-005): the songs a recording comes from on one
 * side, the songs that come from it on the other, two steps each way. Every link shows
 * how we know it; a known link never means the use was licensed (DIG-018).
 */
type Lineage = Schemas['Lineage'];
type Node = Lineage['nodes'][number];
type Edge = Lineage['edges'][number];

const TYPE_TEXT: Record<Edge['type'], MessageKey> = {
  samples: 'lineage.type.samples',
  covers: 'lineage.type.covers',
  remix_of: 'lineage.type.remix_of',
};

/** How we know a link. Licence is shown only when it is known to be licensed. */
function LinkEvidence({ e }: { e: Edge['evidence'] }) {
  const basis =
    e.basis === 'verified_fact'
      ? t('dig.evidence.verified')
      : e.basis === 'declared'
        ? t('dig.evidence.declared')
        : t('dig.evidence.inferred', { percent: Math.round((e.confidence ?? 0) * 100) });
  return (
    <span className={`small evidence basis-${e.basis}`}>
      <Icon name={e.basis === 'ml_inferred' ? 'spark' : 'credits'} size={14} />
      {basis}
      {e.license_status === 'licensed' ? (
        <span className="muted"> · {t('lineage.licensed')}</span>
      ) : null}
    </span>
  );
}

/** Asks only whether a recording has any lineage, for the button on its page. */
export function useHasLineage(recordingId: string): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let live = true;
    setHas(false);
    get<Lineage>(`/v1/dig/entities/${recordingId}/lineage?depth=1`).then(
      (l) => {
        if (live) setHas(l.nodes.length > 0 || l.own_recordings.length > 0);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [recordingId]);
  return has;
}

function NodeCard({
  node,
  edge,
  children,
}: {
  node: Node;
  edge: Edge | undefined;
  children?: ReactNode;
}) {
  const player = usePlayer();
  const e = node.entity;
  const more = node.derivative_count !== null ? node.derivative_count - 1 : 0;
  return (
    <li
      className={`lineage-node basis-${edge?.evidence.basis ?? 'declared'}`}
      data-depth={node.depth}
    >
      {edge ? <p className="lineage-type">{t(TYPE_TEXT[edge.type])}</p> : null}
      <p className="lineage-title">
        <a href={entityHref(e.entity_id)}>{e.name}</a>
      </p>
      {e.subtitle ? <p className="small muted">{e.subtitle}</p> : null}
      {edge ? <LinkEvidence e={edge.evidence} /> : null}
      <div className="actions">
        <button
          type="button"
          disabled={!node.playability.playable}
          onClick={() => {
            player.play([
              {
                key: e.entity_id,
                title: e.name,
                subtitle: e.subtitle,
                recording_id: e.entity_id,
                cover_id: e.primary_release_id ?? undefined,
              },
            ]);
          }}
        >
          {t('common.play')}
        </button>
        <a className="button" href={lineageHref(e.entity_id)}>
          {more > 0 ? t('lineage.moreFrom', { count: more }) : t('lineage.recenter')}
        </a>
      </div>
      {!node.playability.playable ? <Status p={node.playability} /> : null}
      {children}
    </li>
  );
}

function Side({ title, side, data }: { title: string; side: Node['side']; data: Lineage }) {
  const rootId = data.root.entity.entity_id;
  const nodes = data.nodes.filter((n) => n.side === side);
  const depthOf = new Map<string, number>(nodes.map((n) => [n.entity.entity_id, n.depth]));
  depthOf.set(rootId, 0);
  // The link that places a node: towards the root, one step closer.
  const placing = (n: Node) =>
    data.edges.find((e) => {
      const here = side === 'origin' ? e.original_id : e.derived_id;
      const closer = side === 'origin' ? e.derived_id : e.original_id;
      return here === n.entity.entity_id && depthOf.get(closer) === n.depth - 1;
    });
  const parentOf = (n: Node) => {
    const e = placing(n);
    if (!e) return null;
    return side === 'origin' ? e.derived_id : e.original_id;
  };
  const first = nodes.filter((n) => n.depth === 1);
  return (
    <section className={`lineage-side lineage-${side}`} aria-labelledby={`lineage-${side}`}>
      <h3 id={`lineage-${side}`}>{title}</h3>
      {first.length === 0 ? (
        <p className="muted small">{t('lineage.none')}</p>
      ) : (
        <ul className="lineage-list">
          {first.map((n) => {
            const second = nodes.filter((m) => m.depth === 2 && parentOf(m) === n.entity.entity_id);
            return (
              <NodeCard key={n.entity.entity_id} node={n} edge={placing(n)}>
                {second.length > 0 ? (
                  <ul className="lineage-list nested" aria-label={t('lineage.further')}>
                    {second.map((m) => (
                      <NodeCard key={m.entity.entity_id} node={m} edge={placing(m)} />
                    ))}
                  </ul>
                ) : null}
              </NodeCard>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function LineageView({ id }: { id: string }) {
  const player = usePlayer();
  const [inferred, setInferred] = useState(false);
  const [data, setData] = useState<Lineage | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setMissing(false);
    get<Lineage>(
      `/v1/dig/entities/${id}/lineage?depth=2&include_inferred=${String(inferred)}`,
    ).then(
      (l) => {
        if (live) setData(l);
      },
      (e: unknown) => {
        if (live && e instanceof ApiError && e.status === 404) setMissing(true);
      },
    );
    return () => {
      live = false;
    };
  }, [id, inferred]);

  if (missing)
    return (
      <section aria-labelledby="lineage-h">
        <h2 id="lineage-h">{t('lineage.heading')}</h2>
        <p role="status">{t('lineage.missing')}</p>
      </section>
    );
  if (!data) return <p role="status">{t('common.loading')}</p>;
  const root = data.root.entity;
  const names = new Map([
    [root.entity_id, root.name],
    ...data.nodes.map((n) => [n.entity.entity_id, n.entity.name] as const),
  ]);
  return (
    <section aria-labelledby="lineage-h" className="lineage">
      <p className="eyebrow">{t('lineage.heading')}</p>
      <h2 id="lineage-h">
        <a href={entityHref(root.entity_id)}>{root.name}</a>
      </h2>
      {root.subtitle ? <p className="muted">{root.subtitle}</p> : null}
      <div className="actions">
        <label className="check small">
          <input
            type="checkbox"
            checked={inferred}
            onChange={(e) => {
              setInferred(e.target.checked);
            }}
          />{' '}
          {t('lineage.includeInferred')}
        </label>
        <a className="button" href={digHref(root.entity_id)}>
          {t('lineage.continueDig')}
        </a>
      </div>
      <p className="small muted">{t('lineage.note')}</p>
      <div className="lineage-columns">
        <Side title={t('lineage.origins')} side="origin" data={data} />
        <Side title={t('lineage.derived')} side="derived" data={data} />
      </div>
      {data.own_recordings.length > 0 ? (
        <section aria-labelledby="lineage-own" className="lineage-own">
          <h3 id="lineage-own">{t('lineage.own')}</h3>
          <ul className="lineage-list">
            {data.own_recordings.map((o) => (
              <li key={o.audio_log_id} className="lineage-node private">
                <p className="lineage-type">{t('lineage.ownBadge')}</p>
                <p className="lineage-title">{o.title}</p>
                <p className="small muted">
                  {t('lineage.ownLinked', {
                    name: names.get(o.linked_recording_id) ?? '',
                    date: formatDate(o.recorded_at),
                  })}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      player.play([
                        {
                          key: o.audio_source_id,
                          title: o.title,
                          audio_source_id: o.audio_source_id,
                        },
                      ]);
                    }}
                  >
                    {t('common.play')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {data.truncated ? <p className="small muted">{t('lineage.truncated')}</p> : null}
    </section>
  );
}
