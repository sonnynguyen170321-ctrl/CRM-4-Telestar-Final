/**
 * Role facts, with no authentication machinery behind them.
 *
 * These live apart from `lib/auth.ts` because that module pulls in next-auth, which cannot be
 * imported from a unit test. A rule about who counts as a manager should be testable without
 * standing up an auth stack — and the one time it was not, the two authentication paths drifted
 * apart and produced a privilege escalation (TEL-P0-005).
 */

export type UserRole =
  | 'director'
  | 'floor_manager'
  | 'team_lead'
  | 'sdr'
  | 'leadgen_manager'
  | 'leadgen';

/**
 * Roles that manage the CRM floor. `leadgen_manager` is deliberately absent: it manages the
 * leadgen pool, which is a different authority, and `requireManager()` guards CRM endpoints.
 */
export const MANAGER_ROLES: readonly UserRole[] = ['director', 'floor_manager', 'team_lead'];

/**
 * Whether this user manages anyone — a manager role, or an individual contributor with active
 * reports.
 *
 * One function, used by both authentication paths on purpose. The API-key path used to set
 * `isManager: true` unconditionally while the session path derived it, so a key minted by an
 * SDR authenticated as a manager: `requireManager()` accepts anyone carrying `isManager`, and
 * `POST /api/developer/keys` is gated only by `requireAuth()`, so any authenticated user could
 * mint one. A key must never carry more authority than the person who created it.
 */
export function deriveIsManager(role: UserRole, activeReportCount: number): boolean {
  return activeReportCount > 0 || MANAGER_ROLES.includes(role);
}
