export type AuthErrorCode =
  | 'unauthenticated' | 'identity_unverified' | 'identity_not_found' | 'identity_collision'
  | 'identity_already_claimed' | 'provisioning_forbidden' | 'role_unknown' | 'scope_required'
  | 'scope_ambiguous' | 'permission_denied' | 'readonly_denied' | 'rate_limited'
  | 'configuration_invalid' | 'store_unavailable';

export class AuthError extends Error {
  readonly name = 'AuthError';
  constructor(readonly code: AuthErrorCode, message: string, readonly details?: Readonly<Record<string, string>>) { super(message); }
}
