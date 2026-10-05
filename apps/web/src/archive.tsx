import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { api, get, sha256Hex, type LibraryItem } from './api';
import { usePlayer } from './player';
import { errorText, ItemTitle, Ownership, Status, toEntry } from './views';

/** Upload → presigned PUT → finalize → poll (audio-pipeline §2). */
function Upload({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [intent, setIntent] = useState<'private_upload' | 'audio_log'>('private_upload');
  const [logTitle, setLogTitle] = useState('');

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('file') as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      setBusy('체크섬 계산 중…');
      const sha256 = await sha256Hex(file);
      setBusy('업로드 준비 중…');
      const { data: intentRes } = await api<{
        upload: { upload_id: string };
        upload_url: string;
        upload_headers: Record<string, string>;
      }>('POST', '/v1/uploads', { intent, size_bytes: file.size, sha256, filename: file.name });
      setBusy('전송 중…');
      const put = await fetch(intentRes.upload_url, {
        method: 'PUT',
        headers: intentRes.upload_headers,
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const { data: fin } = await api<{ audio_source_id: string }>(
        'POST',
        `/v1/uploads/${intentRes.upload.upload_id}/finalize`,
        undefined,
        { 'idempotency-key': `fin-${intentRes.upload.upload_id}` },
      );
      setBusy('처리 중…');
      for (let i = 0; i < 240; i++) {
        const s = await get<{ status: string; failure_code: string | null }>(
          `/v1/audio-sources/${fin.audio_source_id}`,
        );
        if (s.status === 'ready') break;
        if (s.status === 'failed') throw new Error(`처리 실패: ${s.failure_code ?? ''}`);
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
      setBusy('보관함에 추가하는 중…');
      for (let i = 0; i < 20; i++) {
        const lib = await get<{ items: LibraryItem[] }>(
          '/v1/library?ref_type=audio_source&limit=100',
        );
        if (lib.items.some((x) => x.ref_id === fin.audio_source_id)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      setBusy(null);
      input.value = '';
      onDone();
    } catch (err) {
      setBusy(`실패: ${errorText(err)}`);
    }
  }

  return (
    <form className="card" onSubmit={(e) => void submit(e)} aria-label="오디오 업로드">
      <h3>업로드</h3>
      <fieldset>
        <legend>종류</legend>
        <label>
          <input
            type="radio"
            name="intent"
            checked={intent === 'private_upload'}
            onChange={() => {
              setIntent('private_upload');
            }}
          />{' '}
          개인 오디오
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
          제목{' '}
          <input
            value={logTitle}
            onChange={(e) => {
              setLogTitle(e.target.value);
            }}
            maxLength={200}
          />
        </label>
      ) : null}
      <input name="file" type="file" accept="audio/*" aria-label="오디오 파일" required />
      <button type="submit" disabled={busy !== null && !busy.startsWith('실패')}>
        업로드
      </button>
      <p className="small muted">비공개로 저장되며 다른 사용자에게 보이지 않습니다.</p>
      {busy ? <p role="status">{busy}</p> : null}
    </form>
  );
}

/** Archive: one library mixing private audio, Audio Logs and catalog items (BRD §10). */
export function Archive() {
  const player = usePlayer();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    get<{ items: LibraryItem[] }>('/v1/library?limit=100')
      .then((r) => {
        setItems(r.items);
      })
      .catch((e: unknown) => {
        setError(errorText(e));
      });
  }, []);
  useEffect(load, [load]);
  const playable = items.filter((i) => i.ref_type !== 'release');

  return (
    <section aria-labelledby="archive-h">
      <h2 id="archive-h">Archive</h2>
      <Upload onDone={load} />
      {error ? <p className="warn">{error}</p> : null}
      <ul className="list">
        {items.map((i) => (
          <li key={i.library_item_id}>
            <div>
              <strong>
                <ItemTitle refType={i.ref_type} refId={i.ref_id} title={i.title} />
              </strong>{' '}
              <span className="muted">{i.subtitle}</span> <Ownership o={i.ownership} />{' '}
              <Status p={i.playability} />
            </div>
            <div className="actions">
              {i.ref_type !== 'release' && i.playability.playable ? (
                <button
                  type="button"
                  onClick={() => {
                    player.play(playable.map(toEntry), playable.indexOf(i));
                  }}
                >
                  재생
                </button>
              ) : null}
              {i.ref_type === 'audio_source' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('이 오디오를 삭제할까요? 되돌릴 수 없습니다.')) {
                      void api('DELETE', `/v1/audio-sources/${i.ref_id}`).then(load);
                    }
                  }}
                >
                  삭제
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="muted">아직 아무것도 없습니다. 첫 녹음이나 파일을 올려 보세요.</li>
        ) : null}
      </ul>
    </section>
  );
}

