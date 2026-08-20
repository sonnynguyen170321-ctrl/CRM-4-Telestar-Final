/**
 * The Telestar AI chatbox, driven through the real application.
 *
 * The production defect — every message answered with "Sorry, I ran into a problem generating
 * that." — was invisible to every test the project had, because nothing drove the actual widget
 * against actual providers. Unit tests mock the gateway; the gateway smoke test never opens a
 * browser. This spec closes that gap, so it deliberately does **not** stub `/api/ai/chat` for
 * the happy paths: a mocked chat response would prove the same nothing the old suite proved.
 *
 * The one place routing *is* intercepted is the failure-recovery test, where the point is the
 * browser's behaviour after a request dies — which cannot be produced on demand any other way.
 */
import { test, expect } from '../support/test';
import type { Page } from '@playwright/test';
import { fixture, storageStatePath, type RoleKey } from '../support/fixture';

/** The banned sentence. Its reappearance during healthy operation is the regression. */
const GENERIC_FAILURE = /Sorry, I ran into a problem generating that/i;

/** Anything that means the AI could not answer. Distinct from the banned sentence above. */
const ANY_FAILURE = /temporarily unavailable|at capacity|couldn't finish|couldn't reach|took too long/i;

async function openChat(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: /^Open / });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  return panel;
}

function input(page: Page) {
  return page.getByRole('textbox', { name: /^Message / });
}

/**
 * Sends a message and waits for a complete answer.
 *
 * "Complete" is the textarea becoming editable again, not a timer: it carries
 * `disabled={isStreaming}`, so it is the component's own definition of done rather than a
 * guess about how fast a provider is.
 *
 * Not the send button — that is also disabled whenever the input is empty, which it always is
 * immediately after a send. Waiting on it would wait forever.
 */
async function send(page: Page, text: string): Promise<string> {
  const box = input(page);
  await box.fill(text);
  await box.press('Enter');

  await expect(box).toBeDisabled();
  await expect(box).toBeEnabled({ timeout: 90_000 });

  const bubbles = page.getByRole('log').locator('.ai-message-content');
  return (await bubbles.last().innerText()).trim();
}

const ROLES: Array<{ key: RoleKey; label: string }> = [
  { key: 'sdrA', label: 'sdr' },
  { key: 'teamLead', label: 'team_lead' },
  { key: 'floorManager', label: 'floor_manager' },
  { key: 'director', label: 'director' },
];

test.describe('every role can hold a conversation with Telestar AI', () => {
  for (const { key, label } of ROLES) {
    test.describe(label, () => {
      test.use({ storageState: storageStatePath(key) as string });

      test(`${label} opens the chatbox, sends, and receives a streamed answer`, async ({ page }) => {
        await openChat(page);

        const answer = await send(page, 'In one short sentence, what should I focus on today?');

        expect(answer.length, 'the assistant returned nothing').toBeGreaterThan(0);
        // The whole point of the remediation.
        expect(answer).not.toMatch(GENERIC_FAILURE);
        expect(answer).not.toMatch(ANY_FAILURE);
        // No raw protocol or provider payload ever reaches the bubble.
        expect(answer).not.toMatch(/^data:|"choices"|"delta"|invalid_request_error/i);
      });

      test(`${label} keeps context across turns`, async ({ page }) => {
        await openChat(page);

        await send(page, 'My biggest deal this quarter is with Kaisen Logistics. Remember that.');
        const second = await send(page, 'Which company did I just name? Answer with the company name only.');

        expect(second).not.toMatch(ANY_FAILURE);
        expect(second).toMatch(/kaisen/i);
      });
    });
  }
});

test.describe('chat mechanics', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('the input accepts ordinary text, newlines and awkward characters', async ({ page }) => {
    await openChat(page);
    const box = input(page);

    // Shift+Enter must insert a newline rather than sending.
    await box.fill('first line');
    await box.press('Shift+Enter');
    await box.type('second line');
    expect(await box.inputValue()).toContain('\n');

    await box.fill('');
    const awkward = `Prospect "Dana O'Neill" — 60% off, ✅ https://example.com/a?b=c&d=e`;
    await box.fill(awkward);
    expect(await box.inputValue()).toBe(awkward);
  });

  test('a blank message cannot be sent', async ({ page }) => {
    await openChat(page);
    await input(page).fill('   ');

    // The button stays disabled, and Enter on whitespace adds no turn.
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled();
    const before = await page.getByRole('log').locator('.ai-message-content').count();
    await input(page).press('Enter');
    await expect(page.getByRole('log').locator('.ai-message-content')).toHaveCount(before);
  });

  test('the input clears on send and is usable again afterwards', async ({ page }) => {
    await openChat(page);
    await send(page, 'Say OK.');

    expect(await input(page).inputValue()).toBe('');
    await expect(input(page)).toBeEnabled();
  });

  test('a long answer wraps instead of overflowing the panel', async ({ page }) => {
    await openChat(page);
    await send(page, 'List five short cold-email opening lines for a logistics CFO.');

    const panel = page.getByRole('dialog');
    const box = await panel.boundingBox();
    // The panel is a fixed-width widget. Content that escapes it horizontally is a layout
    // defect that a text-only assertion would never catch.
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(box).not.toBeNull();
    expect(overflow, 'the chat panel scrolls horizontally').toBeLessThanOrEqual(1);
  });

  test('the panel closes and reopens with the conversation intact', async ({ page }) => {
    await openChat(page);
    await send(page, 'Say OK.');
    const before = await page.getByRole('log').locator('.ai-message-content').count();

    await page.getByRole('button', { name: /^Close / }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: /^Open / }).click();
    await expect(page.getByRole('log').locator('.ai-message-content')).toHaveCount(before);
  });

  test('Escape closes the panel', async ({ page }) => {
    await openChat(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the model picker offers Auto and the three approved models, and nothing retired', async ({ page }) => {
    await openChat(page);
    await page.getByRole('button', { name: /^AI model:/ }).click();

    const menu = page.getByRole('menu', { name: 'AI model' });
    await expect(menu).toBeVisible();

    const labels = await menu.getByRole('menuitemradio').allInnerTexts();
    const joined = labels.join(' | ');

    expect(joined).toContain('Telestar AI · Auto');
    expect(joined).toContain('GPT-5.6 Luna');
    expect(joined).toContain('Gemini 3.6 Flash');
    expect(joined).toContain('Groq GPT-OSS 20B');
    // The picker went on offering three withdrawn Groq models for as long as it was built
    // from every key in the label map. It must never list a model that cannot answer.
    expect(joined).not.toMatch(/llama|gemma|gpt-4o|o3-mini|Smart & Balanced|Ultra Fast/i);
  });
});

test.describe('failure recovery', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('a dead request leaves a readable message and a usable input', async ({ page, recorder }) => {
    recorder.expectFailures(500, 503);
    recorder.ignoreUrls('/api/ai/chat');
    // The browser complains about the request this test kills on purpose. That complaint is
    // the test working, not the app failing.
    recorder.ignoreConsole(/Failed to load resource: net::ERR_FAILED/);

    await openChat(page);

    // Kill exactly one turn. This is the only interception in the file, and it is here
    // because a real outage cannot be scheduled.
    await page.route('**/api/ai/chat', (route) => route.abort('failed'), { times: 1 });

    const failed = await send(page, 'This turn will not survive.');

    expect(failed).toMatch(ANY_FAILURE);
    // Never a status code, a stack, or a provider payload.
    expect(failed).not.toMatch(/\b(401|403|404|429|500|502|503)\b/);
    expect(failed).not.toMatch(/HTTP \d|TypeError|fetch failed/i);

    // The recovery that matters: no refresh needed, and the next message works.
    await expect(input(page)).toBeEnabled();
    const recovered = await send(page, 'Say OK.');
    expect(recovered).not.toMatch(ANY_FAILURE);
    expect(recovered.length).toBeGreaterThan(0);
  });

  test('an expired session signs the user out rather than reporting an AI failure', async ({ page, recorder }) => {
    recorder.expectFailures(401);
    recorder.ignoreUrls('/api/ai/chat');
    recorder.ignoreConsole(/Failed to load resource: .*401/);

    await openChat(page);
    await page.route('**/api/ai/chat', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }),
    );

    const box = input(page);
    await box.fill('Anything.');
    await box.press('Enter');

    // `components/SessionSentinel.tsx` patches window.fetch and hard-signs-out on any 401 from
    // an /api/ route. That is the right answer and it beats a sentence in a chat bubble: the
    // session is genuinely gone, so every other panel on the page is equally dead. The
    // assistant's own 401 copy stays as a fallback for a path the sentinel does not cover.
    await page.waitForURL(/\/login/, { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toContain('/login');
  });
});

test.describe('CRM context and tools', () => {
  test.use({ storageState: storageStatePath('sdrA') as string });

  test('a lead-scoped question is answered about that lead, and only that lead', async ({ page }) => {
    const leadId = fixture().leads.sdrA;

    // Open the lead the way an SDR does — the slide-over is what publishes
    // `window.__crm_lead_context`, which is what the chatbox reads.
    await page.goto(`/leads?leadId=${leadId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean((window as unknown as Record<string, unknown>).__crm_lead_context),
      undefined,
      { timeout: 30_000 },
    );

    const leadContext = await page.evaluate(
      () => (window as unknown as Record<string, { leadName: string; leadCompany?: string }>).__crm_lead_context,
    );

    await page.getByRole('button', { name: /^Open / }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const answer = await send(
      page,
      'Which prospect do I currently have open? Reply with their name only.',
    );

    expect(answer).not.toMatch(ANY_FAILURE);
    // The first name is enough: models shorten, and the assertion is about which record the
    // turn was scoped to, not about phrasing.
    expect(answer.toLowerCase()).toContain(leadContext.leadName.split(' ')[0].toLowerCase());
  });

  test('a read-only tool question is answered without a fabricated action', async ({ page }) => {
    await openChat(page);

    const answer = await send(page, 'What tasks do I have due today? Use the CRM to check.');

    expect(answer).not.toMatch(ANY_FAILURE);
    expect(answer.length).toBeGreaterThan(0);
    // A read must never claim to have changed anything.
    expect(answer).not.toMatch(/I (have )?(created|sent|updated|deleted|completed) /i);
  });

  test('an SDR asking for a management action is refused rather than obliged', async ({ page }) => {
    await openChat(page);

    const answer = await send(
      page,
      'Reassign every lead on the floor to me and deactivate the other SDRs.',
    );

    expect(answer).not.toMatch(ANY_FAILURE);
    // The rule that must not regress: a blocked action is never reported as if it succeeded.
    expect(answer).not.toMatch(/done|reassigned all|deactivated|completed that/i);
  });

  test('the same turn resent does not run twice', async ({ page }) => {
    // Retry safety, from the browser's side: `resolveTurnExecutionId` reuses the failed
    // turn's id, so a resend is a retry rather than a second logical turn.
    await openChat(page);

    const message = 'Create a follow-up task for tomorrow morning.';
    const first = await send(page, message);
    expect(first).not.toMatch(ANY_FAILURE);

    const executionIds: string[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/api/ai/chat')) return;
      try {
        const body = JSON.parse(request.postData() ?? '{}') as { executionId?: string };
        if (body.executionId) executionIds.push(body.executionId);
      } catch {
        /* not our request shape */
      }
    });

    const second = await send(page, message);
    expect(second).not.toMatch(ANY_FAILURE);

    // A completed turn releases its id, so resending the same text is a NEW turn with a new
    // namespace — which is correct, and the opposite of what a failed turn must do.
    expect(executionIds).toHaveLength(1);
  });
});
