/**
 * Colour theme preference (ADR-0022): follow the OS, or force dark or light. Kept per
 * device in localStorage — there is no account setting for it — and applied as
 * `<html data-theme>`, which the stylesheet lets win over the OS setting.
 */
export const THEMES = ['system', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

const KEY = 'rabit.theme';

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.find((t) => t === v) ?? 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked (private mode): the choice still applies until reload.
  }
  applyTheme(theme);
}
