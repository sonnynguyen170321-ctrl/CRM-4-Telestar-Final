/**
 * The Telestar AI chat turn.
 *
 * One place decides what a chat turn does: which tools it may call, how a tool call becomes an
 * idempotency key, and what the SDR is told when a provider fails. The route above it does
 * HTTP and context assembly; the gateway below it does provider selection and governance.
 *
 * ## Tool authorization is not weakened by living here
 *
 * Every tool call still goes through `executeAgentAction`, which resolves capability
 * authorization, object scope, tenancy and audit in the CRM domain services. This module adds
 * exactly two guards on top, both carried over unchanged from the path it replaces:
 *
 *   1. A write-capable tool is refused outright when the turn has no durable execution id,
 *      because a retry would then get a fresh namespace and write a second CRM row.
 *   2. The action key is built from a per-turn ordinal, never the provider's tool-call id —
 *      that id changes on every retry, so it cannot be the idempotency authority.
 */

import type { SessionUser } from '@/lib/auth';
import { executeAgentAction } from '@/lib/agent/runtime';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import { WRITE_CAPABILITIES } from '@/lib/agent/capabilities';
import { AI_TOOLS } from './tools';
import { CHAT_OUTPUT_BUDGET_TOKENS } from './registry';
import { scrubSecrets } from './engine/security-guards';
import { newExecutionId } from './executionId';
import {
  aiGateway,
  type ChatMessage,
  type GatewayAttempt,
  type GatewayFailureKind,
  type GatewayToolDefinition,
} from './gateway';
import type { ModelId } from './models';

export interface ChatTurnInput {
  sessionUser: SessionUser;
  messages: ChatMessage[];
  systemPrompt: string;
  /** `'auto'` or omitted lets the router choose. */
  preferredModel?: ModelId;
  leadId?: string;
  playbookVersionId?: string;
  /**
   * The caller's logical turn. Absent when the client sent nothing valid — the turn then has
   * no durable idempotency namespace, so no write-capable tool may run under it.
   */
  executionId?: string;
  /** Correlation id for this request. One id ties the log lines, the ledger and the UI error. */
  turnId: string;
}

/**
 * A tool call is refused outright when the turn has no durable execution id and the tool
 * writes. Read-only research still runs, under a namespace marked as what it is: valid for
 * this process only, never a claim that a retry would be recognised.
 */
function requiresDurableExecution(toolName: string): boolean {
  const capability = capabilityForTool(toolName);
  // An unregistered tool is refused by the runtime anyway; treating it as write-capable here
  // keeps the stricter answer in both places.
  return !capability || WRITE_CAPABILITIES.has(capability);
}

const NO_EXECUTION_ID_REFUSAL =
  'That action needs a durable execution id and this conversation turn has none, so nothing was written. ' +
  'Ask the SDR to send the message again — do not describe the action as done.';

const MALFORMED_ARGUMENTS_REFUSAL =
  'The arguments for that tool call were not valid JSON, so nothing ran. Ask for the missing detail ' +
  'and try again — do not describe the action as done.';

/**
 * What the SDR reads when a turn cannot be completed.
 *
 * Never a provider payload, a status code or a stack trace — and never a hint that they did
 * something wrong, because they did not. The classification behind each sentence is logged
 * against the turn id, so an engineer can tell these apart even though the SDR cannot.
 */
export function userMessageForFailure(kind: GatewayFailureKind | 'unknown'): string {
  switch (kind) {
    case 'rate_limit':
    case 'quota_exceeded':
      return 'Telestar AI is temporarily at capacity. Try that again shortly.';
    case 'all_providers_unavailable':
    case 'authentication':
    case 'provider_outage':
    case 'model_unavailable':
      return 'Telestar AI is temporarily unavailable. The rest of the CRM is still working.';
    case 'budget_exceeded':
      return "This workspace has reached its AI usage limit for now. Ask your manager to raise it.";
    case 'timeout':
      return 'That took too long to generate. Try that again.';
    default:
      return "I couldn't finish that response. Try that again.";
  }
}

export interface ChatTurnOutcome {
  status: 'ok' | 'truncated' | 'failed';
  provider?: string;
  model?: string;
  failure?: GatewayFailureKind | 'unknown';
  attempts: GatewayAttempt[];
  toolCallCount: number;
}

/**
 * Runs one chat turn, yielding text as it arrives.
 *
 * Never throws for a provider problem: a failure becomes a final human sentence appended to
 * the stream, so the reader always ends on something intelligible rather than a truncated
 * fragment or an empty bubble. `onOutcome` receives the machine-readable result for logging.
 */
export async function* runChatTurn(
  input: ChatTurnInput,
  onOutcome?: (outcome: ChatTurnOutcome) => void,
): AsyncGenerator<string> {
  // Only used when the turn has no durable execution id, and only for read-only tools. Named
  // so a row written under it can never be mistaken for a retry-safe one.
  const executionNamespace = input.executionId ?? `ephemeral-${newExecutionId()}`;
  let toolCallCount = 0;
  let producedText = false;

  const outcome: ChatTurnOutcome = { status: 'failed', attempts: [], toolCallCount: 0 };

  const events = aiGateway.execute({
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    sessionUser: { id: input.sessionUser.id, tenantId: input.sessionUser.tenantId },
    leadId: input.leadId,
    operation: 'chat',
    executionId: input.executionId,
    turnId: input.turnId,
    preferredModel: input.preferredModel === 'auto' ? undefined : input.preferredModel,
    criteria: { task: 'chat', requiresTools: true, risk: 'draft' },
    maxTokens: CHAT_OUTPUT_BUDGET_TOKENS,
    timeoutMs: 60_000,
    tools: AI_TOOLS as unknown as GatewayToolDefinition[],
    executeTool: async ({ name, args, ordinal }) => {
      toolCallCount++;

      if (args === null) return MALFORMED_ARGUMENTS_REFUSAL;
      if (!input.executionId && requiresDurableExecution(name)) return NO_EXECUTION_ID_REFUSAL;

      // The provider's tool-call id is correlation only — it changes on every retry, so it
      // cannot be the idempotency authority. The ordinal is.
      const actionKey = `agent:${executionNamespace}:tool:${ordinal}:${name}`;

      const result = await executeAgentAction({
        actionKey,
        toolName: name,
        args,
        sessionUser: input.sessionUser,
        leadId: input.leadId,
        playbookVersionId: input.playbookVersionId,
      });

      const payload = result.status === 'completed' ? result.result || 'Done' : result.error || 'Failed';

      // Tool results carry CRM content — lead notes, prospect emails, imported fields, scraped
      // research — which AGENTS.md classifies as untrusted. A credential pasted into a lead note
      // by a rep, or quoted inside a provider error body, would otherwise travel back into the
      // model's context and can be echoed into an answer from there.
      //
      // Scoped deliberately to tool results, which are complete strings. The model's own streamed
      // answer is not scrubbed here: chunk boundaries can split a credential in half, so a
      // per-chunk scrub would miss it and imply a protection that does not exist. That needs a
      // windowed scrubber and its own proof.
      return scrubSecrets(payload);
    },
  });

  for await (const event of events) {
    if (event.kind === 'text') {
      producedText = true;
      yield event.text;
      continue;
    }
    if (event.kind === 'done') {
      outcome.status = 'ok';
      outcome.provider = event.result.provider;
      outcome.model = event.result.modelId;
      outcome.attempts = event.result.attempts;
      continue;
    }
    if (event.kind === 'truncated') {
      outcome.status = 'truncated';
      outcome.attempts = event.attempts;
      outcome.failure = lastFailure(event.attempts);
      // Part of an answer already reached the reader. Ending on a plain sentence is what stops
      // it looking like the assistant simply stopped mid-thought.
      yield `\n\n${userMessageForFailure(outcome.failure)}`;
      continue;
    }
    // unavailable
    outcome.status = 'failed';
    outcome.attempts = event.attempts;
    outcome.failure = event.attempts.length === 0 ? 'all_providers_unavailable' : lastFailure(event.attempts);
    if (!producedText) yield userMessageForFailure(outcome.failure);
  }

  outcome.toolCallCount = toolCallCount;
  onOutcome?.(outcome);
}

function lastFailure(attempts: GatewayAttempt[]): GatewayFailureKind | 'unknown' {
  const code = attempts[attempts.length - 1]?.errorCode;
  return (code as GatewayFailureKind) ?? 'unknown';
}
