import { errors } from '../errors.js';
import type { Id } from '../ids.js';

/** The authenticated caller. Derived only from a verified token + server state. */
export interface Principal {
  userId: Id<'user'>;
  personalWorkspaceId: Id<'workspace'>;
  status: 'active' | 'deletion_requested';
  isOperator: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/** Returns the principal or throws 401. */
export function requirePrincipal(p: Principal | null): Principal {
  if (!p) throw errors.unauthenticated();
  return p;
}

/** Operator endpoints: role claim + MFA are checked when the principal is resolved. */
export function requireOperator(p: Principal | null): Principal {
  const principal = requirePrincipal(p);
  if (!principal.isOperator) throw errors.forbidden('Operator role with MFA is required.');
  return principal;
}
