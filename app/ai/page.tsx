import AiConsoleView from '@/components/ai/AiConsoleView';

export const metadata = { title: 'AI Command Center — Telestar' };

/**
 * The operating-model board (Revenue AI Phase 9).
 *
 * One screen that answers, in seconds: what is AI doing, what needs a human, what happened, and
 * what happens next. It presents rows the CRM already owns — it is not a second pipeline.
 */
export default function AiConsolePage() {
  return <AiConsoleView />;
}
