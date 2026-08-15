/**
 * Lane F — AI Assistant, Sequences, Templates, Email Health, Settings.
 *
 * Throwaway QA scaffolding. Report only; nothing here mutates app source.
 * Owned personas: vy.hoang@telestar.vn (sdr), dean@telestar.vn (director).
 */
import { test, expect, type Page } from '@playwright/test';
import { attachRecorders, gotoTimed, login, shot, note, type Recorder } from './_helpers';
import { PERSONAS } from './personas';

const LANE = 'F';
const SDR = PERSONAS.sdrLaneF;

/** Opens the global AI widget from whatever page we are on. */
async function openAi(page: Page) {
  const launcher = page.locator('button[aria-label^="Open "]').first();
  await launcher.waitFor({ state: 'visible', timeout: 15000 });
  await launcher.click();
  await page.locator('textarea').first().waitFor({ state: 'visible', timeout: 10000 });
}

async function aiSend(page: Page, text: string) {
  const ta = page.locator('textarea').first();
  await ta.fill(text);
  await ta.press('Enter');
}

/** Last assistant bubble text, once streaming settles. */
async function lastAssistant(page: Page): Promise<string> {
  const bubbles = page.locator('.ai-message-content');
  if ((await bubbles.count()) === 0) return '(NO MESSAGE RENDERED)';
  return (await bubbles.last().innerText()).trim();
}

async function stepLabel(page: Page): Promise<string> {
  const el = page.locator('text=/Setup — Step \\d of 5/').first();
  if (await el.isVisible().catch(() => false)) return (await el.innerText()).trim();
  return '(no setup label)';
}

test.describe.configure({ mode: 'serial' });

test.describe('Lane F — AI assistant', () => {
  let rec: Recorder;

  test.beforeEach(async ({ page }) => {
    rec = attachRecorders(page, LANE);
  });

  test('F1 onboarding: reset, junk answer, resume-after-refresh', async ({ page }) => {
    await login(page, SDR);
    await gotoTimed(page, '/', rec);
    await openAi(page);
    await shot(page, LANE, 'ai-01-opened');

    // Force a clean setup regardless of prior lane state.
    await aiSend(page, 'reset my setup');
    await page.waitForTimeout(2500);
    const afterReset = await lastAssistant(page);
    note(LANE, `F1 after-reset bubble: ${afterReset.slice(0, 200).replace(/\n/g, ' | ')}`);
    await shot(page, LANE, 'ai-02-after-reset');

    expect(await stepLabel(page)).toContain('Step 1 of 5');

    // --- Junk answer probe. GROQ_API_KEY is unset, so the LLM validator is skipped.
    await aiSend(page, 'asdf');
    await page.waitForTimeout(3000);
    const junkReply = await lastAssistant(page);
    const junkStep = await stepLabel(page);
    note(LANE, `F1 junk "asdf" -> step=${junkStep} reply=${junkReply.slice(0, 200).replace(/\n/g, ' | ')}`);
    await shot(page, LANE, 'ai-03-junk-asdf');

    // --- A heuristic-caught non-answer should still be rejected.
    if (junkStep.includes('Step 2 of 5')) {
      await aiSend(page, 'idk');
      await page.waitForTimeout(3000);
      const idkReply = await lastAssistant(page);
      note(LANE, `F1 junk "idk" -> step=${await stepLabel(page)} reply=${idkReply.slice(0, 200).replace(/\n/g, ' | ')}`);
      await shot(page, LANE, 'ai-04-junk-idk');
    }

    rec.flush('F1-ai-onboarding-junk');
  });

  test('F2 onboarding: rejection escape hatch, refresh resumes, completes', async ({ page }) => {
    await login(page, SDR);
    await gotoTimed(page, '/', rec);
    await openAi(page);

    // Should still be mid-setup at Q2 from F1.
    note(LANE, `F2 entry step=${await stepLabel(page)}`);
    await shot(page, LANE, 'ai-05-reopen-midsetup');

    // Escape hatch: MAX_REJECTIONS_PER_STEP=2, so the 3rd "idk" should be accepted.
    for (let i = 0; i < 3; i++) {
      await aiSend(page, 'idk');
      await page.waitForTimeout(2500);
      note(LANE, `F2 idk#${i + 1} -> step=${await stepLabel(page)} :: ${(await lastAssistant(page)).slice(0, 120).replace(/\n/g, ' | ')}`);
    }
    await shot(page, LANE, 'ai-06-escape-hatch');

    // --- Refresh mid-setup: must resume, not restart at Q1.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await openAi(page);
    await page.waitForTimeout(1500);
    const resumed = await stepLabel(page);
    const resumedBubble = await lastAssistant(page);
    note(LANE, `F2 AFTER REFRESH step=${resumed} :: ${resumedBubble.slice(0, 220).replace(/\n/g, ' | ')}`);
    await shot(page, LANE, 'ai-07-after-refresh');
    expect(resumed, 'must not restart at question 1 after a refresh').not.toContain('Step 1 of 5');

    // --- Finish the remaining questions.
    const answers = [
      'VP Sales at 50-500 person SaaS companies',
      'We give SaaS teams outbound pipeline without hiring in-house SDRs',
      'LinkedIn first, then email, then WhatsApp',
      'casual tone, short emails, no jargon',
    ];
    for (const a of answers) {
      if (!(await stepLabel(page)).includes('Setup')) break;
      await aiSend(page, a);
      await page.waitForTimeout(2500);
      note(LANE, `F2 answer "${a.slice(0, 30)}" -> step=${await stepLabel(page)}`);
    }
    await page.waitForTimeout(1500);
    const done = await lastAssistant(page);
    note(LANE, `F2 completion bubble: ${done.slice(0, 300).replace(/\n/g, ' | ')}`);
    await shot(page, LANE, 'ai-08-setup-complete');

    rec.flush('F2-ai-onboarding-complete');
  });

  test('F3 AI degradation: 7 prompts with no provider key', async ({ page }) => {
    test.setTimeout(180000);
    await login(page, SDR);
    await gotoTimed(page, '/', rec);
    await openAi(page);
    await page.waitForTimeout(2500);

    // Morning briefing fires once per day on first open when setup is complete.
    await shot(page, LANE, 'ai-09-morning-briefing');
    note(LANE, `F3 first-open bubble: ${(await lastAssistant(page)).slice(0, 400).replace(/\n/g, ' | ')}`);

    const prompts = [
      'morning brief',
      'what should I focus on today',
      'write a cold email opener',
      'help me handle "not interested"',
      'summarize this lead',
      'prepare me for a call',
      'summarize my day',
    ];

    for (const p of prompts) {
      await aiSend(page, p);
      await page.waitForTimeout(4000);
      const reply = await lastAssistant(page);
      note(LANE, `F3 PROMPT "${p}" => ${reply.slice(0, 260).replace(/\n/g, ' | ')}`);
    }
    await shot(page, LANE, 'ai-10-seven-prompts');

    // Model selector: switch and re-ask.
    const modelBtn = page.locator('button').filter({ hasText: /Smart & Balanced|Ultra Fast|Email & Writing|Creative & Polished/ }).first();
    if (await modelBtn.isVisible().catch(() => false)) {
      await modelBtn.click();
      await page.waitForTimeout(400);
      await shot(page, LANE, 'ai-11-model-menu');
      const gemini = page.locator('button', { hasText: 'Creative & Polished' }).last();
      await gemini.click();
      await page.waitForTimeout(600);
      await aiSend(page, 'write a cold email opener');
      await page.waitForTimeout(4000);
      note(LANE, `F3 GEMINI model reply => ${(await lastAssistant(page)).slice(0, 260).replace(/\n/g, ' | ')}`);
      await shot(page, LANE, 'ai-12-gemini-reply');
    } else {
      note(LANE, 'F3 model selector button NOT FOUND');
    }

    rec.flush('F3-ai-degradation');
  });
});
