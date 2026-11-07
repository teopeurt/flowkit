export const FLOWKIT_CONSUMER_VERSION = '1.2.0';

export { createFlowkitConsumer } from './consumer.js';
export type {
  ConsumerDependencies,
  DefinitionHash,
  FlowkitActorRef,
  FlowkitActorResolver,
  FlowkitConsumer,
  FlowkitConsumerAction,
  FlowkitConsumerClaim,
  FlowkitConsumerClock,
  FlowkitConsumerStart,
  FlowkitConsumerView,
  FlowkitConsumerViews,
  FlowkitStateView,
  FlowkitStepResult,
  FlowkitSubject,
  FlowRuntime,
  PublishedFlowDefinition,
} from './contracts.js';
