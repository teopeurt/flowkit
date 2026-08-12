import type { FlowTask, FlowTaskStatus, TaskEvent, TaskInboxPage, TaskInboxQuery, TaskInvitation, TaskProjectionPlan, TaskReference, TaskStore } from '../contracts.js';

const now = () => new Date().toISOString();
const keyOf = (ref: TaskReference) => [ref.namespace, ref.flowId, ref.subjectType, ref.subjectId, ref.stage, ref.role].join('|');
export class MemoryTaskStore implements TaskStore {
  readonly tasks = new Map<string, FlowTask>();
  readonly events: TaskEvent[] = [];
  readonly invitations = new Map<string, TaskInvitation>();
  private readonly operationResults = new Map<string, { tasks: FlowTask[]; events: TaskEvent[] }>();
  private id = 0;
  private eventId = 0;
  private invitationId = 0;
  restore(snapshot: { tasks: FlowTask[]; events: TaskEvent[]; invitations?: TaskInvitation[] }) {
    this.tasks.clear(); this.events.length = 0; this.invitations.clear();
    for (const task of snapshot.tasks) this.tasks.set(task.id, task);
    this.events.push(...snapshot.events);
    for (const invitation of snapshot.invitations ?? []) this.invitations.set(invitation.id, invitation);
    this.id = Math.max(0, ...snapshot.tasks.map((task) => Number(task.id.replace(/^task-/, '')) || 0));
    this.eventId = Math.max(0, ...snapshot.events.map((event) => Number(event.id.replace(/^event-/, '')) || 0));
    this.invitationId = Math.max(0, ...(snapshot.invitations ?? []).map((invitation) => Number(invitation.id.replace(/^invitation-/, '')) || 0));
  }
  async get(taskId: string) { return this.tasks.get(taskId) ?? null; }
  async find(reference: TaskReference) { return [...this.tasks.values()].find((task) => keyOf(task) === keyOf(reference)) ?? null; }
  async applyProjection(input: { plan: TaskProjectionPlan; operationId: string }) {
    const prior = this.operationResults.get(input.operationId);
    if (prior) return { created: false, tasks: prior.tasks, events: prior.events };
    const changed: FlowTask[] = []; const createdEvents: TaskEvent[] = [];
    for (const mutation of input.plan.mutations) {
      const ref = mutation.reference;
      let task = [...this.tasks.values()].find((candidate) => keyOf(candidate) === keyOf(ref));
      const timestamp = now();
      if (!task) {
        task = { ...ref, id: `task-${++this.id}`, status: 'open', assigneeId: null, revision: 0, lifecycleEpoch: mutation.lifecycleEpoch, dueAt: mutation.dueAt ?? null, claimedAt: null, completedAt: null, openedOperationId: mutation.operationId, metadata: mutation.metadata, createdAt: timestamp, updatedAt: timestamp };
        this.tasks.set(task.id, task);
      } else {
        const nextStatus: FlowTaskStatus = mutation.kind === 'complete' || mutation.kind === 'close' ? 'completed' : mutation.kind === 'reopen' || mutation.kind === 'open' ? 'open' : task.status;
        task = { ...task, status: nextStatus, assigneeId: nextStatus === 'open' ? null : task.assigneeId, claimedAt: nextStatus === 'open' ? null : task.claimedAt, completedAt: nextStatus === 'completed' ? timestamp : task.completedAt, revision: task.revision + 1, lifecycleEpoch: mutation.lifecycleEpoch, dueAt: mutation.dueAt ?? task.dueAt, openedOperationId: mutation.operationId, updatedAt: timestamp };
        this.tasks.set(task.id, task);
      }
      changed.push(task);
    }
    for (const planned of input.plan.events) {
      const task = changed.find((candidate) => candidate.lifecycleEpoch === planned.lifecycleEpoch) ?? changed[0];
      if (!task) continue;
      const event: TaskEvent = { id: `event-${++this.eventId}`, taskId: task.id, sequence: this.events.filter((candidate) => candidate.taskId === task.id).length + 1, transitionSequence: planned.transitionSequence, operationId: planned.operationId, eventType: planned.eventType, previousStatus: null, nextStatus: task.status, previousAssigneeId: null, nextAssigneeId: task.assigneeId, actorId: planned.actorId, reason: null, action: planned.action, lifecycleEpoch: planned.lifecycleEpoch, metadata: planned.metadata, createdAt: now() };
      this.events.push(event); createdEvents.push(event);
    }
    this.operationResults.set(input.operationId, { tasks: changed, events: createdEvents });
    return { created: true, tasks: changed, events: createdEvents };
  }
  async claim(command: import('../contracts.js').TaskClaimCommand) {
    const task = this.tasks.get(command.taskId);
    if (!task) return { task: null, reason: 'not_found' as const };
    if (task.status !== 'open' || task.assigneeId !== null) return { task: null, reason: 'not_claimable' as const };
    if (task.revision !== command.expectedRevision) return { task: null, reason: 'conflict' as const };
    const updated = { ...task, status: 'claimed' as const, assigneeId: command.actorId, revision: task.revision + 1, claimedAt: command.now, updatedAt: command.now };
    this.tasks.set(task.id, updated); this.appendEvent(updated, 'claimed', command.operationId, command.actorId, null); return { task: updated };
  }
  async release(command: import('../contracts.js').TaskReleaseCommand) {
    const task = this.tasks.get(command.taskId);
    if (!task) return { task: null, reason: 'not_found' as const };
    if (task.revision !== command.expectedRevision) return { task: null, reason: 'conflict' as const };
    if (task.assigneeId !== command.actorId) return { task: null, reason: 'not_owned' as const };
    const updated = { ...task, status: 'open' as const, assigneeId: null, claimedAt: null, revision: task.revision + 1, updatedAt: command.now };
    this.tasks.set(task.id, updated); this.appendEvent(updated, 'released', command.operationId, command.actorId, command.reason); return { task: updated };
  }
  async reassign(command: import('../contracts.js').TaskReassignCommand) {
    const task = this.tasks.get(command.taskId);
    if (!task) return { task: null, reason: 'not_found' as const };
    if (task.revision !== command.expectedRevision) return { task: null, reason: 'conflict' as const };
    const updated = { ...task, status: 'claimed' as const, assigneeId: command.targetActorId, claimedAt: command.now, revision: task.revision + 1, updatedAt: command.now };
    this.tasks.set(task.id, updated); this.appendEvent(updated, 'reassigned', command.operationId, command.actorId, command.reason); return { task: updated };
  }
  async history(taskId: string) { return this.events.filter((event) => event.taskId === taskId); }
  async inbox(query: TaskInboxQuery): Promise<TaskInboxPage> {
    let items = [...this.tasks.values()];
    if (query.view === 'my_claims') items = items.filter((task) => task.assigneeId === query.actorId);
    if (query.view === 'role_queue') items = items.filter((task) => task.status === 'open' && (!query.roles?.length || query.roles.includes(task.role)));
    if (query.statuses?.length) items = items.filter((task) => query.statuses!.includes(task.status));
    if (query.stage) items = items.filter((task) => task.stage === query.stage);
    if (query.subjectId) items = items.filter((task) => task.subjectId === query.subjectId);
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { items: items.slice(0, query.limit ?? 50), nextCursor: null };
  }
  async latestMakerCompletion(input: { subjectType: string; subjectId: string; makerStage: string; beforeEpoch: number }) {
    return [...this.events].reverse().find((event) => event.eventType === 'completed' && event.actorId && event.lifecycleEpoch <= input.beforeEpoch && this.tasks.get(event.taskId)?.subjectType === input.subjectType && this.tasks.get(event.taskId)?.subjectId === input.subjectId && this.tasks.get(event.taskId)?.stage === input.makerStage) ?? null;
  }
  async createInvitation(input: Omit<TaskInvitation, 'id' | 'status' | 'acceptedIdentityId' | 'acceptedAt'>) {
    const invitation: TaskInvitation = { ...input, id: `invitation-${++this.invitationId}`, status: 'pending', acceptedIdentityId: null, acceptedAt: null };
    this.invitations.set(invitation.id, invitation); return invitation;
  }
  async getInvitationByTokenHash(tokenHash: string) { return [...this.invitations.values()].find((invitation) => invitation.tokenHash === tokenHash) ?? null; }
  async redeemInvitation(input: { invitationId: string; identityId: string; expectedExpiry: string; now: string; operationId: string }) {
    const invitation = this.invitations.get(input.invitationId);
    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= input.now || invitation.expiresAt !== input.expectedExpiry) return null;
    const updatedInvitation = { ...invitation, status: 'accepted' as const, acceptedIdentityId: input.identityId, acceptedAt: input.now };
    this.invitations.set(invitation.id, updatedInvitation);
    const task = this.tasks.get(invitation.taskId); if (!task) return null;
    const updatedTask = { ...task, status: 'claimed' as const, assigneeId: input.identityId, claimedAt: input.now, revision: task.revision + 1, updatedAt: input.now };
    this.tasks.set(task.id, updatedTask); this.appendEvent(updatedTask, 'invitation_accepted', input.operationId, input.identityId, null);
    return { invitation: updatedInvitation, task: updatedTask };
  }
  async revokeInvitation(input: { invitationId: string; now: string; operationId: string }) { const invitation = this.invitations.get(input.invitationId); if (invitation) this.invitations.set(invitation.id, { ...invitation, status: 'revoked' }); }
  private appendEvent(task: FlowTask, eventType: TaskEvent['eventType'], operationId: string, actorId: string | null, reason: string | null) { this.events.push({ id: `event-${++this.eventId}`, taskId: task.id, sequence: this.events.filter((event) => event.taskId === task.id).length + 1, transitionSequence: null, operationId, eventType, previousStatus: null, nextStatus: task.status, previousAssigneeId: null, nextAssigneeId: task.assigneeId, actorId, reason, action: null, lifecycleEpoch: task.lifecycleEpoch, metadata: {}, createdAt: now() }); }
}
