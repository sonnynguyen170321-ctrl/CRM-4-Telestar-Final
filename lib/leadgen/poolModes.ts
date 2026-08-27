/**
 * Which pool console modes offer campaign/rep routing, and therefore need that metadata.
 *
 * Kept next to each other so the two can never drift again: the buttons were rendered in
 * `pool` and `routing`, while the campaign and rep lists were fetched only in `routing`. The
 * Internal Database tab's convert dialog opened with nothing to select and no way to finish.
 */
export type PoolBrowserMode = 'pool' | 'qualify' | 'routing';

/** Modes whose toolbar renders "Tag for Campaign / SDR" and "Convert to Leads". */
export const POOL_MODES_WITH_ROUTING_ACTIONS: readonly PoolBrowserMode[] = ['pool', 'routing'];

/** True when this mode's dialogs need the campaign and assignable-rep lists loaded. */
export function needsRoutingMetadata(mode: PoolBrowserMode): boolean {
  return POOL_MODES_WITH_ROUTING_ACTIONS.includes(mode);
}
