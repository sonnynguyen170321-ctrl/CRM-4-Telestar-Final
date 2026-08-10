// AI tool definitions for Groq/Gemini function calling
import { authorizeCapability, type AuthorizationOutcome } from '@/lib/agent/authorization';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import { WRITE_CAPABILITIES } from '@/lib/agent/capabilities';
import type { SessionUser } from '@/lib/auth';
import { createTask as serviceCreateTask, getTasks } from '@/lib/tasks/service';
import { TaskType, TaskPriority } from '@prisma/client';
import { RetryableResearchError } from '@/lib/research/error';

/** What the model is told when a capability is not cleanly allowed. */
function refusalMessage(outcome: AuthorizationOutcome): string {
  switch (outcome) {
    case 'REQUIRE_USER_APPROVAL':
      return 'That action needs approval before it can run. Tell the SDR what you would do and ask them to approve it — do not describe it as done.';
    case 'REQUIRE_MANAGER_APPROVAL':
      return 'That action needs manager approval before it can run. Tell the SDR it has to go to their manager — do not describe it as done.';
    case 'DENY':
      return 'That action is reserved for a human and cannot be performed by the assistant. Say so plainly rather than implying it happened.';
    default:
      return 'That action could not be authorized. No changes were made.';
  }
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export const AI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description:
        'Search the web for information about a company, person, or topic. Use this for prospect research, company news, or any question that requires current information from the internet.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The search query. Be specific — include company name, person name, or topic.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'visit_page',
      description:
        "Visit a specific URL and read the full page content. Use this after search_web to get detailed information from a specific website, company page, LinkedIn profile, or news article. Don't use this as the first step — search first to find the right URL.",
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to visit (must start with https://).',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        "Create a new task in the CRM for the current SDR. Use this when the SDR asks you to add, create, or schedule a task. The task is always created for the logged-in user — you cannot create tasks for other users.",
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short title for the task (e.g., "Call Sarah Chen at Acme Corp")',
          },
          channel: {
            type: 'string',
            description: 'The outreach channel for this task.',
            enum: ['email', 'phone', 'linkedin', 'whatsapp'],
          },
          dueDate: {
            type: 'string',
            description:
              'Due date in ISO 8601 format (e.g., "2026-06-18T09:00:00.000Z"). Use the correct date based on context.',
          },
          leadId: {
            type: 'string',
            description:
              'The CRM lead ID if this task is linked to a specific lead. Only include if the user is viewing a lead panel and you have the leadId from context.',
          },
          notes: {
            type: 'string',
            description: 'Optional notes or context for the task.',
          },
        },
        required: ['title', 'channel', 'dueDate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_tasks',
      description:
        "Fetch the current SDR's tasks from the CRM. Use when the SDR asks about their pending tasks, what they have left today, or what's overdue.",
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            description: 'Which tasks to fetch.',
            enum: ['today', 'overdue', 'pending', 'all'],
          },
          limit: {
            type: 'string',
            description: 'Maximum number of tasks to return. Default is 10.',
          },
        },
        required: ['filter'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_account',
      description: 'Executes account-level research to gather growth signals and pain hypotheses.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Account ID to research' },
          depth: { type: 'string', description: 'Depth of research: light, standard, or deep', enum: ['light', 'standard', 'deep'] },
        },
        required: ['accountId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research_contact',
      description: 'Executes contact-level research to extract personalization hooks and role angles.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID to research' },
          depth: { type: 'string', description: 'Depth of research: light, standard, or deep', enum: ['light', 'standard', 'deep'] },
        },
        required: ['contactId'],
      },
    },
  },
];

/**
 * Attribution context for research providers (Revenue AI Phase 1). Optional fields so a
 * caller that has not been threaded still works — the call is then unattributed rather
 * than failed.
 */
export interface ToolContext {
  userId: string;
  leadId?: string;
  today: string;
  tenantId?: string;
  operation?: string;
  workOrderId?: string;
  /**
   * The caller's CRM role, for capability authorization (Revenue AI Phase 2). Optional so an
   * un-threaded caller still works — but see `executeTool`: absence denies write-capable
   * tools rather than waving them through.
   */
  role?: SessionUser['role'];
  /** The full session user, if available, for invoking domain services */
  sessionUser?: SessionUser;
  /** Linkage back to the executing AgentAction for AI calls */
  agentActionId?: string;
}

/**
 * Execute a tool call, after checking the caller may.
 *
 * This is **capability** authorization only. It answers "may an agent do this kind of thing
 * for this role?" and nothing about the specific record. Whether this user may touch *that*
 * lead, campaign or account is decided afterwards by the CRM domain service the tool calls,
 * which already enforces tenancy, `canAccessLead`, `canAccessUser` and the pod hierarchy.
 * Object authorization is never reproduced here — duplicating it would create a second,
 * weaker copy that drifts from the real one.
 *
 * Authorization sits here rather than inside each tool so a new tool cannot invent its own
 * rules or bypass them.
 */

/**
 * Execute a tool call by name. Wraps capability check & domain execution.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, string>,
  context: ToolContext
): Promise<string> {
  const capability = capabilityForTool(toolName);
  if (!capability) {
    return `Tool "${toolName}" is not registered for use. No action taken.`;
  }

  if (WRITE_CAPABILITIES.has(capability) && !context.role) {
    return 'That action needs your CRM role to authorize it, which is missing from this session. No changes were made.';
  }

  if (context.role) {
    const decision = await authorizeCapability(
      { role: context.role, tenantId: context.tenantId },
      capability
    );

    if (decision.outcome !== 'ALLOW') {
      return refusalMessage(decision.outcome);
    }
  }

  switch (toolName) {
    case 'search_web':
      return searchWeb(args.query, context);

    case 'visit_page':
      return visitPage(args.url, context);

    case 'research_account':
      return runResearchAccount(args.accountId, args.depth, context);

    case 'research_contact':
      return runResearchContact(args.contactId, args.depth, context);

    case 'create_task':
      return createTask(args, context.userId, context.leadId, context.sessionUser);

    case 'get_my_tasks':
      return getMyTasks(args.filter, parseInt(args.limit || '10'), context.userId, context.today, context.sessionUser);

    default:
      return `Unknown tool: ${toolName}`;
  }
}

async function searchWeb(query: string, ctx: ToolContext): Promise<string> {
  const { performTavilySearch } = await import('./providers');
  const res = await performTavilySearch(query, ctx);
  if (!res.success) {
    if (res.status === 'unavailable') return 'Search temporarily unavailable.';
    return 'No results found.';
  }
  return res.data;
}

async function visitPage(url: string, ctx: ToolContext): Promise<string> {
  const { performJinaFetch } = await import('./providers');
  const res = await performJinaFetch(url, ctx);
  if (!res.success) {
    return 'Could not access that page. LinkedIn may have blocked access — using search results instead.';
  }
  return res.data;
}

async function createTask(
  args: Record<string, string>,
  userId: string,
  contextLeadId?: string,
  sessionUser?: SessionUser
): Promise<string> {
  const leadId = args.leadId || contextLeadId;
  if (!leadId) return 'Cannot create task without a leadId in context.';
  if (!sessionUser) return 'Cannot create task without session user context.';

  try {
    const task = await serviceCreateTask(sessionUser, {
      leadId,
      userId,
      type: (args.channel as TaskType) || 'email',
      title: args.title,
      description: args.notes,
      dueDate: new Date(args.dueDate),
      priority: 'medium' as TaskPriority,
    });

    return `Task created: "${task.title}" scheduled for ${new Date(task.dueDate).toLocaleString()}. Task ID: ${task.id}`;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('Forbidden')) return 'You do not have permission to create this task.';
    return `Could not create the task: ${errorMsg}`;
  }
}

async function getMyTasks(
  filter: string,
  limit: number,
  userId: string,
  today: string,
  sessionUser?: SessionUser
): Promise<string> {
  if (!sessionUser) return 'Cannot fetch tasks without session user context.';

  try {
    const tasks = await getTasks(sessionUser, {
      tab: filter,
      limit,
      scopeUserId: userId,
    });

    if (!tasks.length) return `No ${filter} tasks found.`;

    return tasks
      .map(
        (t) =>
          `• ${t.type.toUpperCase()} — ${t.title}${t.lead ? ` (${t.lead.firstName} ${t.lead.lastName})` : ''} — due ${new Date(t.dueDate).toLocaleString()}`
      )
      .join('\n');
  } catch {
    return 'Could not fetch tasks.';
  }
}

async function runResearchAccount(
  accountId: string | undefined,
  depth: string | undefined,
  ctx: ToolContext
): Promise<string> {
  // Fail closed, and *loudly*. Returning a string here would be recorded by the runtime as a
  // completed AgentAction whose result happens to read like a refusal — an action that never
  // ran, marked done. A thrown non-retryable error records `failed` instead.
  if (!accountId) throw new Error('research_account refused: accountId is required.');
  if (!ctx.tenantId) throw new Error('research_account refused: tenant context is missing.');
  if (!ctx.sessionUser || !ctx.leadId) {
    throw new Error(
      'research_account refused: an authenticated session and lead context are required.'
    );
  }

  try {
    const { executeAccountResearch } = await import('@/lib/research/engine');
    const result = await executeAccountResearch({
      tenantId: ctx.tenantId,
      accountId,
      leadId: ctx.leadId,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      userId: ctx.userId,
      sessionUser: ctx.sessionUser,
      depth: (depth as 'light' | 'standard' | 'deep') || 'standard',
    });

    if (result.status === 'in_progress' || result.status === 'pending') {
      throw new RetryableResearchError('Research is currently in progress by another worker.');
    }
    if (result.status === 'failed') {
      throw new Error('Research failed during execution.');
    }

    return `Account research completed for ${accountId}. Status: ${result.status}, ClaimToken: ${result.claimToken}`;
  } catch (err) {
    if (err instanceof RetryableResearchError) throw err;
    throw new Error(`Account research failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runResearchContact(
  contactId: string | undefined,
  depth: string | undefined,
  ctx: ToolContext
): Promise<string> {
  // Same rule as `runResearchAccount`: refuse by throwing, never by returning prose.
  if (!contactId) throw new Error('research_contact refused: contactId is required.');
  if (!ctx.tenantId) throw new Error('research_contact refused: tenant context is missing.');
  if (!ctx.sessionUser || !ctx.leadId) {
    throw new Error(
      'research_contact refused: an authenticated session and lead context are required.'
    );
  }

  try {
    const { executeContactResearch } = await import('@/lib/research/engine');
    const result = await executeContactResearch({
      tenantId: ctx.tenantId,
      contactId,
      leadId: ctx.leadId,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      userId: ctx.userId,
      sessionUser: ctx.sessionUser,
      depth: (depth as 'light' | 'standard' | 'deep') || 'standard',
    });

    if (result.status === 'in_progress' || result.status === 'pending') {
      throw new RetryableResearchError('Research is currently in progress by another worker.');
    }
    if (result.status === 'failed') {
      throw new Error('Research failed during execution.');
    }

    return `Contact research completed for ${contactId}. Status: ${result.status}, ClaimToken: ${result.claimToken}`;
  } catch (err) {
    if (err instanceof RetryableResearchError) throw err;
    throw new Error(`Contact research failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
