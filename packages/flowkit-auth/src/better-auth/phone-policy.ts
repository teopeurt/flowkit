export type PhonePolicy = Readonly<{ normalize(value: string): string; isValid(value: string): boolean }>;
export function createPhonePolicy(input: { callingCode: string; trunkPrefix?: string; nationalNumber: RegExp }): PhonePolicy {
  const callingCode = input.callingCode.replace(/^\+/, '');
  const trunk = input.trunkPrefix ?? '0';
  return Object.freeze({ normalize(value) { let raw = value.replace(/[\s()-]/g, ''); if (raw.startsWith('+')) return `+${raw.slice(1)}`; if (raw.startsWith(trunk)) raw = raw.slice(trunk.length); return `+${callingCode}${raw}`; }, isValid(value) { return input.nationalNumber.test(value.replace(/[\s()-]/g, '').replace(new RegExp(`^\\+${callingCode}`), '').replace(new RegExp(`^${trunk}`), '')); } });
}
export function createCustomPhonePolicy(normalize: (value: string) => string, isValid: (value: string) => boolean): PhonePolicy { return Object.freeze({ normalize, isValid }); }
