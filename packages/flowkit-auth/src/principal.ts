import type { ActiveScope, AuthSession, IdentityProof } from './contracts';

export type AuthenticatedPrincipal<RoleKey extends string = string> = Readonly<{
  authUserId: string; subjectId: string; role: RoleKey; permissions: readonly string[]; readOnly: boolean;
  identityProofs: readonly IdentityProof[]; activeScope?: ActiveScope; session: Pick<AuthSession, 'id' | 'issuedAt' | 'expiresAt'>;
}>;

export function freezePrincipal<R extends string>(principal: AuthenticatedPrincipal<R>): AuthenticatedPrincipal<R> {
  return Object.freeze({ ...principal, permissions: Object.freeze([...principal.permissions]), identityProofs: Object.freeze([...principal.identityProofs]), session: Object.freeze({ ...principal.session }), activeScope: principal.activeScope && Object.freeze({ ...principal.activeScope }) });
}
