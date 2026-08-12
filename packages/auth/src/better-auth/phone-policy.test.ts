import { expect, it } from 'bun:test';
import { createPhonePolicy } from './phone-policy';
it('normalizes using consumer-provided calling code rather than Nigeria defaults', () => { const policy = createPhonePolicy({ callingCode: '44', nationalNumber: /^7\d{9}$/ }); expect(policy.normalize('07123456789')).toBe('+447123456789'); expect(policy.isValid('07123456789')).toBe(true); });
