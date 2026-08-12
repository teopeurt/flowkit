import type { NotificationChannel, NotificationRequest, NotificationSkip, RecipientResolver, ResolvedNotificationRecipient } from './contracts.js';
import { recipientSchema } from './schema.js';

export interface NormalizedRecipients { recipients: ResolvedNotificationRecipient[]; skips: NotificationSkip[]; }

export async function resolveRecipients(request: NotificationRequest, resolver?: RecipientResolver): Promise<NormalizedRecipients> {
  const recipients = request.explicitRecipients ?? (resolver ? await resolver.resolve(request) : []);
  const skips: NotificationSkip[] = [];
  const unique = new Map<string, ResolvedNotificationRecipient>();
  for (const candidate of recipients) {
    const parsed = recipientSchema.safeParse(candidate);
    if (!parsed.success) { skips.push({ reason: 'invalid_recipient' }); continue; }
    const existing = unique.get(parsed.data.key);
    if (!existing) {
      const routes = parsed.data.routes.filter((route, index, all) => all.findIndex((item) => item.channel === route.channel && item.canonicalKey === route.canonicalKey) === index);
      unique.set(parsed.data.key, { ...parsed.data, routes });
    }
    else {
      const routes = [...existing.routes, ...parsed.data.routes].filter((route, index, all) => all.findIndex((item) => item.channel === route.channel && item.canonicalKey === route.canonicalKey) === index);
      unique.set(parsed.data.key, { ...existing, routes });
    }
  }
  if (request.selectors?.length && recipients.length === 0) for (const selector of request.selectors) skips.push({ reason: 'unknown_selector', selectorKey: selector.key });
  return { recipients: [...unique.values()], skips };
}

export function selectRoutes(recipient: ResolvedNotificationRecipient, channels: NotificationChannel[]): { routes: ResolvedNotificationRecipient['routes']; skips: NotificationSkip[] } {
  const skips: NotificationSkip[] = [];
  const routes = channels.flatMap((channel) => {
    const matches = recipient.routes.filter((route) => route.channel === channel);
    if (matches.length === 0) skips.push({ reason: 'missing_route', recipientKey: recipient.key, channel });
    return matches.filter((route) => {
      if (route.enabled === false) { skips.push({ reason: 'disabled_channel', recipientKey: recipient.key, channel }); return false; }
      return true;
    });
  });
  return { routes, skips };
}
