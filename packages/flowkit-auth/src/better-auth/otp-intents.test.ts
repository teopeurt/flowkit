import { expect, it } from 'bun:test';
import { createOtpIntentRegistry } from './otp-intents';
it('denies unknown OTP intents', async () => expect((await createOtpIntentRegistry([]).authorize({ intent: 'unknown', identity: 'x' })).ok).toBe(false));
