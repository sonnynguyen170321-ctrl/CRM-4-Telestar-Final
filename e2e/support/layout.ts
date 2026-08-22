import type { Page } from '@playwright/test';

/**
 * Wait until the document has stopped changing width before measuring it.
 *
 * `e2e/roles/desktop-gate.spec.ts` navigated with `waitUntil: 'domcontentloaded'` and measured
 * `scrollWidth - clientWidth` immediately afterwards. Several parts of the app mount only on
 * the client — `ClientLayoutAddons` loads the AI assistant with `dynamic(..., { ssr: false })` —
 * so the measurement happened while components were still arriving. On CI it read a transient
 * 59px of overflow at 1024x768 and failed the release gate; the identical commit re-run passed.
 *
 * A gate that fails at random is the mirror of a gate that can never fail: both make the result
 * uninformative. Polling for "overflow is now fine" would be the wrong repair — the observed
 * failure was a LATE element ADDING width, so a poll-until-pass would have sampled the good
 * early state and stopped looking. What the assertion actually needs is to run once, after the
 * layout has settled.
 *
 * Settled means the width has been identical for `stableSamples` consecutive animation frames.
 * Frames rather than a fixed sleep, because a slow CI runner deserves more wall-clock time, not
 * a flakier answer.
 *
 * @returns the horizontal overflow in px, measured once the width stopped moving
 */
export async function settledHorizontalOverflow(
  page: Page,
  { stableSamples = 5, timeoutMs = 10_000 }: { stableSamples?: number; timeoutMs?: number } = {},
): Promise<number> {
  // Frame stability ALONE is not enough, and getting that wrong is how the first version of
  // this helper still missed the defect: the page is quiet for many frames while a dynamic
  // import is still in flight, so five identical frames arrive long before the component that
  // widens the document. Wait for the network to go idle first — that is what tells us the
  // `ssr: false` chunks have actually landed — and only then look for a stable width.
  await page.waitForLoadState('networkidle');

  return page.evaluate(
    async ([samplesNeeded, budgetMs]) => {
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const width = () => document.documentElement.scrollWidth;

      const deadline = performance.now() + budgetMs;
      let last = width();
      let stable = 0;

      while (performance.now() < deadline) {
        await nextFrame();
        const current = width();
        if (current === last) {
          stable += 1;
          if (stable >= samplesNeeded) break;
        } else {
          // Something mounted or reflowed. Start counting again from this width.
          stable = 0;
          last = current;
        }
      }

      // On timeout, report what is on screen now rather than throwing: a document whose width
      // genuinely never settles is a real defect, and the caller's assertion should be the
      // thing that says so.
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    },
    [stableSamples, timeoutMs] as const,
  );
}
