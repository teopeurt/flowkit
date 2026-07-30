import type { NotificationChannel, NotificationChannelAdapter, RetryPolicy } from './contracts.js';

export interface RegisteredAdapter extends NotificationChannelAdapter { retryPolicy: RetryPolicy; enabled: boolean; }
export class NotificationAdapterRegistry {
  private readonly entries = new Map<NotificationChannel, RegisteredAdapter>();
  private frozen = false;
  register(adapter: RegisteredAdapter): void {
    if (this.frozen) throw new Error('adapter registry is frozen');
    if (this.entries.has(adapter.channel)) throw new Error(`duplicate notification adapter: ${adapter.channel}`);
    this.entries.set(adapter.channel, Object.freeze({ ...adapter }));
  }
  freeze(): void { this.frozen = true; }
  get(channel: string): RegisteredAdapter | undefined { return this.entries.get(channel); }
  values(): RegisteredAdapter[] { return [...this.entries.values()]; }
}
