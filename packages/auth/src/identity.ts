import type { IdentityProof } from './contracts';

export function verifiedProofs(input: { email?: { value: string; verified: boolean }; phone?: { value: string; verified: boolean } }, normalizePhone?: (value: string) => string): readonly IdentityProof[] {
  const proofs: IdentityProof[] = [];
  if (input.email?.verified) proofs.push({ kind: 'email', normalizedValue: input.email.value.trim().toLowerCase(), verified: true });
  if (input.phone?.verified) proofs.push({ kind: 'phone', normalizedValue: normalizePhone ? normalizePhone(input.phone.value) : input.phone.value.trim(), verified: true });
  return Object.freeze(proofs);
}
