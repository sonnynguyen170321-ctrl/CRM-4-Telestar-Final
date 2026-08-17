/**
 * 🎯 INTENT ENGINE & TEMPORAL REASONING (Sections 7 & 8)
 *
 * Classifies user requests into typed intents and parses temporal frames deterministically.
 */

export type AiIntent =
  | 'LOOKUP'
  | 'EXPLAIN'
  | 'PRIORITIZE'
  | 'RECOMMEND'
  | 'COMPARE'
  | 'DRAFT'
  | 'ANALYZE'
  | 'COACH'
  | 'REPORT'
  | 'RESEARCH'
  | 'DIAGNOSE'
  | 'PREPARE_ACTION'
  | 'EXECUTE_ACTION'
  | 'MONITOR'
  | 'CONFIGURE_HELP';

export type TemporalFrame =
  | 'NOW'
  | 'TODAY'
  | 'RECENT'
  | 'OVERDUE'
  | 'TREND'
  | 'HISTORICAL'
  | 'SCHEDULED'
  | 'NEXT';

export interface IntentAnalysis {
  intent: AiIntent;
  confidence: number;
  temporalFrame: TemporalFrame;
  requiresMutation: boolean;
  requiredDepth: 'MICRO' | 'STANDARD' | 'DEEP' | 'EXECUTIVE' | 'ACTION' | 'DIAGNOSTIC';
  suggestedTools: string[];
}

/**
 * Classifies the intent and temporal frame from natural language request text.
 */
export function classifyIntent(requestText: string): IntentAnalysis {
  const text = requestText.toLowerCase().trim();

  // 1. Resolve Temporal Frame
  let temporalFrame: TemporalFrame = 'NOW';
  if (text.includes('today') || text.includes('this morning')) {
    temporalFrame = 'TODAY';
  } else if (text.includes('overdue') || text.includes('late') || text.includes('missed')) {
    temporalFrame = 'OVERDUE';
  } else if (text.includes('trend') || text.includes('this week') || text.includes('compare to last week')) {
    temporalFrame = 'TREND';
  } else if (text.includes('history') || text.includes('last month') || text.includes('all time')) {
    temporalFrame = 'HISTORICAL';
  } else if (text.includes('schedule') || text.includes('tomorrow') || text.includes('upcoming')) {
    temporalFrame = 'SCHEDULED';
  } else if (text.includes('next') || text.includes('after this')) {
    temporalFrame = 'NEXT';
  } else if (text.includes('recently') || text.includes('yesterday') || text.includes('just now')) {
    temporalFrame = 'RECENT';
  }

  // 2. Action / Mutation Intents
  if (
    text.startsWith('move ') ||
    text.startsWith('assign ') ||
    text.startsWith('transfer ') ||
    text.startsWith('reassign ') ||
    text.startsWith('activate ') ||
    text.startsWith('deactivate ') ||
    text.startsWith('delete ') ||
    text.startsWith('update ')
  ) {
    return {
      intent: 'EXECUTE_ACTION',
      confidence: 0.95,
      temporalFrame,
      requiresMutation: true,
      requiredDepth: 'ACTION',
      suggestedTools: ['assignLead', 'updateLeadStage'],
    };
  }

  // 3. Draft / Compose Intents
  if (text.includes('draft') || text.includes('write reply') || text.includes('compose') || text.includes('email to')) {
    return {
      intent: 'DRAFT',
      confidence: 0.9,
      temporalFrame,
      requiresMutation: false,
      requiredDepth: 'ACTION',
      suggestedTools: ['draftReply'],
    };
  }

  // 4. Diagnostic & Root-Cause Intents
  if (
    text.includes('why did') ||
    text.includes("what's wrong") ||
    text.includes('what happened') ||
    text.includes('diagnose') ||
    text.includes('troubleshoot') ||
    text.includes('why is it paused')
  ) {
    return {
      intent: 'DIAGNOSE',
      confidence: 0.92,
      temporalFrame,
      requiresMutation: false,
      requiredDepth: 'DIAGNOSTIC',
      suggestedTools: ['getSystemHealth', 'getSequencePerformance'],
    };
  }

  // 5. Prioritize / "What Needs Attention" Intents
  if (
    text.includes('what needs attention') ||
    text.includes('prioritize') ||
    text.includes('what should i do') ||
    text.includes('who should i call') ||
    text.includes('who to contact next')
  ) {
    return {
      intent: 'PRIORITIZE',
      confidence: 0.95,
      temporalFrame,
      requiresMutation: false,
      requiredDepth: 'EXECUTIVE',
      suggestedTools: ['searchLeads', 'getQueueStatus'],
    };
  }

  // 6. Coaching Intents
  if (text.includes('coach') || text.includes('rep performance') || text.includes('how is brandon doing')) {
    return {
      intent: 'COACH',
      confidence: 0.88,
      temporalFrame,
      requiresMutation: false,
      requiredDepth: 'DEEP',
      suggestedTools: ['getRepMetrics'],
    };
  }

  // 7. Standard Lookup / Explain Fallback
  return {
    intent: text.includes('how') || text.includes('explain') ? 'EXPLAIN' : 'LOOKUP',
    confidence: 0.8,
    temporalFrame,
    requiresMutation: false,
    requiredDepth: 'STANDARD',
    suggestedTools: ['searchLeads'],
  };
}

/**
 * Calculates human-readable time offset and temporal category for timestamps.
 */
export function categorizeTemporalDelta(targetDate: Date, referenceDate = new Date()): {
  frame: TemporalFrame;
  relativeString: string;
  isOverdue: boolean;
} {
  const diffMs = referenceDate.getTime() - targetDate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 0) {
    const futureHours = Math.abs(diffHours);
    if (futureHours < 24) return { frame: 'SCHEDULED', relativeString: `in ${Math.round(futureHours)} hours`, isOverdue: false };
    return { frame: 'SCHEDULED', relativeString: `in ${Math.round(futureHours / 24)} days`, isOverdue: false };
  }

  if (diffHours <= 2) {
    return { frame: 'NOW', relativeString: 'just now', isOverdue: false };
  }
  if (diffHours <= 24) {
    return { frame: 'TODAY', relativeString: `${Math.round(diffHours)} hours ago`, isOverdue: false };
  }
  if (diffHours <= 48) {
    return { frame: 'RECENT', relativeString: 'yesterday', isOverdue: false };
  }
  if (diffHours <= 168) {
    return { frame: 'TREND', relativeString: `${Math.round(diffHours / 24)} days ago`, isOverdue: true };
  }
  return { frame: 'HISTORICAL', relativeString: `${Math.round(diffHours / 24)} days ago`, isOverdue: true };
}
