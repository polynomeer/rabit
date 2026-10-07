import { useState } from 'react';
import { api, type EntitySummary } from './api';
import { POPULARITY } from './dig';
import { t, tCode, type MessageKey } from './i18n';
import { usePlayer } from './player';
import { entityHref } from './route';
import { errorText } from './views';

/**
 * Blind Digging (DIG-010): listen without artist, release, year or popularity,
 * decide Keep or Pass, then see what it was. Keep saves to the library.
 */
interface BlindItem {
  item_id: string;
  position: number;
  recording_id: string;
  decision: 'keep' | 'pass' | null;
  reveal: {
    recording: EntitySummary;
    release: { release_id: string; title: string; release_date: string | null } | null;
    popularity_tier: string;
  } | null;
}
interface BlindRound {
  blind_dig_id: string;
  items: BlindItem[];
}

const TIER_TEXT: Record<string, MessageKey> = {
  top: 'blind.tier.top',
  upper: 'blind.tier.upper',
  deep_cut: 'blind.tier.deep_cut',
  obscure: 'blind.tier.obscure',
  unknown: 'blind.tier.unknown',
};

export function BlindDigPanel({ startEntityId }: { startEntityId?: string }) {
  const player = usePlayer();
  const [round, setRound] = useState<BlindRound | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const current = round?.items.find((i) => i.decision === null) ?? null;
  const revealed = round?.items.filter((i) => i.reveal) ?? [];

  const start = (popularity: string) => {
    setMsg(null);
    api<BlindRound>('POST', '/v1/blind-digs', {
      popularity,
      ...(startEntityId ? { start_entity_id: startEntityId } : {}),
    }).then(
      (r) => {
        setRound(r.data);
        if (r.data.items.length === 0) setMsg(t('blind.empty'));
      },
      (e: unknown) => {
        setMsg(errorText(e));
      },
    );
  };

  const decide = (item: BlindItem, decision: 'keep' | 'pass') => {
    if (!round) return;
    api<BlindRound>('POST', `/v1/blind-digs/${round.blind_dig_id}/items/${item.item_id}/decision`, {
      decision,
    }).then(
      (r) => {
        setRound(r.data);
      },
      (e: unknown) => {
        setMsg(errorText(e));
      },
    );
  };

  return (
    <section aria-labelledby="blind-h" className="card">
      <h3 id="blind-h">{t('blind.title')}</h3>
      <p className="small muted">{t('blind.hint')}</p>
      <form
        className="inline"
        aria-label={t('blind.start')}
        onSubmit={(e) => {
          e.preventDefault();
          start((e.currentTarget.elements.namedItem('popularity') as HTMLSelectElement).value);
        }}
      >
        <label htmlFor="blind-popularity">{t('dig.filter.popularity')}</label>
        <select id="blind-popularity" name="popularity" defaultValue="deep_cuts">
          {POPULARITY.map(([v, key]) => (
            <option key={v} value={v}>
              {t(key)}
            </option>
          ))}
        </select>{' '}
        <button type="submit">{round ? t('blind.newRound') : t('blind.start')}</button>
      </form>
      {msg ? <p role="status">{msg}</p> : null}

      {current && round ? (
        <div className="blind-current" aria-label={t('blind.current')} role="group">
          <p>
            <strong>
              {t('blind.trackOf', { n: current.position + 1, total: round.items.length })}
            </strong>{' '}
            <span className="muted">{t('blind.hiddenNote')}</span>
          </p>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                player.play([
                  {
                    key: `blind:${current.item_id}`,
                    title: t('blind.hiddenTitle'),
                    subtitle: null,
                    recording_id: current.recording_id,
                  },
                ]);
              }}
            >
              {t('common.play')}
            </button>
            <button
              type="button"
              onClick={() => {
                decide(current, 'keep');
              }}
            >
              {t('blind.keep')}
            </button>
            <button
              type="button"
              onClick={() => {
                decide(current, 'pass');
              }}
            >
              {t('blind.pass')}
            </button>
          </div>
        </div>
      ) : round && round.items.length > 0 ? (
        <p role="status">{t('blind.done')}</p>
      ) : null}

      {revealed.length > 0 ? (
        <ol className="list" aria-label={t('blind.revealed')}>
          {revealed.map((i) => (
            <li key={i.item_id}>
              <div>
                <span className="badge">
                  {i.decision === 'keep' ? t('blind.kept') : t('blind.passed')}
                </span>{' '}
                <a href={entityHref(i.recording_id)}>{i.reveal?.recording.name}</a>{' '}
                <span className="muted">
                  {i.reveal?.recording.subtitle ?? ''}
                  {i.reveal?.release
                    ? ` · ${i.reveal.release.title}${i.reveal.release.release_date ? ` (${i.reveal.release.release_date.slice(0, 4)})` : ''}`
                    : ''}
                  {` · ${tCode(TIER_TEXT, i.reveal?.popularity_tier ?? 'unknown')}`}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
