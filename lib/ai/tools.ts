// AI tool definitions for Groq/Gemini function calling
import { authorizeCapability, type AuthorizationOutcome } from '@/lib/agent/authorization';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import { WRITE_CAPABILITIES } from '@/lib/agent/capabilities';
import type { SessionUser } from '@/lib/auth';
import { createTask as serviceCreateTask, getTasks } from '@/lib/tasks/service';
import { applyBulkTaskAction } from '@/lib/tasks/bulkAction';
import { bulkTaskActionSchema } from '@/lib/validation/schemas';
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

/**
 * One parameter in a tool's JSON Schema. Recursive, because a parameter may be an array of
 * objects — approved outreach copy is the first, and it is the shape an approver reads.
 */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, ToolParameterSchema>;
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
        "Fetch the current SDR's tasks from the CRM. Use when the SDR asks about their pending tasks, " +
        "what they have left today, or what's overdue. Every line begins with the task id in square " +
        'brackets — pass those exact ids to update_tasks or complete_tasks. Never invent a task id.',
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
      name: 'update_tasks',
      description:
        'Change tasks that already exist: skip them, move their due date, hand them to another rep, ' +
        "or attach a note to the task's lead. Get the ids from get_my_tasks first — every line there " +
        'begins with the id in square brackets, and an id you did not read there does not exist. This ' +
        'tool does not mark anything done; use complete_tasks for that. Every id is checked on its own, ' +
        'so ids belonging to another rep come back refused while the rest still apply — report what ' +
        'came back instead of assuming the whole list went through.',
      parameters: {
        type: 'object',
        properties: {
          taskIds: {
            type: 'array',
            description: 'Task ids, exactly as get_my_tasks printed them. At most 50 per call.',
            items: { type: 'string' },
          },
          action: {
            type: 'string',
            description:
              "What to do with them. 'skip' closes a task without doing it, 'reschedule' moves its due " +
              "date, 'reassign' hands it to another user, 'note' writes a note on the task's lead and " +
              'leaves the task open.',
            enum: ['skip', 'reschedule', 'reassign', 'note'],
          },
          dueDate: {
            type: 'string',
            description: 'New due date in ISO 8601 format. Required to reschedule.',
          },
          userId: {
            type: 'string',
            description:
              'User id to reassign to. Required to reassign, and must be someone the SDR manages.',
          },
          note: {
            type: 'string',
            description: 'Note text. Required for the note action, optional otherwise.',
          },
        },
        required: ['taskIds', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_tasks',
      description:
        "Mark tasks done. Use it for the rep's own manual reminders and one-off touches. Tasks that are " +
        'steps in a live sequence are refused on purpose — completing one advances the cadence and can ' +
        'send mail, so a person has to close it from the task list; when that comes back, say so plainly ' +
        'rather than implying the task closed. Phone, LinkedIn and WhatsApp tasks need an outcome, and ' +
        'one outcome covers the whole call, so only group tasks that genuinely share it. Ids come from ' +
        'get_my_tasks.',
      parameters: {
        type: 'object',
        properties: {
          taskIds: {
            type: 'array',
            description: 'Task ids, exactly as get_my_tasks printed them. At most 50 per call.',
            items: { type: 'string' },
          },
          outcome: {
            type: 'string',
            description:
              'What happened, for phone / LinkedIn / WhatsApp tasks (for example "connected", ' +
              '"no answer", "left voicemail"). Ask the SDR rather than guessing.',
          },
          note: {
            type: 'string',
            description: 'Optional note recorded against the completed tasks.',
          },
        },
        required: ['taskIds'],
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
  {
    type: 'function',
    function: {
      name: 'prioritize_leads',
      description:
        "Rank the current user's leads by the CRM's deterministic scorer, with a short evidence-grounded explanation for the top few. Use when asked what to work on next.",
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Restrict the ranking to one campaign.' },
          limit: { type: 'string', description: 'How many ranked leads to return. Default 50.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_lead_quality',
      description:
        "Measure a lead against its campaign's lead requirements and report duplicates and available research evidence. Reports only — it does not change the lead's qualification.",
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Lead ID to evaluate.' },
        },
        required: ['leadId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_contact_intelligence',
      description:
        'Fetch structured commercial intelligence, asset tier, buyer persona, relationship memory, competitor mentions, and reuse safety status for a lead or contact.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Optional Lead ID.' },
          contactId: { type: 'string', description: 'Optional Contact ID.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_sequence',
      description:
        'Draft outreach copy for a lead, grounded in stored research evidence. Produces a proposal only — it does not enroll the lead or send anything.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Lead ID to draft outreach for.' },
          channel: {
            type: 'string',
            description: 'Outreach channel for the draft.',
            enum: ['email', 'phone', 'linkedin', 'whatsapp'],
          },
        },
        required: ['leadId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enroll_lead_in_sequence',
      description:
        'Enroll a lead into an existing active sequence. This reaches the prospect: the automation engine schedules the steps and the email pipeline sends them.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Lead ID to enroll.' },
          sequenceId: { type: 'string', description: 'Sequence ID to enroll into.' },
          approvedCopy: {
            type: 'array',
            description:
              'Approved per-prospect copy for this cadence. These arguments are what an approver is shown and what execution replays, so this is the exact wording that will reach the prospect. Omit it and every step uses the sequence template.',
            items: {
              type: 'object',
              properties: {
                stepOrder: { type: 'number', description: 'Sequence step order, starting at 1.' },
                subject: { type: 'string', description: 'Subject line for this step.' },
                body: { type: 'string', description: 'Body for this step.' },
                citedEvidenceIds: {
                  type: 'array',
                  description: 'Evidence rows this copy is grounded in.',
                  items: { type: 'string' },
                },
              },
              required: ['stepOrder', 'body'],
            },
          },
        },
        required: ['leadId', 'sequenceId'],
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
  /**
   * The approval this call runs under, when a human has already decided it.
   *
   * An id rather than a flag, and re-derived here independently of the runtime's own check —
   * see `ExecuteActionInput.approvalRequestId`. Absent for interactive chat, where a capability
   * needing approval is still refused outright.
   */
  approvalRequestId?: string;
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
/**
 * Read a tool argument that must be a string.
 *
 * Arguments arrive as parsed JSON — from a model, or from a planner that now sends structured
 * values too — so `unknown` is what they actually are. Anything non-string reads as absent, which
 * every tool below already treats as a refusal rather than a default.
 */
function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * A list of strings out of a tool argument.
 *
 * Models do not reliably send an array where the schema asks for one — a single id arrives as a
 * bare string, and several sometimes arrive as `"a, b"` or as a JSON array in a string. Each of
 * those is unambiguous, so accepting them is not guessing; refusing them would only teach the
 * model to retry the same call. Anything that is not a string is dropped rather than coerced,
 * because a number or object here means the call was malformed and a task id is never either.
 */
function stringArrayArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (raw.startsWith('[')) {
    try {
      return stringArrayArg(JSON.parse(raw));
    } catch {
      // Fall through to comma splitting — a truncated JSON array still names ids.
    }
  }
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Does a human's approval already cover this call?
 *
 * `DENY` is never cleared — an approval cannot widen authority, only satisfy a requirement for it.
 * With no approval id in context the answer is no, so interactive chat is unaffected: a capability
 * set to `approval` is still refused there, because nobody has approved anything.
 */
async function approvalClears(
  outcome: AuthorizationOutcome,
  context: ToolContext
): Promise<boolean> {
  if (outcome === 'DENY' || !context.approvalRequestId || !context.tenantId || !context.role) {
    return false;
  }

  const { resumeApprovedAction } = await import('@/lib/workorders/approvals');
  const resume = await resumeApprovedAction({
    requestId: context.approvalRequestId,
    tenantId: context.tenantId,
    actor: { role: context.role, tenantId: context.tenantId },
  });
  return resume.status === 'proceed';
}

/** Narrow the string-only subset of a tool's arguments, for helpers that only ever want strings. */
function stringArgs(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
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

    if (decision.outcome !== 'ALLOW' && !(await approvalClears(decision.outcome, context))) {
      return refusalMessage(decision.outcome);
    }
  }

  switch (toolName) {
    case 'search_web':
      return searchWeb(stringArg(args.query), context);

    case 'visit_page':
      return visitPage(stringArg(args.url), context);

    case 'research_account':
      return runResearchAccount(stringArg(args.accountId), stringArg(args.depth), context);

    case 'research_contact':
      return runResearchContact(stringArg(args.contactId), stringArg(args.depth), context);

    case 'prioritize_leads':
      return runPrioritizeLeads(stringArgs(args), context);

    // Every lead-scoped tool falls back to the lead the user has open, the way `create_task`
    // always has. The model is told the id in its context block, but it does not always echo
    // it into the call; refusing then — "leadId is required" — was the error SDRs saw when
    // they asked for a score with the lead panel open. 70 of 90 production chat calls carried
    // no lead id at all.
    case 'evaluate_lead_quality':
      return runEvaluateLeadQuality(stringArg(args.leadId) ?? context.leadId, context);

    case 'get_contact_intelligence':
      return runGetContactIntelligence(stringArg(args.leadId) ?? context.leadId, stringArg(args.contactId), context);

    case 'draft_sequence':
      return runDraftSequence(stringArg(args.leadId) ?? context.leadId, stringArg(args.channel), context);

    case 'enroll_lead_in_sequence':
      return runEnrollLeadInSequence(
        stringArg(args.leadId) ?? context.leadId,
        stringArg(args.sequenceId),
        args.approvedCopy,
        context
      );

    case 'create_task':
      return createTask(stringArgs(args), context.userId, context.leadId, context.sessionUser);

    case 'get_my_tasks':
      return getMyTasks(
        stringArg(args.filter) ?? '',
        parseInt(stringArg(args.limit) || '10'),
        context.userId,
        context.today,
        context.sessionUser
      );

    // The action is the model's to choose here, and an unrecognized one is rejected by the schema
    // inside the handler rather than silently falling through to some default verb.
    case 'update_tasks':
      return runTaskBulkTool(args, context, stringArg(args.action));

    case 'complete_tasks':
      return runTaskBulkTool(args, context, 'complete');

    default:
      return `Unknown tool: ${toolName}`;
  }
}

async function searchWeb(query: string | undefined, ctx: ToolContext): Promise<string> {
  // Refuse rather than call the provider with nothing. The previous string-typed argument map hid
  // this: a call with no query reached Tavily as `undefined` and was billed for the round trip.
  if (!query?.trim()) throw new Error('search_web refused: query is required.');
  const { performTavilySearch } = await import('./providers');
  const res = await performTavilySearch(query, ctx);
  if (!res.success) {
    if (res.status === 'unavailable') return 'Search temporarily unavailable.';
    return 'No results found.';
  }
  return res.data;
}

async function visitPage(url: string | undefined, ctx: ToolContext): Promise<string> {
  if (!url?.trim()) throw new Error('visit_page refused: url is required.');
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

    /**
     * Each line leads with the task id, because anything that mutates a task needs one.
     *
     * This formatter emitted type, title, lead and due date and never the id, so a model asked to
     * act on a task had no way to name it. That creates the worst kind of failure: an id is a cuid,
     * a model will happily invent a plausible-looking one, and the mutation tool would then answer
     * "Not found" for a task the SDR is looking at on screen. The real id is what makes
     * `update_tasks` and `complete_tasks` addressable at all.
     *
     * The id is visible to the SDR as well. That is acceptable — it is their own task — and the
     * alternative, a hidden id map carried across turns, is state this runtime does not keep.
     */
    return tasks
      .map(
        (t) =>
          `• [${t.id}] ${t.type.toUpperCase()} — ${t.title}${t.lead ? ` (${t.lead.firstName} ${t.lead.lastName})` : ''} — due ${new Date(t.dueDate).toLocaleString()}`
      )
      .join('\n');
  } catch {
    return 'Could not fetch tasks.';
  }
}

/**
 * How many tasks the assistant may name in one call.
 *
 * Far below the route's 200, and the gap is the point: a person selecting 200 checkboxes has seen
 * 200 rows, while a model producing 200 ids from one sentence has seen a sentence. Fifty is more
 * than any real "clear my overdue list" and small enough that a hallucinated spray is capped.
 */
const AGENT_BULK_TASK_LIMIT = 50;

const BULK_ACTION_PAST_TENSE: Record<string, string> = {
  complete: 'completed',
  skip: 'skipped',
  reschedule: 'rescheduled',
  reassign: 'reassigned',
  note: 'given a note',
};

/**
 * `update_tasks` and `complete_tasks`, which are the same call with a different verb.
 *
 * Both go through `applyBulkTaskAction` with `actor: 'agent'` — the same function the task list's
 * bulk bar uses, so the per-task access checks, the pending compare-and-set, the outcome
 * requirement and the cadence refusal are the ones already in production rather than a second set
 * written for chat. `actor` is what makes the cadence gate fire; it is not derived from anything
 * the model controls.
 *
 * `ctx.sessionUser` is required and never reconstructed from `ctx.userId`. A hand-built user object
 * would have to invent a role and a tenant, and `canAccessUser` / `canAccessLead` believe what they
 * are given, so inventing one is how an agent would quietly acquire a manager's reach.
 */
async function runTaskBulkTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
  action: string | undefined
): Promise<string> {
  if (!ctx.sessionUser) {
    return 'Cannot change tasks without session user context. Nothing was changed.';
  }

  const taskIds = stringArrayArg(args.taskIds);
  if (!taskIds.length) {
    return 'No task ids were given, so nothing was changed. Call get_my_tasks first and use the ids it prints in square brackets.';
  }
  if (taskIds.length > AGENT_BULK_TASK_LIMIT) {
    return `That names ${taskIds.length} tasks and the limit for one call is ${AGENT_BULK_TASK_LIMIT}. Nothing was changed — ask the SDR which ones they mean, or work through them in smaller batches.`;
  }

  const parsed = bulkTaskActionSchema.safeParse({
    taskIds,
    action,
    dueDate: stringArg(args.dueDate),
    userId: stringArg(args.userId),
    note: stringArg(args.note),
    outcome: stringArg(args.outcome),
  });
  if (!parsed.success) {
    const why = parsed.error.issues.map((issue) => issue.message).join('; ');
    return `Those arguments were rejected and nothing was changed: ${why}`;
  }

  try {
    const result = await applyBulkTaskAction(ctx.sessionUser, parsed.data, 'agent');

    // The reassignment target is not someone this SDR manages, and the call wrote nothing at all.
    if (result.refusedTarget) {
      return 'That user is not someone this SDR can hand work to, so nothing was changed.';
    }

    const verb = BULK_ACTION_PAST_TENSE[parsed.data.action] ?? 'changed';
    const lines = [`${result.updated} task${result.updated === 1 ? '' : 's'} ${verb}.`];
    if (result.failed.length) {
      // Reported, never summarised away: a partial result that reads as a whole one is how the CRM
      // ends up recording work nobody did.
      lines.push(
        `${result.failed.length} were not changed — ${result.failed
          .map((f) => `${f.taskId}: ${f.reason}`)
          .join('; ')}`
      );
    }
    return lines.join(' ');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Could not change those tasks, and nothing was changed: ${message}`;
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

/**
 * Phase 8a adapters.
 *
 * Each one does exactly three things: refuse (by throwing) when the context it needs is
 * missing, call **one** CRM domain service, and format the result for the model. No CRM rule
 * is decided here — scoping, requirement matching, grounding, human ownership and the
 * operating-state moves all live in the services these call.
 */
async function runPrioritizeLeads(
  args: Record<string, string>,
  ctx: ToolContext
): Promise<string> {
  if (!ctx.tenantId) throw new Error('prioritize_leads refused: tenant context is missing.');
  if (!ctx.sessionUser) {
    throw new Error('prioritize_leads refused: an authenticated session is required.');
  }

  const { prioritizeLeadsWithRefinement } = await import('@/lib/research/leadRefinement');
  const parsedLimit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
  const result = await prioritizeLeadsWithRefinement(ctx.sessionUser, {
    tenantId: ctx.tenantId,
    campaignId: args.campaignId || null,
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    workOrderId: ctx.workOrderId ?? null,
    agentActionId: ctx.agentActionId ?? null,
  });

  if (result.leads.length === 0) return 'No leads to prioritize.';

  const lines = result.leads
    .slice(0, 10)
    .map(
      (lead) =>
        `${lead.rank}. ${lead.firstName} ${lead.lastName} (${lead.company}) — score ${lead.score} [${lead.label}]` +
        (lead.aiRationale ? ` — ${lead.aiRationale}` : '')
    );

  const refinement = result.aiRefined
    ? `${result.refinedCount} refined with an evidence-grounded rationale`
    : `no AI refinement (${result.degradedReason ?? 'unavailable'}) — deterministic ranking only`;

  return `Ranked ${result.rankedCount} lead(s); ${refinement}.\n${lines.join('\n')}`;
}

async function runEvaluateLeadQuality(
  leadId: string | undefined,
  ctx: ToolContext
): Promise<string> {
  if (!leadId) throw new Error('evaluate_lead_quality refused: leadId is required.');
  if (!ctx.tenantId) throw new Error('evaluate_lead_quality refused: tenant context is missing.');
  if (!ctx.sessionUser) {
    throw new Error('evaluate_lead_quality refused: an authenticated session is required.');
  }

  const { evaluateLeadQuality } = await import('@/lib/leadgen/qualification');
  const assessment = await evaluateLeadQuality(ctx.sessionUser, {
    tenantId: ctx.tenantId,
    leadId,
  });

  const duplicates =
    assessment.duplicateLeadIds.length > 0
      ? ` Possible duplicates: ${assessment.duplicateLeadIds.join(', ')}.`
      : '';

  // No requirements is not a failing grade. `meetsAnyRequirement` is `matches.some(...)`, which is
  // `false` over an empty list — literally correct, and read as a verdict once a sentence is built
  // on it. `CampaignLeadRequirement` has never held a row in production, so every lead came back
  // as failing criteria nobody had written, which is why lead scoring was reported as useless.
  if (assessment.requirements.length === 0) {
    return (
      `Lead ${assessment.leadId} was not measured: ${assessment.summary} ` +
      'Configure lead requirements on the campaign to score leads against it.' +
      duplicates
    );
  }

  return (
    `Lead ${assessment.leadId}: ${assessment.meetsAnyRequirement ? 'meets' : 'does not fully meet'} the campaign lead requirements. ` +
    `${assessment.summary}` +
    duplicates
  );
}

async function runDraftSequence(
  leadId: string | undefined,
  channel: string | undefined,
  ctx: ToolContext
): Promise<string> {
  if (!leadId) throw new Error('draft_sequence refused: leadId is required.');
  if (!ctx.tenantId) throw new Error('draft_sequence refused: tenant context is missing.');
  if (!ctx.sessionUser) throw new Error('draft_sequence refused: an authenticated session is required.');
  if (!ctx.workOrderId) {
    // The work order id is the transition's idempotency identity. Without it a retry would
    // record a second occurrence of the same state move.
    throw new Error('draft_sequence refused: a work order context is required.');
  }

  const { prepareProspectOutreach } = await import('@/lib/research/prospectOutreach');
  const result = await prepareProspectOutreach(ctx.sessionUser, {
    tenantId: ctx.tenantId,
    leadId,
    workOrderId: ctx.workOrderId,
    actorUserId: ctx.userId,
    agentActionId: ctx.agentActionId ?? null,
    channel: channel as 'email' | 'phone' | 'linkedin' | 'whatsapp' | undefined,
  });

  const header = result.draft.grounded
    ? `Drafted ${result.draft.steps.length} step(s), grounded in ${result.draft.citedEvidenceIds.length} evidence row(s). Prospect state: ${result.state}.`
    : `Drafted ${result.draft.steps.length} step(s) WITHOUT grounded evidence (${result.draft.groundingReason ?? 'no evidence'}). Prospect state: ${result.state}. Nothing has been enrolled or sent.`;

  const body = result.draft.steps
    .map((step) => `#${step.order} [${step.channel}, +${step.delayDays}d] ${step.subject ?? ''} — ${step.body}`)
    .join('\n');

  return `${header}\n${body}`;
}

/**
 * Enrollment, carrying the copy an approver signed off on.
 *
 * The arguments are the approval record: `AgentApprovalRequest.args` stores them verbatim, and a
 * resume replays them rather than re-deriving anything. Carrying the copy here therefore makes
 * "approved words" and "sent words" the same object — no model is consulted at send time, and a
 * provider outage cannot change what a prospect reads.
 */
async function runEnrollLeadInSequence(
  leadId: string | undefined,
  sequenceId: string | undefined,
  approvedCopy: unknown,
  ctx: ToolContext
): Promise<string> {
  if (!leadId) throw new Error('enroll_lead_in_sequence refused: leadId is required.');
  if (!sequenceId) throw new Error('enroll_lead_in_sequence refused: sequenceId is required.');
  if (!ctx.tenantId) throw new Error('enroll_lead_in_sequence refused: tenant context is missing.');
  if (!ctx.sessionUser) {
    throw new Error('enroll_lead_in_sequence refused: an authenticated session is required.');
  }
  if (!ctx.workOrderId) {
    throw new Error('enroll_lead_in_sequence refused: a work order context is required.');
  }

  // Validated before anything is claimed. Malformed copy is a refusal, never a silent fallback to
  // the template — that would send generic words to a prospect a human personalized for.
  const { parseApprovedCopy } = await import('@/lib/sequences/stepCopy');
  const copy =
    approvedCopy === undefined || approvedCopy === null
      ? undefined
      : parseApprovedCopy(approvedCopy);

  const { launchAIOutreach } = await import('@/lib/prospects/outreach');
  const result = await launchAIOutreach(ctx.sessionUser, {
    tenantId: ctx.tenantId,
    leadId,
    sequenceId,
    workOrderId: ctx.workOrderId,
    approvedCopy: copy,
  });

  const copyNote = copy
    ? ` ${copy.length} step(s) use approved per-prospect copy.`
    : ' Every step uses the sequence template.';

  return `Enrolled lead ${leadId} in "${result.enrollment.sequenceName}" (enrollment ${result.enrollment.enrollmentId}). Prospect state: ${result.state}.${copyNote} The automation engine schedules the steps; nothing was sent by this action.`;
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

async function runGetContactIntelligence(
  leadId: string | undefined,
  contactId: string | undefined,
  ctx: ToolContext
): Promise<string> {
  if (!ctx.tenantId) throw new Error('get_contact_intelligence refused: tenant context is missing.');

  const { getContactIntelligenceForAgent } = await import('@/lib/contact-intelligence');
  return await getContactIntelligenceForAgent(leadId || ctx.leadId, contactId, ctx.tenantId);
}
