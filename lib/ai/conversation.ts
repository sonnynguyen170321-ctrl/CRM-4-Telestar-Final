/**
 * Provider-neutral conversation state.
 *
 * A tool-calling turn is not a list of strings: it is user turns, assistant turns that asked
 * for tools, and tool results keyed back to the call that asked for them. Each SDK spells that
 * differently, so the loop keeps one shape and the adapters translate.
 *
 * Import-free on purpose — `lib/ai/models.ts` is the client-safe leaf and this sits beside it
 * in the same tier, so a component may reference these types without dragging the gateway
 * (and therefore Prisma, `async_hooks`, `dns`) into the browser bundle.
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A tool the model asked to call, before it has been authorized or executed. */
export interface PendingToolCall {
  /** The provider's correlation id. Changes on every retry, so it is never an idempotency key. */
  id: string;
  name: string;
  /** Raw JSON as the provider emitted it. Parsed by the loop, which owns the failure mode. */
  arguments: string;
}

export type LoopMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: PendingToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

/** One tool definition, in the JSON-Schema shape all three providers accept a translation of. */
export interface GatewayToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Runs one authorized tool and returns what the model should be told.
 *
 * Supplied by the caller, never implemented here. That is the boundary that keeps the gateway
 * free of any Prisma client or agent import: the gateway decides which provider runs and
 * settles the ledger; the caller decides whether an action is permitted and performs it.
 */
export type GatewayToolExecutor = (call: {
  name: string;
  /** `null` when the model emitted arguments that are not valid JSON. */
  args: Record<string, unknown> | null;
  /**
   * Position of this call within the whole turn, counted across loop iterations. Two
   * `create_task` calls in one turn must produce two distinct action keys, so the ordinal —
   * not the provider's call id — is what an idempotency key is built from.
   */
  ordinal: number;
}) => Promise<string>;

/** Builds the message list a provider adapter receives for one iteration. */
export function toLoopMessages(systemPrompt: string | undefined, messages: ChatMessage[]): LoopMessage[] {
  const loop: LoopMessage[] = [];
  if (systemPrompt) loop.push({ role: 'system', content: systemPrompt });
  for (const message of messages) {
    if (message.role === 'system') loop.push({ role: 'system', content: message.content });
    else if (message.role === 'assistant') loop.push({ role: 'assistant', content: message.content });
    else loop.push({ role: 'user', content: message.content });
  }
  return loop;
}
