/**
 * Builds the Content-Security-Policy header from infra/web/csp.json, the policy
 * CloudFront sends in production (infra/aws/edge.tf). Used by `vite preview` in
 * the E2E stack, so the browser tests run under the production policy.
 */
import { readFileSync } from 'node:fs';

export interface CspOrigins {
  api: string;
  media: string;
  oidc: string;
  upload: string;
}

export function contentSecurityPolicy(origins: CspOrigins): string {
  const policy = JSON.parse(
    readFileSync(new URL('../../infra/web/csp.json', import.meta.url), 'utf8'),
  ) as Record<string, string[] | string>;
  return Object.entries(policy)
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
    .map(([directive, sources]) => {
      // A placeholder may stand for several space-separated origins (e.g. a login
      // provider's discovery host and its hosted sign-in domains).
      const values = sources.flatMap((s) => {
        const m = /^\{(\w+)\}$/.exec(s);
        if (!m) return [s];
        return origins[m[1] as keyof CspOrigins]
          .split(/\s+/)
          .filter(Boolean)
          .map((o) => new URL(o).origin);
      });
      return `${directive} ${[...new Set(values)].join(' ')}`;
    })
    .join('; ');
}
