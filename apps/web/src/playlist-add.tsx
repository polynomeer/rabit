import { useState } from 'react';
import { api, ApiError, get } from './api';
import { t } from './i18n';
import { errorText } from './views';

/**
 * Add a track or a private audio to one of the user's playlists (LIB-003). The
 * playlist is versioned: read its ETag, then add with If-Match; a concurrent
 * change (412) is retried once with the fresh version.
 */
export function AddToPlaylist({
  refType,
  refId,
}: {
  refType: 'recording' | 'audio_source';
  refId: string;
}) {
  // Loaded on demand: a long Archive would otherwise fetch the list once per row.
  const [lists, setLists] = useState<{ playlist_id: string; title: string }[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!lists) {
    return (
      <button
        type="button"
        onClick={() => {
          void get<{ items: { playlist_id: string; title: string }[] }>('/v1/playlists').then(
            (r) => {
              setLists(r.items);
            },
          );
        }}
      >
        {t('playlists.add.submit')}
      </button>
    );
  }
  if (lists.length === 0) return <span className="small muted">{t('playlists.add.none')}</span>;

  const add = async (playlistId: string, retry = true): Promise<void> => {
    const { etag } = await api('GET', `/v1/playlists/${playlistId}`);
    try {
      await api(
        'POST',
        `/v1/playlists/${playlistId}/items`,
        { ref_type: refType, ref_id: refId },
        { 'if-match': etag ?? '' },
      );
      setMsg(
        t('playlists.add.done', {
          title: lists.find((l) => l.playlist_id === playlistId)?.title ?? '',
        }),
      );
    } catch (e) {
      if (retry && e instanceof ApiError && e.status === 412) return add(playlistId, false);
      setMsg(errorText(e));
    }
  };

  const id = `add-pl-${refId}`;
  return (
    <form
      className="inline"
      aria-label={t('playlists.add.label')}
      onSubmit={(e) => {
        e.preventDefault();
        const select = e.currentTarget.elements.namedItem('playlist') as HTMLSelectElement;
        void add(select.value);
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        {t('playlists.add.choose')}
      </label>
      <select id={id} name="playlist">
        {lists.map((l) => (
          <option key={l.playlist_id} value={l.playlist_id}>
            {l.title}
          </option>
        ))}
      </select>{' '}
      <button type="submit">{t('playlists.add.confirm')}</button>
      {msg ? <span role="status"> {msg}</span> : null}
    </form>
  );
}
