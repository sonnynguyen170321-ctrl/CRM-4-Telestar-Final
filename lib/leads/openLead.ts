/**
 * Open a lead's detail slide-over from anywhere in the app.
 *
 * Lead detail is a slide-over panel, never a route — there is no `app/leads/[id]/page.tsx`
 * and there is not meant to be one (`.claude/rules/architecture.md`). Linking to
 * `/leads/{id}` therefore renders a dead anchor: Next prefetches it on hover and logs a
 * 404, and clicking it lands on the not-found page.
 *
 * `app/leads/page.tsx` listens for `crm:open-lead` and opens the panel for the id in the
 * event detail. This helper is that call plus the navigation needed when the caller is on
 * some other route — the same two steps `components/Topbar.tsx` already does for
 * notification `linkTo` values, extracted so the other call sites stop reinventing it as
 * a broken `<Link>`.
 */

export const OPEN_LEAD_EVENT = 'crm:open-lead';

type Router = { push: (href: string) => void };

export function openLeadSlideOver(router: Router, leadId: string): void {
  if (typeof window === 'undefined' || !leadId) return;

  // Dispatch first: when we are already on /leads the listener is mounted and the panel
  // opens immediately. When we are not, /leads mounts after the push and would miss an
  // event fired before it — hence the re-dispatch below.
  window.dispatchEvent(new CustomEvent(OPEN_LEAD_EVENT, { detail: { leadId } }));

  if (!window.location.pathname.startsWith('/leads')) {
    router.push('/leads');
    // The listener attaches on mount, after this tick. Re-fire once the route has had a
    // frame to render so the panel still opens on a cross-page jump.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_LEAD_EVENT, { detail: { leadId } }));
    }, 300);
  }
}
