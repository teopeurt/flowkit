import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function hashInvitationToken(rawToken: string): string { return `sha256:${bytesToHex(sha256(utf8ToBytes(rawToken)))}`; }
export function hashContact(input: { key: string; normalized: string }): string { return `hmac-sha256:${bytesToHex(sha256(utf8ToBytes(`${input.key}:${input.normalized}`)))}`; }
export function requireTokenEntropy(rawToken: string, minimumBytes = 32): void { if (rawToken.length < minimumBytes * 2) throw new Error(`invitation token must contain at least ${minimumBytes} bytes`); }
