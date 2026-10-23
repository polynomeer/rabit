import { sql, type Kysely } from 'kysely';

/* eslint-disable @typescript-eslint/no-explicit-any -- migrations target the raw schema */

/**
 * Korean search (commercial quality plan CQ-SRC-1):
 * - `rabit_initials(text)`: each Hangul syllable becomes its initial consonant (뉴진스 →
 *   ㄴㅈㅅ), letters and digits are lowercased, everything else is dropped. Both the
 *   indexer and the query use it, so they cannot disagree.
 * - `search_document.initials`, backfilled, with a trigram index for substring search.
 * - `music_entity.aliases`: other names of an artist, person or label (a Korean name and
 *   its romanization, a former name), searchable like the name.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    CREATE FUNCTION rabit_initials(s text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT coalesce(string_agg(
        CASE
          WHEN ascii(c) BETWEEN 44032 AND 55203
            THEN substr('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', (ascii(c) - 44032) / 588 + 1, 1)
          WHEN c ~ '^[[:alnum:]]$' THEN lower(c)
          ELSE ''
        END, '' ORDER BY i), '')
      FROM regexp_split_to_table(normalize(s, NFC), '') WITH ORDINALITY AS t(c, i)
    $$;
    ALTER TABLE search_document ADD COLUMN initials text NOT NULL DEFAULT '';
    UPDATE search_document SET initials = rabit_initials(title || ' ' || coalesce(subtitle, ''));
    CREATE INDEX search_document_initials ON search_document USING gin (initials gin_trgm_ops);
    ALTER TABLE music_entity ADD COLUMN aliases text[] NOT NULL DEFAULT '{}';
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE music_entity DROP COLUMN aliases;
    DROP INDEX search_document_initials;
    ALTER TABLE search_document DROP COLUMN initials;
    DROP FUNCTION rabit_initials(text);
  `,
    )
    .execute(db);
}
