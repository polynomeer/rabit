import { useEffect, useState } from 'react';

/**
 * Hash routes, so every screen has a shareable link and the browser's back
 * button works without a server-side router:
 *   #/archive  #/playlists  #/search  #/search/<query>  #/account
 *   #/dig  #/dig/<entity id> (starts a session)  #/dig-session/<session id>
 *   #/recording/<id>  #/release/<id>  #/entity/<id>
 */
export const TABS = ['Archive', 'Playlists', 'Search', 'DIG', 'Account'] as const;
export type Tab = (typeof TABS)[number];

export type Route =
  | { kind: 'tab'; tab: Tab; digStart: string | null; query: string }
  | { kind: 'recording' | 'release' | 'entity' | 'dig-session'; id: string };

const ID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;

export function parseHash(hash: string): Route {
  const [, first = '', second = ''] = hash.replace(/^#/, '').split('/');
  if (
    (first === 'recording' ||
      first === 'release' ||
      first === 'entity' ||
      first === 'dig-session') &&
    ID.test(second)
  )
    return { kind: first, id: second };
  const tab = TABS.find((t) => t.toLowerCase() === first.toLowerCase()) ?? 'Archive';
  let query = '';
  if (tab === 'Search') {
    try {
      query = decodeURIComponent(second);
    } catch {
      query = '';
    }
  }
  return { kind: 'tab', tab, digStart: tab === 'DIG' && ID.test(second) ? second : null, query };
}

export const tabHref = (tab: Tab) => `#/${tab.toLowerCase()}`;
export const digHref = (entityId: string) => `#/dig/${entityId}`;
export const searchHref = (q: string) => `#/search/${encodeURIComponent(q)}`;

/** The detail page for any catalog id: recordings and releases have their own pages. */
export function entityHref(id: string): string {
  if (id.startsWith('rec_')) return `#/recording/${id}`;
  if (id.startsWith('rel_')) return `#/release/${id}`;
  return `#/entity/${id}`;
}

export const digSessionHref = (sessionId: string) => `#/dig-session/${sessionId}`;

/** Replaces the current history entry (no extra Back step), e.g. start → its session. */
export function replaceRoute(href: string): void {
  history.replaceState(null, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function navigate(href: string): void {
  window.location.hash = href.replace(/^#/, '');
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}
