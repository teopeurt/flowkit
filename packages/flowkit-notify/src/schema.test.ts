import { describe, expect, it } from 'bun:test';
import { requestSchema, renderedSchema } from './schema.js';

const valid = {
  namespace: 'odc', sourceKey: 'operation-1:binding-0',
  aggregate: { type: 'application', id: 'app-1' }, templateKey: 'reviewed',
  data: { reference: 'ODC-1' }, channels: ['in-app', 'email'],
  selectors: [{ key: 'company-users' }],
};

describe('notification schemas', () => {
  it('accepts a strict request', () => {
    expect(requestSchema.parse(valid)).toEqual(valid);
  });

  it('requires a selector or explicit recipient', () => {
    expect(() => requestSchema.parse({ ...valid, selectors: undefined })).toThrow();
  });

  it('rejects duplicate channels and unknown fields', () => {
    expect(() => requestSchema.parse({ ...valid, channels: ['email', 'email'] })).toThrow();
    expect(() => requestSchema.parse({ ...valid, extra: true })).toThrow();
  });

  it('rejects non-JSON template values and empty rendered content', () => {
    expect(() => requestSchema.parse({ ...valid, data: { bad: new Date() } })).toThrow();
    expect(() => renderedSchema.parse({ subject: '', body: 'body' })).toThrow();
  });
});
