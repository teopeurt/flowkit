import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { JsonValue, NotificationDeliveryEnvelope, NotificationRequest } from './contracts.js';

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function canonicalJson(value: JsonValue): string { return canonical(value); }
export function fingerprint(value: JsonValue): string { return `sha256:${bytesToHex(sha256(utf8ToBytes(canonical(value))))}`; }
export function requestFingerprint(request: NotificationRequest): string {
  return fingerprint(request as unknown as JsonValue);
}
export function payloadFingerprint(envelope: Pick<NotificationDeliveryEnvelope, 'rendered' | 'recipient' | 'channel'>): string {
  return fingerprint({ rendered: envelope.rendered as unknown as JsonValue, recipient: envelope.recipient as unknown as JsonValue, channel: envelope.channel });
}
export function deliveryDedupeKey(input: Pick<NotificationDeliveryEnvelope, 'namespace' | 'sourceKey' | 'templateKey' | 'channel'> & { recipientCanonicalKey: string }): string {
  return fingerprint({ namespace: input.namespace, sourceKey: input.sourceKey, templateKey: input.templateKey, channel: input.channel, recipient: input.recipientCanonicalKey });
}
export function attemptId(dedupeKey: string, attempt: number): string {
  return `${dedupeKey.replace(/:/g, '')}-${attempt}`;
}
