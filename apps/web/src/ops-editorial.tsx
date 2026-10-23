import { useEffect, useState } from 'react';
import { api, get, type Schemas } from './api';
import { formatDateTime, t } from './i18n';
import { entityHref } from './route';

/**
 * Editorial shelves in the operator console (ADR-0029): curate releases for Home,
 * target countries and a time window, publish. Every save and delete carries the
 * console's reason, which the server audits.
 */
type Shelf = Schemas['EditorialShelf'];
type Item = { release_id: string; title: string; note: string };

interface Draft {
  shelf_id: string | null;
  title: string;
  description: string;
  position: number;
  territories: string;
  starts_at: string;
  ends_at: string;
  published: boolean;
  items: Item[];
}

const EMPTY: Draft = {
  shelf_id: null,
  title: '',
  description: '',
  position: 0,
  territories: '',
  starts_at: '',
  ends_at: '',
  published: false,
  items: [],
};

/** `datetime-local` works in local time without a zone; the API wants an instant. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function draftOf(s: Shelf): Draft {
  return {
    shelf_id: s.shelf_id,
    title: s.title,
    description: s.description ?? '',
    position: s.position,
    territories: s.territories.join(', '),
    starts_at: toLocal(s.starts_at),
    ends_at: toLocal(s.ends_at),
    published: s.published,
    items: s.items.map((i) => ({ release_id: i.release_id, title: i.title, note: i.note ?? '' })),
  };
}

export function EditorialSection({
  reason,
  valid,
  run,
}: {
  reason: string;
  valid: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const load = () =>
    get<{ items: Shelf[] }>('/v1/ops/editorial/shelves').then(
      (r) => {
        setShelves(r.items);
      },
      () => {
        setShelves([]);
      },
    );
  useEffect(() => {
    void load();
  }, []);

  const save = (d: Draft) => {
    const body = {
      title: d.title,
      description: d.description.trim() || null,
      position: d.position,
      territories: d.territories
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
      starts_at: toIso(d.starts_at),
      ends_at: toIso(d.ends_at),
      published: d.published,
      items: d.items.map((i) => ({ release_id: i.release_id, note: i.note.trim() || null })),
      reason,
    };
    void run(t('ops.editorial.save'), () =>
      d.shelf_id
        ? api('PUT', `/v1/ops/editorial/shelves/${d.shelf_id}`, body)
        : api('POST', '/v1/ops/editorial/shelves', body),
    ).then((ok) => {
      if (ok) {
        setDraft(null);
        void load();
      }
    });
  };
  const remove = (id: string) => {
    void run(t('ops.editorial.delete'), () =>
      api('DELETE', `/v1/ops/editorial/shelves/${id}?reason=${encodeURIComponent(reason)}`),
    ).then((ok) => {
      if (ok) {
        setDraft(null);
        void load();
      }
    });
  };

  return (
    <section className="card" aria-labelledby="editorial-h">
      <div className="section-head">
        <h3 id="editorial-h">{t('ops.editorial.heading')}</h3>
        <button
          type="button"
          onClick={() => {
            setDraft(EMPTY);
          }}
        >
          {t('ops.editorial.new')}
        </button>
      </div>
      <p className="muted small">{t('ops.editorial.hint')}</p>
      {shelves === null ? (
        <p className="muted">{t('common.loading')}</p>
      ) : (
        <ul className="list" aria-label={t('ops.editorial.list')}>
          {shelves.map((s) => (
            <li key={s.shelf_id}>
              <div className="small">
                <strong>{s.title}</strong> ·{' '}
                {s.published ? t('ops.editorial.published') : t('ops.editorial.draft')} ·{' '}
                {s.territories.length ? s.territories.join(', ') : t('ops.editorial.everywhere')} ·{' '}
                {t('ops.editorial.count', { n: s.items.length })}
                {s.starts_at ? ` · ${formatDateTime(s.starts_at)} ~` : ''}
                {s.ends_at ? ` ${formatDateTime(s.ends_at)}` : ''}
              </div>
              <div className="actions">
                <button
                  type="button"
                  aria-label={t('ops.editorial.editNamed', { title: s.title })}
                  onClick={() => {
                    setDraft(draftOf(s));
                  }}
                >
                  {t('ops.editorial.edit')}
                </button>
              </div>
            </li>
          ))}
          {shelves.length === 0 ? <li className="muted">{t('ops.editorial.empty')}</li> : null}
        </ul>
      )}
      {draft ? (
        <ShelfEditor
          draft={draft}
          valid={valid}
          onChange={setDraft}
          onSave={save}
          onDelete={remove}
          onCancel={() => {
            setDraft(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ShelfEditor({
  draft,
  valid,
  onChange,
  onSave,
  onDelete,
  onCancel,
}: {
  draft: Draft;
  valid: boolean;
  onChange: (d: Draft) => void;
  onSave: (d: Draft) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<Draft>) => {
    onChange({ ...draft, ...patch });
  };
  const move = (at: number, by: number) => {
    const items = [...draft.items];
    const [it] = items.splice(at, 1);
    if (it) items.splice(at + by, 0, it);
    set({ items });
  };
  return (
    <form
      className="stack"
      aria-label={t('ops.editorial.form')}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <label>
        {t('ops.editorial.title')}
        <input
          value={draft.title}
          maxLength={120}
          required
          onChange={(e) => {
            set({ title: e.target.value });
          }}
        />
      </label>
      <label>
        {t('ops.editorial.description')}
        <input
          value={draft.description}
          maxLength={500}
          onChange={(e) => {
            set({ description: e.target.value });
          }}
        />
      </label>
      <div className="row">
        <label>
          {t('ops.editorial.territories')}
          <input
            value={draft.territories}
            placeholder="KR, JP"
            pattern="^\s*([A-Za-z]{2}\s*(,\s*[A-Za-z]{2}\s*)*)?$"
            onChange={(e) => {
              set({ territories: e.target.value });
            }}
          />
        </label>
        <label>
          {t('ops.editorial.position')}
          <input
            type="number"
            min={0}
            max={1000}
            value={draft.position}
            onChange={(e) => {
              set({ position: Number(e.target.value) });
            }}
          />
        </label>
      </div>
      <div className="row">
        <label>
          {t('ops.editorial.startsAt')}
          <input
            type="datetime-local"
            value={draft.starts_at}
            onChange={(e) => {
              set({ starts_at: e.target.value });
            }}
          />
        </label>
        <label>
          {t('ops.editorial.endsAt')}
          <input
            type="datetime-local"
            value={draft.ends_at}
            onChange={(e) => {
              set({ ends_at: e.target.value });
            }}
          />
        </label>
      </div>
      <label className="row">
        <input
          type="checkbox"
          checked={draft.published}
          onChange={(e) => {
            set({ published: e.target.checked });
          }}
        />
        {t('ops.editorial.publish')}
      </label>

      <ol className="list" aria-label={t('ops.editorial.items')}>
        {draft.items.map((i, at) => (
          <li key={i.release_id}>
            <div className="small">
              <a href={entityHref(i.release_id)}>{i.title}</a>
            </div>
            <input
              aria-label={t('ops.editorial.note', { title: i.title })}
              placeholder={t('ops.editorial.notePlaceholder')}
              value={i.note}
              maxLength={200}
              onChange={(e) => {
                set({
                  items: draft.items.map((x) =>
                    x.release_id === i.release_id ? { ...x, note: e.target.value } : x,
                  ),
                });
              }}
            />
            <div className="actions">
              <button
                type="button"
                disabled={at === 0}
                aria-label={t('ops.editorial.up', { title: i.title })}
                onClick={() => {
                  move(at, -1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={at === draft.items.length - 1}
                aria-label={t('ops.editorial.down', { title: i.title })}
                onClick={() => {
                  move(at, 1);
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={t('ops.editorial.removeItem', { title: i.title })}
                onClick={() => {
                  set({ items: draft.items.filter((x) => x.release_id !== i.release_id) });
                }}
              >
                {t('ops.editorial.removeShort')}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <ReleasePicker
        exclude={new Set(draft.items.map((i) => i.release_id))}
        full={draft.items.length >= 50}
        onPick={(r) => {
          set({ items: [...draft.items, { ...r, note: '' }] });
        }}
      />

      <div className="actions">
        <button type="submit" disabled={!valid}>
          {t('ops.editorial.save')}
        </button>
        {draft.shelf_id ? (
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (draft.shelf_id) onDelete(draft.shelf_id);
            }}
          >
            {t('ops.editorial.delete')}
          </button>
        ) : null}
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** Finds catalog releases by title to add to the shelf. */
function ReleasePicker({
  exclude,
  full,
  onPick,
}: {
  exclude: Set<string>;
  full: boolean;
  onPick: (r: { release_id: string; title: string }) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string; subtitle: string | null }[]>([]);
  return (
    <div className="stack">
      <div className="row">
        <input
          aria-label={t('ops.editorial.search')}
          placeholder={t('ops.editorial.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
        <button
          type="button"
          disabled={q.trim().length === 0}
          onClick={() => {
            void get<{ items: { id: string; title: string; subtitle: string | null }[] }>(
              `/v1/search?q=${encodeURIComponent(q.trim())}&scope=catalog&types=release&limit=10`,
            ).then(
              (r) => {
                setHits(r.items);
              },
              () => {
                setHits([]);
              },
            );
          }}
        >
          {t('ops.editorial.find')}
        </button>
      </div>
      <ul className="list" aria-label={t('ops.editorial.results')}>
        {hits
          .filter((h) => !exclude.has(h.id))
          .map((h) => (
            <li key={h.id}>
              <div className="small">
                <strong>{h.title}</strong> {h.subtitle ? `· ${h.subtitle}` : ''}
              </div>
              <button
                type="button"
                disabled={full}
                aria-label={t('ops.editorial.add', { title: h.title })}
                onClick={() => {
                  onPick({ release_id: h.id, title: h.title });
                }}
              >
                {t('ops.editorial.addShort')}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
