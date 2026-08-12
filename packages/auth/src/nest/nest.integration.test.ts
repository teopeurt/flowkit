import { expect, it } from 'bun:test';
import { leaveApprovalFixture } from '../testing';
it('ships an unrelated fixture with canonical role and permission policy', () => { expect(leaveApprovalFixture.hasPermission('approver', 'leave:approve')).toBe(true); expect(leaveApprovalFixture.hasPermission('employee', 'leave:approve')).toBe(false); });
