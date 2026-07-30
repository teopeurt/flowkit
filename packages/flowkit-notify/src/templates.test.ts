import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createTemplateRegistry, template } from './templates.js';

describe('template registry', () => {
  const recipient = { key: 'r1', routes: [{ channel: 'email', canonicalKey: 'r1', address: 'redacted@example.test' }] };
  it('validates and renders immutable templates', () => {
    const registry = createTemplateRegistry([template('reviewed', z.object({ reference: z.string() }).strict(), (data) => ({ subject: data.reference, body: 'reviewed' }))]);
    expect(registry.render('reviewed', { reference: 'ODC-1' }, recipient).subject).toBe('ODC-1');
    expect(() => registry.render('missing', {}, recipient)).toThrow();
    expect(() => registry.render('reviewed', { extra: true }, recipient)).toThrow();
  });
  it('rejects duplicate keys and invalid output', () => {
    expect(() => createTemplateRegistry([
      template('same', z.any(), () => ({ subject: 'a', body: 'b' })),
      template('same', z.any(), () => ({ subject: 'a', body: 'b' })),
    ])).toThrow();
    const registry = createTemplateRegistry([template('bad', z.any(), () => ({ subject: '', body: '' }))]);
    expect(() => registry.render('bad', {}, recipient)).toThrow();
  });
});
