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
      const values = sources.map((s) =>
        s.replace(
          /^\{(\w+)\}$/,
          (_, name: string) => new URL(origins[name as keyof CspOrigins]).origin,
        ),
      );
      return `${directive} ${[...new Set(values)].join(' ')}`;
    })
    .join('; ');
}
