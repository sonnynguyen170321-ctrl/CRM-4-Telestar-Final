/**
 * Send-window validation for sequence steps.
 *
 * Who may set a window is decided by who may edit the sequence (lib/visibility.ts — its owner or a
 * manager above them). There used to be a second rule here limiting windows to Directors and Floor
 * Managers; team leads and SDRs could not save a cadence after touching the time boxes, and the
 * owner removed it (2026-10-06). The AI assistant keeps its own cap on `send_window_change`
 * (lib/agent/capabilities.ts), which is a separate gate.
 *
 * What stays is correctness: the scheduler treats a window with one bound, or with the end not after
 * the start, as no window at all, so accepting one would silently discard what was configured.
 */

interface StepWindowFields {
  order?: number;
  sendWindowStartMinutes?: number | null;
  sendWindowEndMinutes?: number | null;
}

/** The orders of the steps whose window the scheduler could not honour. Empty means all valid. */
export function findInvalidSendWindows(steps: StepWindowFields[]): number[] {
  const invalid: number[] = [];
  for (const [idx, step] of steps.entries()) {
    const start = step.sendWindowStartMinutes ?? null;
    const end = step.sendWindowEndMinutes ?? null;
    const onlyOneBound = (start === null) !== (end === null);
    const inverted = start !== null && end !== null && end <= start;
    if (onlyOneBound || inverted) invalid.push(step.order ?? idx + 1);
  }
  return invalid;
}

export const INVALID_SEND_WINDOW_MESSAGE =
  'A send window needs both a start and an end, with the end after the start';
