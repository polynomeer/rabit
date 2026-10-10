import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { api, get, sha256Hex, type LibraryItem } from './api';
import { formatDateTime, formatMonth, t, type MessageKey } from './i18n';
import { Mark } from './brand';
import { PhysicalCollection } from './collection';
import { AddToPlaylist } from './playlist-add';
import { Recorder } from './recorder';
import { entityHref, tabHref } from './route';
import { usePlayer } from './player';
import { errorText, ItemTitle, Ownership, Status, toEntry } from './views';

/** The upload's steps as shown to the owner; the status line below stays the spoken text. */
const STAGES = [
  'archive.upload.step.check',
  'archive.upload.step.transfer',
  'archive.upload.step.process',
  'archive.upload.step.archive',
] as const satisfies readonly MessageKey[];
const STAGE_OF: Partial<Record<MessageKey, number>> = {
  'archive.upload.hashing': 0,
  'archive.upload.preparing': 0,
  'archive.upload.transferring': 1,
  'archive.upload.processing': 2,
  'archive.upload.adding': 3,
};

/** Upload → presigned PUT → finalize → poll (audio-pipeline §2). Shown in Studio. */
export function Upload({ onDone }: { onDone: () => void }) {
  // `settled` marks a final outcome (failed or cancelled): the form may be submitted again.
  const [busy, setBusy] = useState<{ text: string; settled: boolean } | null>(null);
  const [stage, setStage] = useState(0);
  const working = (key: MessageKey) => {
    setBusy({ text: t(key), settled: false });
    setStage(STAGE_OF[key] ?? 0);
  };
  const [intent, setIntent] = useState<'private_upload' | 'audio_log'>('private_upload');
  const [logTitle, setLogTitle] = useState('');
  // A microphone recording replaces the file input for Audio Log (LOG-004).
  const [recorded, setRecorded] = useState<File | null>(null);
  const [recorderKey, setRecorderKey] = useState(0);
  // Cancelling is possible until finalize: it stops the transfer and releases the
  // upload's quota reservation on the server. Afterwards the audio is deleted instead.
  const cancel = useRef<{ abort: AbortController; uploadId: string | null } | null>(null);

  async function stop() {
    const c = cancel.current;
    if (!c) return;
    cancel.current = null;
    c.abort.abort();
    if (c.uploadId) await api('DELETE', `/v1/uploads/${c.uploadId}`).catch(() => undefined);
    setBusy({ text: t('archive.upload.cancelled'), settled: true });
  }

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('file') as HTMLInputElement;
    const file = (intent === 'audio_log' ? recorded : null) ?? input.files?.[0];
    if (!file) return;
    const run = { abort: new AbortController(), uploadId: null as string | null };
    cancel.current = run;
    const cancelled = () => run.abort.signal.aborted;
    try {
      working('archive.upload.hashing');
      const sha256 = await sha256Hex(file);
      if (cancelled()) return;
      working('archive.upload.preparing');
      const { data: intentRes } = await api<{
        upload: { upload_id: string };
        upload_url: string;
        upload_headers: Record<string, string>;
      }>('POST', '/v1/uploads', { intent, size_bytes: file.size, sha256, filename: file.name });
      run.uploadId = intentRes.upload.upload_id;
      if (cancelled()) {
        await api('DELETE', `/v1/uploads/${run.uploadId}`).catch(() => undefined);
        return;
      }
      working('archive.upload.transferring');
      const put = await fetch(intentRes.upload_url, {
        method: 'PUT',
        headers: intentRes.upload_headers,
        body: file,
        signal: run.abort.signal,
      });
      if (!put.ok) throw new Error(t('archive.upload.transferFailed', { status: put.status }));
      if (cancelled()) return;
      cancel.current = null; // finalize begins: from here on, delete the audio instead
      const { data: fin } = await api<{ audio_source_id: string }>(
        'POST',
        `/v1/uploads/${intentRes.upload.upload_id}/finalize`,
        undefined,
        { 'idempotency-key': `fin-${intentRes.upload.upload_id}` },
      );
      working('archive.upload.processing');
      for (let i = 0; i < 240; i++) {
        const s = await get<{ status: string; failure_code: string | null }>(
          `/v1/audio-sources/${fin.audio_source_id}`,
        );
        if (s.status === 'ready') break;
        if (s.status === 'failed')
          throw new Error(t('archive.upload.processingFailed', { code: s.failure_code ?? '' }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (intent === 'audio_log') {
        await api('POST', '/v1/audio-logs', {
          audio_source_id: fin.audio_source_id,
          title: logTitle || file.name,
          recorded_at: new Date(file.lastModified).toISOString(),
          recorded_tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }
      // The Archive entry is created asynchronously after processing (AudioReady
      // consumer); wait briefly so the list does not reload before it exists.
      working('archive.upload.adding');
      for (let i = 0; i < 20; i++) {
        const lib = await get<{ items: LibraryItem[] }>(
          '/v1/library?ref_type=audio_source&limit=100',
        );
        if (lib.items.some((x) => x.ref_id === fin.audio_source_id)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      setBusy(null);
      input.value = '';
      setLogTitle('');
      setRecorded(null);
      setRecorderKey((k) => k + 1);
      onDone();
    } catch (err) {
      if (cancelled()) return;
      cancel.current = null;
      setBusy({ text: t('archive.upload.failed', { error: errorText(err) }), settled: true });
    }
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)} aria-label={t('archive.upload.form')}>
      <h3>{t('archive.upload.title')}</h3>
      <fieldset>
        <legend>{t('archive.upload.kind')}</legend>
        <label>
          <input
            type="radio"
            name="intent"
            checked={intent === 'private_upload'}
            onChange={() => {
              setIntent('private_upload');
            }}
          />{' '}
          {t('archive.upload.private')}
        </label>
        <label>
          <input
            type="radio"
            name="intent"
            checked={intent === 'audio_log'}
            onChange={() => {
              setIntent('audio_log');
            }}
          />{' '}
          Audio Log
        </label>
      </fieldset>
      {intent === 'audio_log' ? (
        <label>
          {t('common.title')}{' '}
          <input
            value={logTitle}
            onChange={(e) => {
              setLogTitle(e.target.value);
            }}
            maxLength={200}
          />
        </label>
      ) : null}
      {intent === 'audio_log' ? <Recorder key={recorderKey} onRecorded={setRecorded} /> : null}
      <input
        name="file"
        type="file"
        accept="audio/*"
        aria-label={t('archive.upload.file')}
        required={!(intent === 'audio_log' && recorded)}
        hidden={intent === 'audio_log' && recorded !== null}
      />
      <div className="actions">
        <button type="submit" disabled={busy !== null && !busy.settled}>
          {t('archive.upload.submit')}
        </button>
        {busy !== null && cancel.current ? (
          <button type="button" onClick={() => void stop()}>
            {t('archive.upload.cancel')}
          </button>
        ) : null}
      </div>
      <p className="small muted">{t('archive.upload.privacyNote')}</p>
      {busy && !busy.settled ? (
        <ol className="steps" aria-hidden="true">
          {STAGES.map((key, i) => (
            <li key={key} className={i < stage ? 'done' : i === stage ? 'active' : undefined}>
              {t(key)}
            </li>
          ))}
        </ol>
      ) : null}
      {busy ? <p role="status">{busy.text}</p> : null}
    </form>
  );
}

interface AudioLog {
  audio_log_id: string;
  audio_source_id: string;
  title: string;
  note: string | null;
  recorded_at: string;
  recorded_tz: string;
  tags: string[];
  linked_recording_id: string | null;
}

/**
 * The catalog track an Audio Log is about (LOG-003), e.g. a cover practice of a
 * song. Chosen from search; a link is the owner's note, not a rights claim.
 */
function LinkedTrackPicker({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string; subtitle: string | null }[]>([]);
  return (
    <fieldset>
      <legend>{t('archive.log.linked')}</legend>
      {value ? (
        <p>
          <a href={entityHref(value.id)}>{value.name}</a>{' '}
          <button
            type="button"
            onClick={() => {
              onChange(null);
            }}
          >
            {t('archive.log.unlink')}
          </button>
        </p>
      ) : null}
      <label htmlFor="link-search">{t('archive.log.linkSearch')}</label>{' '}
      <input
        id="link-search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault();
        }}
      />{' '}
      <button
        type="button"
        disabled={q.trim() === ''}
        onClick={() => {
          void get<{
            items: { id: string; kind: string; title: string; subtitle: string | null }[];
          }>(`/v1/search?q=${encodeURIComponent(q.trim())}`).then((r) => {
            setHits(r.items.filter((i) => i.kind === 'recording').slice(0, 8));
          });
        }}
      >
        {t('archive.log.find')}
      </button>
      {hits.length > 0 ? (
        <ul className="list" aria-label={t('archive.log.linkResults')}>
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: h.id, name: h.title });
                  setHits([]);
                }}
              >
                {t('archive.log.linkThis', { title: h.title })}
              </button>{' '}
              <span className="muted small">{h.subtitle}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

/** `2026-10-03T22:15:00Z` → `2026-10-04T07:15` in the browser's time zone (for datetime-local). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Audio Log metadata (LOG-003/005): title, note, tags and the recording time.
 * Correcting the time never changes the audio itself. Only changed fields are sent.
 */
function AudioLogEditor({
  log,
  onSaved,
  onCancel,
}: {
  log: AudioLog;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ id: string; name: string } | null>(
    log.linked_recording_id
      ? { id: log.linked_recording_id, name: t('archive.log.linkedTrack') }
      : null,
  );
  // Show the linked track's real name once it is known.
  useEffect(() => {
    if (!log.linked_recording_id) return;
    const id = log.linked_recording_id;
    void get<{ name: string }>(`/v1/entities/${id}`).then(
      (e) => {
        setLinked((cur) => (cur?.id === id ? { id, name: e.name } : cur));
      },
      () => undefined,
    );
  }, [log.linked_recording_id]);
  return (
    <form
      className="card"
      aria-label={t('archive.log.editForm')}
      onSubmit={(e) => {
        e.preventDefault();
        const f = e.currentTarget.elements;
        const value = (name: string) => (f.namedItem(name) as HTMLInputElement).value;
        const title = value('title').trim();
        const note = value('note').trim();
        const tags = value('tags')
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        const when = value('recorded_at');
        const patch: Record<string, unknown> = {};
        if (title !== log.title) patch['title'] = title;
        if (note !== (log.note ?? '')) patch['note'] = note === '' ? null : note;
        if (tags.join(',') !== log.tags.join(',')) patch['tags'] = tags;
        if ((linked?.id ?? null) !== log.linked_recording_id) {
          patch['linked_recording_id'] = linked?.id ?? null;
        }
        if (when !== toLocalInput(log.recorded_at)) {
          patch['recorded_at'] = new Date(when).toISOString();
          patch['recorded_tz'] = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        if (Object.keys(patch).length === 0) {
          onCancel();
          return;
        }
        api('PATCH', `/v1/audio-logs/${log.audio_log_id}`, patch).then(onSaved, (err: unknown) => {
          setMsg(t('archive.log.saveFailed', { error: errorText(err) }));
        });
      }}
    >
      <label>
        {t('common.title')} <input name="title" defaultValue={log.title} required maxLength={200} />
      </label>
      <label>
        {t('archive.log.note')}{' '}
        <textarea name="note" defaultValue={log.note ?? ''} maxLength={5000} rows={3} />
      </label>
      <label>
        {t('archive.log.tags')} <input name="tags" defaultValue={log.tags.join(', ')} />
      </label>
      <label>
        {t('archive.log.recordedAt')}{' '}
        <input
          name="recorded_at"
          type="datetime-local"
          defaultValue={toLocalInput(log.recorded_at)}
          required
        />
      </label>
      <LinkedTrackPicker value={linked} onChange={setLinked} />
      <div className="actions">
        <button type="submit">{t('common.save')}</button>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      {msg ? <p role="status">{msg}</p> : null}
    </form>
  );
}

/**
 * Archive views (LIB-001): everything, or one kind. Purchases arrive with
 * payments (Commercial Gate); memories and trips need location (P2).
 */
const VIEWS = [
  ['all', 'archive.view.all'],
  ['private', 'archive.view.private'],
  ['audio_log', 'archive.view.audioLog'],
  ['recording', 'archive.view.recording'],
  ['release', 'archive.view.release'],
] as const satisfies readonly (readonly [string, MessageKey])[];
type View = (typeof VIEWS)[number][0];

/** Groups items by calendar month, newest first (BRD §10: time as the Archive's axis). */
function byMonth<T>(
  list: T[],
  dateOf: (item: T) => string,
): { key: string; label: string; items: T[] }[] {
  const groups = new Map<string, { key: string; label: string; items: T[] }>();
  const sorted = [...list].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  for (const item of sorted) {
    const d = new Date(dateOf(item));
    const key = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: formatMonth(d), items: [] };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

/** Catalog items show their stand-in cover; private audio and Audio Logs an icon tile. */
function ItemMark({ item, isLog }: { item: LibraryItem; isLog: boolean }) {
  const kind =
    item.ref_type === 'audio_source' ? (isLog ? 'audio_log' : 'private_audio') : item.ref_type;
  return (
    <Mark
      id={item.primary_release_id ?? item.ref_id}
      kind={kind}
      name={item.title ?? ''}
      size={56}
    />
  );
}

/** Archive: one library mixing private audio, Audio Logs and catalog items (BRD §10). */
export function Archive() {
  const player = usePlayer();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [logs, setLogs] = useState<Map<string, AudioLog>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [renaming, setRenaming] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([
      get<{ items: LibraryItem[] }>('/v1/library?limit=100'),
      get<{ items: AudioLog[] }>('/v1/audio-logs?limit=100'),
    ])
      .then(([lib, log]) => {
        setItems(lib.items);
        setLogs(new Map(log.items.map((l) => [l.audio_source_id, l])));
      })
      .catch((e: unknown) => {
        setError(errorText(e));
      });
  }, []);
  useEffect(load, [load]);
  const inView = (i: LibraryItem) => {
    const isLog = i.ref_type === 'audio_source' && logs.has(i.ref_id);
    if (view === 'private') return i.ref_type === 'audio_source' && !isLog;
    if (view === 'audio_log') return isLog;
    if (view === 'recording' || view === 'release') return i.ref_type === view;
    return true;
  };
  const shown = items.filter(inView);
  const playable = shown.filter((i) => i.ref_type !== 'release');

  const renderItem = (i: LibraryItem) => {
    const log = i.ref_type === 'audio_source' ? logs.get(i.ref_id) : undefined;
    return (
      <li key={i.library_item_id}>
        <ItemMark item={i} isLog={log !== undefined} />
        <div className="item-main">
          <strong>
            <ItemTitle refType={i.ref_type} refId={i.ref_id} title={i.title} />
          </strong>{' '}
          {/* An Audio Log's subtitle is just "Audio Log": the badge already says it. */}
          {log ? null : <span className="muted">{i.subtitle}</span>} <Ownership o={i.ownership} />{' '}
          <Status p={i.playability} />
          {log ? (
            <p className="small muted log-meta">
              {formatDateTime(log.recorded_at)} ({log.recorded_tz})
              {log.tags.length > 0 ? ` · #${log.tags.join(' #')}` : ''}
              {log.note ? <span className="log-note"> · {log.note}</span> : null}
              {log.linked_recording_id ? (
                <>
                  {' · '}
                  <a href={entityHref(log.linked_recording_id)}>{t('archive.log.linkedTrack')}</a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="actions">
          {i.ref_type !== 'release' && i.playability.playable ? (
            <button
              type="button"
              onClick={() => {
                player.play(playable.map(toEntry), playable.indexOf(i));
              }}
            >
              {t('common.play')}
            </button>
          ) : null}
          {log ? (
            <button
              type="button"
              onClick={() => {
                setEditing(editing === log.audio_log_id ? null : log.audio_log_id);
              }}
            >
              {t('archive.item.edit')}
            </button>
          ) : null}
          {i.ref_type === 'audio_source' && !log ? (
            <button
              type="button"
              onClick={() => {
                setRenaming(renaming === i.ref_id ? null : i.ref_id);
              }}
            >
              {t('archive.item.rename')}
            </button>
          ) : null}
          {i.ref_type !== 'release' ? (
            <AddToPlaylist
              refType={i.ref_type === 'audio_source' ? 'audio_source' : 'recording'}
              refId={i.ref_id}
            />
          ) : null}
          {i.ref_type === 'audio_source' ? (
            <button
              type="button"
              onClick={() => {
                if (confirm(t('archive.item.deleteConfirm'))) {
                  void api('DELETE', `/v1/audio-sources/${i.ref_id}`).then(load);
                }
              }}
            >
              {t('archive.item.delete')}
            </button>
          ) : null}
          {i.origin === 'saved' ? (
            // Removing a saved item never revokes an entitlement (domain-model §1).
            <button
              type="button"
              onClick={() => void api('DELETE', `/v1/library/${i.library_item_id}`).then(load)}
            >
              {t('archive.item.removeFromLibrary')}
            </button>
          ) : null}
        </div>
        {renaming === i.ref_id ? (
          <form
            className="inline"
            aria-label={t('archive.item.rename')}
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement;
              void api('PATCH', `/v1/audio-sources/${i.ref_id}`, {
                title: input.value.trim(),
              }).then(() => {
                setRenaming(null);
                load();
              });
            }}
          >
            <label htmlFor={`rename-${i.ref_id}`} className="visually-hidden">
              {t('archive.item.renameField')}
            </label>
            <input
              id={`rename-${i.ref_id}`}
              name="title"
              defaultValue={i.title ?? ''}
              maxLength={200}
              required
            />{' '}
            <button type="submit">{t('common.save')}</button>
          </form>
        ) : null}
        {log && editing === log.audio_log_id ? (
          <AudioLogEditor
            log={log}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </li>
    );
  };

  return (
    <>
      <section aria-labelledby="archive-h" className="archive">
        <h2 id="archive-h">Archive</h2>
        <p className="lede">{t('archive.lede')}</p>
        <p className="muted">
          <a href={tabHref('Studio')}>{t('archive.uploadInStudio')}</a>
        </p>
        {error ? <p className="warn">{error}</p> : null}
        <fieldset className="views chips">
          <legend>{t('archive.view.label')}</legend>
          {VIEWS.map(([v, key]) => (
            <label key={v}>
              <input
                type="radio"
                name="archive-view"
                checked={view === v}
                onChange={() => {
                  setView(v);
                }}
              />
              {t(key)}
            </label>
          ))}
        </fieldset>
        {shown.length === 0 ? (
          <ul className="list">
            {items.length === 0 ? <li className="muted">{t('archive.empty')}</li> : null}
            {items.length > 0 ? <li className="muted">{t('archive.view.empty')}</li> : null}
          </ul>
        ) : (
          byMonth(shown, (i) => logs.get(i.ref_id)?.recorded_at ?? i.saved_at).map((m) => (
            <div key={m.key} className="month">
              <h3 className="eyebrow month-title">{m.label}</h3>
              <ul className="list archive-list">{m.items.map(renderItem)}</ul>
            </div>
          ))
        )}
      </section>
      <PhysicalCollection />
    </>
  );
}
