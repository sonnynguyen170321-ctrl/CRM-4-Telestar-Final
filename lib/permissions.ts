import type { UserRole } from '@/context/AppContext';

/**
 * Client-side mirror of `canImportExport` in lib/auth.ts — for UI gating only.
 * The server still enforces this; never rely on the client check for security.
 * Team Lead is intentionally excluded from import/export.
 */
export function canImportExport(role: UserRole): boolean {
  // Every role from sdr upward. team_lead was the one gap: a rep could import, the rep's own
  // lead could not, and nothing recorded why. What each role may do *with* an import is bounded
  // elsewhere — assignee defaults to self and anyone else must pass canAccessUser (pod scoping),
  // and a campaign must pass canReferenceCampaign — so widening this list widens who may start
  // an import, not what it can reach.
  return (
    role === 'director' ||
    role === 'floor_manager' ||
    role === 'team_lead' ||
    role === 'leadgen_manager' ||
    role === 'leadgen' ||
    role === 'sdr'
  );
}
