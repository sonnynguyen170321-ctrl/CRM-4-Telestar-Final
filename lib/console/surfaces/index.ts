import type { SessionUser } from '@/lib/auth';
import type { AiConsole } from '../aiConsole';
import { buildDirectorSurface } from './director';
import { buildFloorManagerSurface } from './floorManager';
import { buildLeadgenManagerSurface } from './leadgenManager';
import { buildSdrSurface } from './sdr';
import { buildTeamLeadSurface } from './teamLead';
import { surfaceKeyForRole, type RoleSurface } from './types';

export * from './types';
export { HANDOFF_SLA_HOURS, REENGAGEMENT_GAP_HOURS, STALLED_CONVERSATION_HOURS } from './shared';

/**
 * One product, one dispatch (Phase 9).
 *
 * A role gets the surface its responsibility implies. There is no per-role feature flag, no
 * separate dashboard app, and no way for a role to ask for another role's surface: the key is
 * derived from the session, and every builder scopes with the CRM's own pod walk underneath. A
 * Team Lead calling this gets their pod because `computeVisibleUserIds` says so, not because the
 * client asked nicely.
 *
 * The SDR builder takes the already-built console so the board and the surface cannot report
 * different counts for the same bucket.
 */
export async function buildRoleSurface(
  user: SessionUser,
  console_: AiConsole,
  now: Date = new Date()
): Promise<RoleSurface> {
  switch (surfaceKeyForRole(user.role)) {
    case 'director':
      return buildDirectorSurface(user, now);
    case 'floor_manager':
      return buildFloorManagerSurface(user, now);
    case 'team_lead':
      return buildTeamLeadSurface(user, now);
    case 'leadgen_manager':
      return buildLeadgenManagerSurface(user);
    default:
      return buildSdrSurface(user, console_, now);
  }
}
