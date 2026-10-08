import { useCallback, useEffect, useState } from 'react';
import { api, get } from './api';
import { t, type MessageKey } from './i18n';
import { entityHref } from './route';
import { errorText } from './views';

/**
 * Physical Collection (COL-001/002/007): what the user owns on CD, LP or cassette.
 * Always shown as the owner's own record, separate from digital playback rights.
 */
export interface PhysicalItem {
  physical_item_id: string;
  format: Format;
  title: string;
  artist_name: string | null;
  barcode: string | null;
  catalog_number: string | null;
  release: { release_id: string; title: string } | null;
  notes: string | null;
  verification_state: 'self_declared' | 'evidence_reviewed';
}

type Format = 'cd' | 'vinyl' | 'cassette' | 'other';

const FORMATS = [
  ['cd', 'collection.format.cd'],
  ['vinyl', 'collection.format.vinyl'],
  ['cassette', 'collection.format.cassette'],
  ['other', 'collection.format.other'],
] as const satisfies readonly (readonly [Format, MessageKey])[];

const formatText = (f: Format) =>
  t(FORMATS.find(([k]) => k === f)?.[1] ?? 'collection.format.other');

/** Empty optional fields are sent as null, so editing can clear them. */
function optional(form: HTMLFormElement, name: string): string | null {
  const v = (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
  return v === '' ? null : v;
}

function ItemForm({
  item,
  onSaved,
  onCancel,
}: {
  item: PhysicalItem | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const prefix = item ? `phy-${item.physical_item_id}` : 'phy-new';
  return (
    <form
      className="card"
      aria-label={item ? t('collection.form.edit') : t('collection.form.add')}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const body = {
          format: (form.elements.namedItem('format') as HTMLSelectElement).value,
          title: (form.elements.namedItem('title') as HTMLInputElement).value.trim(),
          artist_name: optional(form, 'artist_name'),
          barcode: optional(form, 'barcode'),
          catalog_number: optional(form, 'catalog_number'),
          notes: optional(form, 'notes'),
        };
        const req = item
          ? api('PATCH', `/v1/physical-items/${item.physical_item_id}`, body)
          : api('POST', '/v1/physical-items', body);
        req.then(
          () => {
            if (!item) form.reset();
            setMsg(null);
            onSaved();
          },
          (x: unknown) => {
            setMsg(errorText(x));
          },
        );
      }}
    >
      {item ? null : <h3>{t('collection.form.add')}</h3>}
      <label htmlFor={`${prefix}-format`}>{t('collection.field.format')}</label>
      <select id={`${prefix}-format`} name="format" defaultValue={item?.format ?? 'cd'}>
        {FORMATS.map(([k, key]) => (
          <option key={k} value={k}>
            {t(key)}
          </option>
        ))}
      </select>
      <label htmlFor={`${prefix}-title`}>{t('collection.field.title')}</label>
      <input
        id={`${prefix}-title`}
        name="title"
        required
        maxLength={300}
        defaultValue={item?.title ?? ''}
      />
      <label htmlFor={`${prefix}-artist`}>{t('collection.field.artist')}</label>
      <input
        id={`${prefix}-artist`}
        name="artist_name"
        maxLength={300}
        defaultValue={item?.artist_name ?? ''}
      />
      <label htmlFor={`${prefix}-barcode`}>{t('collection.field.barcode')}</label>
      <input
        id={`${prefix}-barcode`}
        name="barcode"
        inputMode="numeric"
        pattern="[0-9]{8,14}"
        defaultValue={item?.barcode ?? ''}
      />
      <label htmlFor={`${prefix}-catalog`}>{t('collection.field.catalogNumber')}</label>
      <input
        id={`${prefix}-catalog`}
        name="catalog_number"
        maxLength={100}
        defaultValue={item?.catalog_number ?? ''}
      />
      <label htmlFor={`${prefix}-notes`}>{t('collection.field.notes')}</label>
      <textarea
        id={`${prefix}-notes`}
        name="notes"
        maxLength={2000}
        rows={2}
        defaultValue={item?.notes ?? ''}
      />
      <div className="actions">
        <button type="submit">
          {item ? t('collection.form.save') : t('collection.form.submit')}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
      {msg ? <p className="warn">{msg}</p> : null}
    </form>
  );
}

export function PhysicalCollection() {
  const [items, setItems] = useState<PhysicalItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    get<{ items: PhysicalItem[] }>('/v1/physical-items?limit=100').then(
      (r) => {
        setItems(r.items);
      },
      (e: unknown) => {
        setError(errorText(e));
      },
    );
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="collection-h">
      <h2 id="collection-h">{t('collection.title')}</h2>
      <p className="small muted">{t('collection.note')}</p>
      <ItemForm item={null} onSaved={load} />
      {error ? <p className="warn">{error}</p> : null}
      {items.length === 0 ? <p className="muted">{t('collection.empty')}</p> : null}
      <ul className="list" aria-label={t('collection.list')}>
        {items.map((i) => (
          <li key={i.physical_item_id}>
            {editing === i.physical_item_id ? (
              <ItemForm
                item={i}
                onSaved={() => {
                  setEditing(null);
                  load();
                }}
                onCancel={() => {
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <div>
                  <strong>{i.title}</strong>{' '}
                  <span className="muted">
                    {formatText(i.format)}
                    {i.artist_name ? ` · ${i.artist_name}` : ''}
                    {i.catalog_number ? ` · ${i.catalog_number}` : ''}
                    {i.barcode ? ` · ${i.barcode}` : ''}
                  </span>{' '}
                  <span className="badge">{t('collection.selfDeclared')}</span>
                  {i.release ? (
                    <p className="small">
                      {t('collection.edition')}{' '}
                      <a href={entityHref(i.release.release_id)}>{i.release.title}</a>
                    </p>
                  ) : null}
                  {i.notes ? <p className="small muted">{i.notes}</p> : null}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(i.physical_item_id);
                    }}
                  >
                    {t('archive.item.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t('collection.deleteConfirm'))) {
                        void api('DELETE', `/v1/physical-items/${i.physical_item_id}`).then(load);
                      }
                    }}
                  >
                    {t('archive.item.delete')}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On a release page: record that I own this edition on a physical medium. */
export function AddToCollection({
  releaseId,
  title,
  artist,
}: {
  releaseId: string;
  title: string;
  artist: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  // PLY-002: the release page says when the user owns it physically. A separate
  // badge from playback: owning the record never grants the digital master (COL-003).
  const [owned, setOwned] = useState<Format[]>([]);
  const loadOwned = useCallback(() => {
    get<{ items: PhysicalItem[] }>('/v1/physical-items?limit=100').then(
      (r) => {
        setOwned(r.items.filter((i) => i.release?.release_id === releaseId).map((i) => i.format));
      },
      () => undefined,
    );
  }, [releaseId]);
  useEffect(loadOwned, [loadOwned]);
  return (
    <>
      {owned.length > 0 ? (
        <span className="badge" role="note">
          {t('collection.ownedBadge', { formats: [...new Set(owned)].map(formatText).join(', ') })}
        </span>
      ) : null}{' '}
      <form
        className="inline"
        aria-label={t('collection.addRelease')}
        onSubmit={(e) => {
          e.preventDefault();
          const format = (e.currentTarget.elements.namedItem('format') as HTMLSelectElement).value;
          api('POST', '/v1/physical-items', {
            format,
            title,
            artist_name: artist || null,
            release_id: releaseId,
          }).then(
            () => {
              setMsg(t('collection.added'));
              loadOwned();
            },
            (x: unknown) => {
              setMsg(errorText(x));
            },
          );
        }}
      >
        <label htmlFor={`add-phy-${releaseId}`} className="visually-hidden">
          {t('collection.field.format')}
        </label>
        <select id={`add-phy-${releaseId}`} name="format" defaultValue="cd">
          {FORMATS.map(([k, key]) => (
            <option key={k} value={k}>
              {t(key)}
            </option>
          ))}
        </select>{' '}
        <button type="submit">{t('collection.addRelease')}</button>
        {msg ? <span role="status"> {msg}</span> : null}
      </form>
    </>
  );
}
