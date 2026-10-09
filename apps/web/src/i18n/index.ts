import { ko } from './ko';

/** Every user-visible string has a key here; a missing or misspelt key fails the typecheck. */
export type MessageKey = keyof typeof ko;

/**
 * The client's only locale. Adding a language means adding a catalog with the same
 * keys (typed against `MessageKey`) and choosing the locale; which languages to
 * support is still open (Q01).
 */
export const locale = 'ko';

const messages: Readonly<Record<MessageKey, string>> = ko;

/** Looks up a message and fills its `{name}` placeholders; unknown names are left as is. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = messages[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : String(v);
  });
}

/** Labels a server code through a code → message key table; unknown codes show as is. */
export function tCode(keys: Readonly<Record<string, MessageKey>>, code: string): string {
  const key: MessageKey | undefined = keys[code];
  return key ? t(key) : code;
}

/** A calendar date in the client's locale. */
export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(locale);
}

/** A month and year in the client's locale, e.g. "2026년 10월". */
export function formatMonth(value: string | Date): string {
  return new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'long' });
}

/** A date and time in the client's locale. */
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(locale);
}
