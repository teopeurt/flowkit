import { defineRoleRegistry } from '../roles';
export const leaveApprovalFixture = defineRoleRegistry({ employee: { label: 'Employee', permissions: ['leave:read'], scopes: ['company'], kind: 'external', provisioning: 'self_service' }, approver: { label: 'Approver', permissions: ['leave:read', 'leave:approve'], scopes: ['company'], kind: 'internal', provisioning: 'invite_only' } } as const);
