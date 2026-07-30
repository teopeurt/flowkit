import type { AuthError } from './errors';

export type IdentityProof = { readonly kind: 'email' | 'phone'; readonly normalizedValue: string; readonly verified: true };
export type AuthSession = { readonly id: string; readonly authUserId: string; readonly issuedAt?: string; readonly expiresAt: string; readonly activeScope?: ActiveScope };
export type ActiveScope = { readonly type: string; readonly id: string; readonly membershipId?: string };
export type Membership = { readonly id: string; readonly scope: ActiveScope; readonly role: string; readonly eligible: boolean };
export type DomainSubject = { readonly subjectId: string; readonly authUserId?: string; readonly role?: string };
export type ProvisioningDecision = { readonly role: string; readonly invitationAuthorized?: boolean };
export type RoleStore = { list(): Promise<readonly RoleRecord[]>; findByKey(input: { key: string }): Promise<RoleRecord | undefined>; upsert(input: RoleUpsert): Promise<RoleRecord> };
export type RoleRecord = { readonly id: string; readonly key: string; readonly label: string; readonly description?: string; readonly permissions: readonly string[]; readonly scopes: readonly string[]; readonly readOnly: boolean };
export type RoleUpsert = Omit<RoleRecord, 'id'>;
export type IdentityLink = { readonly subjectId: string; readonly authUserId?: string; readonly proofs: readonly IdentityProof[] };
export type IdentityLinkStore = {
  findByAuthUser(input: { authUserId: string }): Promise<IdentityLink | undefined>;
  findByProof(input: { proof: IdentityProof }): Promise<IdentityLink | undefined>;
  createSubject(input: { authUserId: string; proofs: readonly IdentityProof[] }): Promise<IdentityLink>;
  claimSubject(input: { subjectId: string; authUserId: string }): Promise<boolean>;
};
export type MembershipResolver = { list(input: { subjectId: string }): Promise<readonly Membership[]> };
export type AuthAuditEvent = { readonly type: string; readonly outcome: string; readonly role?: string; readonly scopeType?: string };
export type AuthAuditSink = { emit(event: AuthAuditEvent): Promise<void> | void };
export type AuthClock = { now(): Date };
export type AuthLogger = { debug(message: string, fields?: Readonly<Record<string, string>>): void; warn(message: string, fields?: Readonly<Record<string, string>>): void };
export type OtpSender = { send(input: { identity: string; code: string; intent: string }): Promise<void> };
export type IdentityRateLimiter = { check(input: { identity: string; intent: string }): Promise<{ allowed: boolean; retryAfterSeconds?: number }>; record(input: { identity: string; intent: string; outcome: 'success' | 'failure' }): Promise<void> };
export type AuthResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthError };
