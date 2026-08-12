import { z } from 'zod';
import type { JsonValue, NotificationTemplateDefinition, RenderedNotification, ResolvedNotificationRecipient } from './contracts.js';
import { renderedSchema } from './schema.js';

export class UnknownNotificationTemplateError extends Error {}
export class InvalidNotificationTemplateError extends Error {}

export interface TemplateRegistry {
  has(key: string): boolean;
  keys(): string[];
  validate(key: string, data: JsonValue): JsonValue;
  render(key: string, data: JsonValue, recipient: ResolvedNotificationRecipient): RenderedNotification;
}

export function createTemplateRegistry(definitions: NotificationTemplateDefinition[]): TemplateRegistry {
  const map = new Map<string, NotificationTemplateDefinition>();
  for (const definition of definitions) {
    if (map.has(definition.key)) throw new Error(`duplicate notification template: ${definition.key}`);
    map.set(definition.key, definition);
  }
  return Object.freeze({
    has: (key: string) => map.has(key),
    keys: () => [...map.keys()],
    validate: (key: string, data: JsonValue) => {
      const definition = map.get(key);
      if (!definition) throw new UnknownNotificationTemplateError(key);
      const result = definition.input.safeParse(data);
      if (!result.success) throw new InvalidNotificationTemplateError(result.error.message);
      return result.data;
    },
    render: (key: string, data: JsonValue, recipient: ResolvedNotificationRecipient) => {
      const definition = map.get(key);
      if (!definition) throw new UnknownNotificationTemplateError(key);
      const validated = definition.input.safeParse(data);
      if (!validated.success) throw new InvalidNotificationTemplateError(validated.error.message);
      const rendered = definition.render(validated.data, recipient);
      const result = renderedSchema.safeParse(rendered);
      if (!result.success) throw new InvalidNotificationTemplateError(result.error.message);
      return Object.freeze(result.data);
    },
  });
}

export function template<T extends JsonValue>(key: string, input: z.ZodType<T>, render: NotificationTemplateDefinition<T>['render']): NotificationTemplateDefinition<T> {
  return { key, input, render };
}
