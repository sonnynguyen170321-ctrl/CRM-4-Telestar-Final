import { describe, it, expect } from 'vitest';
import { needsRoutingMetadata, POOL_MODES_WITH_ROUTING_ACTIONS } from '@/lib/leadgen/poolModes';

/**
 * The routing dialogs need campaigns and reps loaded, in every mode that offers them.
 *
 * `PoolBrowser` rendered the Tag and Convert buttons in both `pool` and `routing`, but fetched
 * the campaign and rep lists only in `routing`. On the Internal Database tab the convert dialog
 * therefore opened with an empty campaign dropdown — "Select campaign (required)" and nothing
 * to select — and no reps, so the action could never be completed. Observed on production
 * 2026-08-27: `select[3]` held exactly one option and the rep list was empty.
 *
 * The `not converted` badge opens that same dialog from the Internal Database tab, so the
 * mismatch turned a shortcut meant to rescue stranded records into a dead end.
 */
describe('needsRoutingMetadata', () => {
  it('loads metadata for the Internal Database tab, which offers Tag and Convert', () => {
    expect(needsRoutingMetadata('pool')).toBe(true);
  });

  it('loads metadata for the Campaign Routing tab', () => {
    expect(needsRoutingMetadata('routing')).toBe(true);
  });

  it('does not load metadata for the Qualification Queue, which offers neither action', () => {
    expect(needsRoutingMetadata('qualify')).toBe(false);
  });

  it('agrees with the list of modes that render the routing actions', () => {
    // One source of truth: if a mode gains the buttons it gains the fetch with them.
    for (const mode of POOL_MODES_WITH_ROUTING_ACTIONS) {
      expect(needsRoutingMetadata(mode)).toBe(true);
    }
  });
});
