import { describe, it, expect } from 'vitest';
import {
  AGENT_SLA_ORDER,
  AGENT_SLA_PRIORITY,
  outranks,
  priorityForSlaClass,
  slaClassForWorkOrderType,
  type AgentSlaClass,
} from '@/lib/agent/priorities';
import { ALL_WORK_ORDER_TYPES } from '@/lib/workorders/types';
import { JobType, QUEUES, jobQueue } from '@/lib/bullmq/types';

/**
 * The SLA priority contract (Revenue AI Phase 6b).
 *
 * Pure — no Redis, no database. ARCHITECTURE §13 states the ordering as a product requirement,
 * and the reason is one sentence: **bulk research must never delay a handoff.** These tests pin
 * the ordering itself rather than any particular producer, because Phase 6b only ships one
 * producer and the contract has to be right before the other three arrive.
 */

describe('agent SLA priority ordering', () => {
  it('declares all four classes, most urgent first', () => {
    expect(AGENT_SLA_ORDER).toEqual([
      'prospect_reply',
      'interactive_command',
      'work_order',
      'bulk_research',
    ]);
  });

  it('assigns a priority to every declared class and nothing else', () => {
    expect(Object.keys(AGENT_SLA_PRIORITY).sort()).toEqual([...AGENT_SLA_ORDER].sort());
  });

  it('numbers the classes so that declaration order is queue order', () => {
    // BullMQ runs *lower* numbers first. This is the single most likely thing for a future
    // edit to invert, so the assertion derives the expectation from the declared order rather
    // than restating the numbers.
    const priorities = AGENT_SLA_ORDER.map(priorityForSlaClass);
    const ascending = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(ascending);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('ranks each class above every class declared after it', () => {
    for (let i = 0; i < AGENT_SLA_ORDER.length; i += 1) {
      for (let j = i + 1; j < AGENT_SLA_ORDER.length; j += 1) {
        const higher = AGENT_SLA_ORDER[i];
        const lower = AGENT_SLA_ORDER[j];
        expect(outranks(higher, lower), `${higher} should outrank ${lower}`).toBe(true);
        expect(outranks(lower, higher), `${lower} must not outrank ${higher}`).toBe(false);
      }
    }
  });

  it('puts a prospect reply ahead of bulk research — the rule the ordering exists for', () => {
    expect(outranks('prospect_reply', 'bulk_research')).toBe(true);
    expect(priorityForSlaClass('prospect_reply')).toBeLessThan(
      priorityForSlaClass('bulk_research')
    );
  });

  it('leaves numeric room to insert a class without renumbering the others', () => {
    // Adjacent priorities separated by 1 would force a renumber to slot anything between them,
    // and a renumber silently reorders every job already sitting in the queue.
    const sorted = [...AGENT_SLA_ORDER].map(priorityForSlaClass).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(1);
    }
  });
});

describe('work order types map to an SLA class', () => {
  it('classifies every work order type', () => {
    for (const type of ALL_WORK_ORDER_TYPES) {
      const slaClass = slaClassForWorkOrderType(type);
      expect(AGENT_SLA_ORDER, `${type} produced an unknown class`).toContain(slaClass);
    }
  });

  it('treats batch work as bulk research so it cannot crowd out a handoff', () => {
    expect(slaClassForWorkOrderType('research_batch')).toBe('bulk_research');
    expect(slaClassForWorkOrderType('prospect_batch')).toBe('bulk_research');
  });

  it('treats prospect-facing and assistance orders as ordinary work order priority', () => {
    for (const type of ['outreach_launch', 'reply_review', 'followup'] as const) {
      expect(slaClassForWorkOrderType(type)).toBe('work_order');
    }
  });

  it('never gives a work order the reply or interactive priority', () => {
    // Those two belong to producers that do not exist yet. A work order silently claiming
    // handoff priority would defeat the ordering the moment those producers land.
    const reserved: AgentSlaClass[] = ['prospect_reply', 'interactive_command'];
    for (const type of ALL_WORK_ORDER_TYPES) {
      expect(reserved).not.toContain(slaClassForWorkOrderType(type));
    }
  });
});

describe('the agent queue is part of the existing BullMQ system', () => {
  it('registers an agent queue rather than an agent-specific job store', () => {
    expect(QUEUES.AGENT).toBe('agent');
  });

  it('routes the work order job to the agent queue', () => {
    expect(jobQueue(JobType.AGENT_EXECUTE_WORK_ORDER)).toBe(QUEUES.AGENT);
  });

  it('does not route agent work onto another queue', () => {
    for (const jobType of [JobType.EMAIL_SEND, JobType.SEQUENCE_ADVANCE, JobType.IMPORT_PARSE]) {
      expect(jobQueue(jobType)).not.toBe(QUEUES.AGENT);
    }
  });
});
