export const testingContractVersion = '1.1.0';
export function createTestClock(initial = new Date('2026-01-01T00:00:00.000Z')) { let current = new Date(initial); return { now: () => new Date(current), advance: (milliseconds: number) => { current = new Date(current.getTime() + milliseconds); } }; }
