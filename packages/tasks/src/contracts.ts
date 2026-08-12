import type { FlowDefinition, FlowState } from '@flowkit/core';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type FlowTaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled';
export type TaskEventType = 'opened' | 'claimed' | 'released' | 'reassigned' | 'completed' | 'reopened' | 'cancelled' | 'invited' | 'invitation_accepted';
export type TaskSort = 'created_at' | 'updated_at' | 'due_at' | 'stage';

export interface TaskReference {
  namespace: string;
  flowId: string;
  subjectType: string;
  subjectId: string;
  stage: string;
  role: string;
}

export interface FlowTask extends TaskReference {
  id: string;
  status: FlowTaskStatus;
  assigneeId: string | null;
  revision: number;
  lifecycleEpoch: number;
  dueAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  openedOperationId: string;
  metadata: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  sequence: number;
  transitionSequence: number | null;
  operationId: string;
  eventType: TaskEventType;
  previousStatus: FlowTaskStatus | null;
  nextStatus: FlowTaskStatus;
  previousAssigneeId: string | null;
  nextAssigneeId: string | null;
  actorId: string | null;
  reason: string | null;
  action: string | null;
  lifecycleEpoch: number;
  metadata: Record<string, JsonValue>;
  createdAt: string;
}

export interface TaskProjectionInput {
  namespace: string;
  flowId: string;
  subject: { type: string; id: string };
  definition: FlowDefinition;
  operationId: string;
  transitionSequence: number;
  action: string;
  actorId: string | null;
  previousState: FlowState;
  nextState: FlowState;
  dueAt?: string | null;
  metadata?: Record<string, JsonValue>;
}

export interface TaskMutation {
  kind: 'complete' | 'open' | 'reopen' | 'close';
  reference: TaskReference;
  operationId: string;
  transitionSequence: number;
  actorId: string | null;
  action: string;
  lifecycleEpoch: number;
  dueAt?: string | null;
  metadata: Record<string, JsonValue>;
}

export interface TaskProjectionPlan {
  operationId: string;
  mutations: TaskMutation[];
  events: Array<Pick<TaskEvent, 'eventType' | 'operationId' | 'transitionSequence' | 'actorId' | 'action' | 'lifecycleEpoch' | 'metadata'>>;
}

export interface TaskProjectionResult {
  created: boolean;
  tasks: FlowTask[];
  events: TaskEvent[];
}

export interface TaskClaimCommand { taskId: string; expectedRevision: number; actorId: string; operationId: string; now: string; }
export interface TaskReleaseCommand { taskId: string; expectedRevision: number; actorId: string; operationId: string; reason: string; now: string; }
export interface TaskReassignCommand { taskId: string; expectedRevision: number; actorId: string; targetActorId: string; operationId: string; reason: string; now: string; }

export interface TaskInboxQuery {
  view: 'my_claims' | 'role_queue' | 'all';
  actorId?: string;
  roles?: string[];
  statuses?: FlowTaskStatus[];
  stage?: string;
  dueBefore?: string;
  dueAfter?: string;
  subjectId?: string;
  sort?: TaskSort;
  direction?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
}
export interface TaskInboxPage { items: FlowTask[]; nextCursor: string | null; }

export interface TaskEligibilityResolver {
  canWorkRole(input: { actorId: string; role: string; task: FlowTask }): Promise<boolean>;
  canAdminister?(input: { actorId: string; task: FlowTask }): Promise<boolean>;
}

export interface TaskClock { now(): string; }
export interface TaskLogger { info(message: string, metadata?: Record<string, JsonValue>): void; warn(message: string, metadata?: Record<string, JsonValue>): void; }

export interface TaskInvitation {
  id: string;
  taskId: string;
  subjectType: string;
  subjectId: string;
  role: string;
  contactKind: 'email' | 'phone';
  contactHash: string;
  contactHashKeyVersion: string;
  tokenHash: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  sourceKey: string;
  acceptedIdentityId: string | null;
  acceptedAt: string | null;
  metadata: Record<string, JsonValue>;
}

export interface TaskIdentityGateway {
  normalizeContact(input: { kind: 'email' | 'phone'; value: string }): string;
  hashContact(input: { kind: 'email' | 'phone'; normalized: string }): string;
  verify(input: { kind: 'email' | 'phone'; contactHash: string }): Promise<{ identityId: string; contactHash: string }>;
}

export interface TaskInvitationNotifier { notify(input: { invitation: TaskInvitation; rawToken: string; sourceKey: string }): Promise<void>; }

export interface TaskStore {
  get(taskId: string): Promise<FlowTask | null>;
  find(reference: TaskReference): Promise<FlowTask | null>;
  applyProjection(input: { plan: TaskProjectionPlan; operationId: string }): Promise<TaskProjectionResult>;
  claim(command: TaskClaimCommand): Promise<{ task: FlowTask | null; reason?: 'not_found' | 'conflict' | 'not_claimable' }>;
  release(command: TaskReleaseCommand): Promise<{ task: FlowTask | null; reason?: 'not_found' | 'conflict' | 'not_owned' }>;
  reassign(command: TaskReassignCommand): Promise<{ task: FlowTask | null; reason?: 'not_found' | 'conflict' | 'not_authorized' }>;
  history(taskId: string): Promise<TaskEvent[]>;
  inbox(query: TaskInboxQuery): Promise<TaskInboxPage>;
  latestMakerCompletion(input: { subjectType: string; subjectId: string; makerStage: string; beforeEpoch: number }): Promise<TaskEvent | null>;
  createInvitation(input: Omit<TaskInvitation, 'id' | 'status' | 'acceptedIdentityId' | 'acceptedAt'>): Promise<TaskInvitation>;
  getInvitationByTokenHash(tokenHash: string): Promise<TaskInvitation | null>;
  redeemInvitation(input: { invitationId: string; identityId: string; expectedExpiry: string; now: string; operationId: string }): Promise<{ invitation: TaskInvitation; task: FlowTask } | null>;
  revokeInvitation(input: { invitationId: string; now: string; operationId: string }): Promise<void>;
}
