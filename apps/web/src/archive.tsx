import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { api, get, sha256Hex, type LibraryItem } from './api';
import { formatDateTime, t, type MessageKey } from './i18n';
import { PhysicalCollection } from './collection';
import { Recorder } from './recorder';
import { usePlayer } from './player';
import { errorText, ItemTitle, Ownership, Status, toEntry } from './views';

/** Upload → presigned PUT → finalize → poll (audio-pipeline §2). */
function Upload({ onDone }: { onDone: () => void }) {
  // `settled` marks a final outcome (failed or cancelled): the form may be submitted again.
  const [busy, setBusy] = useState<{ text: string; settled: boolean } | null>(null);
  const working = (key: MessageKey) => {
    setBusy({ text: t(key), settled: false });
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

/** Archive: one library mixing private audio, Audio Logs and catalog items (BRD §10). */
export function Archive() {
  const player = usePlayer();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [logs, setLogs] = useState<Map<string, AudioLog>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
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

  return (
    <>
      <section aria-labelledby="archive-h">
        <h2 id="archive-h">Archive</h2>
        <Upload onDone={load} />
        {error ? <p className="warn">{error}</p> : null}
        <fieldset className="views">
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
              />{' '}
              {t(key)}
            </label>
          ))}
        </fieldset>
        <ul className="list">
          {shown.map((i) => {
            const log = i.ref_type === 'audio_source' ? logs.get(i.ref_id) : undefined;
            return (
              <li key={i.library_item_id}>
                <div>
                  <strong>
                    <ItemTitle refType={i.ref_type} refId={i.ref_id} title={i.title} />
                  </strong>{' '}
                  <span className="muted">{i.subtitle}</span> <Ownership o={i.ownership} />{' '}
                  <Status p={i.playability} />
                  {log ? (
                    <p className="small muted log-meta">
                      {formatDateTime(log.recorded_at)} ({log.recorded_tz})
                      {log.tags.length > 0 ? ` · #${log.tags.join(' #')}` : ''}
                      {log.note ? <span className="log-note"> · {log.note}</span> : null}
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
                      onClick={() =>
                        void api('DELETE', `/v1/library/${i.library_item_id}`).then(load)
                      }
                    >
                      {t('archive.item.removeFromLibrary')}
                    </button>
                  ) : null}
                </div>
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
          })}
          {items.length === 0 ? <li className="muted">{t('archive.empty')}</li> : null}
          {items.length > 0 && shown.length === 0 ? (
            <li className="muted">{t('archive.view.empty')}</li>
          ) : null}
        </ul>
      </section>
      <PhysicalCollection />
    </>
  );
}
