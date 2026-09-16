/**
 * Whether the machine or the person is expected to act on a sequence step.
 *
 * `workers/sequence.ts` sends one kind of step and refuses the rest:
 *
 *     const isAutoEmail = task.type === 'email' && task.sequenceId !== null;
 *     if (!isAutoEmail) return { status: 'manual_action_required', type: task.type };
 *
 * The enrollments table did not know that. It showed ACTIVE, a due timestamp and a green Run
 * button on every row — including 116 sitting on a LinkedIn step — so an operator watched due
 * dates pass on work the worker was never going to do and reported the engine as broken. Nothing
 * was broken except the promise the screen was making.
 *
 * Kept here rather than inline in the page so the rule is unit-tested against the worker's
 * condition instead of restated in JSX, and so any other surface asking the same question gets
 * the same answer.
 */

export type StepOwner = 'machine' | 'human';

export interface StepOwnership {
  owner: StepOwner;
  /** Short label for the step cell, e.g. `LinkedIn - you`. */
  label: string;
  /** Sentence for a tooltip or empty state. Describes the arrangement, not a fault. */
  reason: string;
  /** Whether "Run Now" can actually execute this step. */
  canRunNow: boolean;
}

/** Channels a person carries out. Anything not sent by the worker belongs here. */
const HUMAN_CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  phone: 'Call',
  whatsapp: 'WhatsApp',
};

export function stepOwnership(taskType: string | null | undefined): StepOwnership {
  if (taskType === 'email') {
    return {
      owner: 'machine',
      label: 'Email - automated',
      reason: 'This step sends automatically when it falls due.',
      canRunNow: true,
    };
  }

  const channel = typeof taskType === 'string' ? taskType.toLowerCase() : null;
  // Fail safe toward "human": a channel this build does not recognise is not one the worker
  // sends, and promising to send it is the failure this module exists to prevent.
  const channelLabel = channel ? HUMAN_CHANNEL_LABELS[channel] ?? channel : null;

  if (!channelLabel) {
    return {
      owner: 'human',
      label: 'No step due',
      reason: 'Nothing is waiting on this enrollment right now.',
      canRunNow: false,
    };
  }

  return {
    owner: 'human',
    label: `${channelLabel} - you`,
    reason: `${channelLabel} steps are done by hand. Complete the task to move this enrollment to the next step.`,
    canRunNow: false,
  };
}
