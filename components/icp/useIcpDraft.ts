'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IcpVersionRulesV2 } from '@telestar/core-scoring/rules/schema-v2';

import type { IcpVersion } from '@/components/icp/icpClient';
import {
  clearIcpDraft,
  loadIcpDraft,
  saveIcpDraft,
  shouldPersistIcpDraft,
} from '@/lib/leadgen/icpDraftRecovery';
import { managerSimplificationNotes } from '@/lib/leadgen/icpManagerRules';
import { describeScoringProblem, hasUnsavedRules } from '@/lib/leadgen/icpScoringProblem';

/**
 * The editing state of one ICP version: the working copy of its rules, whether it differs from
 * what the server holds, recovery of unsaved edits from this browser session, the leave-page
 * warning, and the legacy-rule simplification notes. Shared by Automation and the campaign ICP page
 * so both treat unsaved work the same way.
 */
export function useIcpDraft(version: IcpVersion | null) {
  const [rules, setRules] = useState<IcpVersionRulesV2 | null>(null);
  const [rulesVersionId, setRulesVersionId] = useState('');
  const [recovered, setRecovered] = useState(false);

  const reset = useCallback(() => {
    setRules(null);
    setRulesVersionId('');
    setRecovered(false);
  }, []);

  useEffect(() => {
    if (!version?.rulesJson) {
      reset();
      return;
    }
    const restored = loadIcpDraft(window.sessionStorage, version.id, version.updatedAt);
    setRules(structuredClone(restored ?? version.rulesJson));
    setRulesVersionId(version.id);
    setRecovered(Boolean(restored));
  }, [version, reset]);

  const dirty = hasUnsavedRules(rules, rulesVersionId, version);
  const advanced = useMemo(() => (rules ? managerSimplificationNotes(rules) : []), [rules]);
  const problem = rules ? describeScoringProblem(rules) : null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!version || !rules || !shouldPersistIcpDraft(dirty, rulesVersionId, version.id)) return;
    saveIcpDraft(window.sessionStorage, version.id, version.updatedAt, rules);
  }, [dirty, rules, rulesVersionId, version]);

  /** Forget the browser-session copy of this version's edits (after a save, or a discard). */
  const clearRecovery = useCallback(() => {
    if (version) clearIcpDraft(window.sessionStorage, version.id);
    setRecovered(false);
  }, [version]);

  return {
    rules,
    setRules,
    dirty,
    recovered,
    advanced,
    problem,
    /** Saving is needed before publishing: unsaved edits, or legacy rules the save will simplify. */
    needsSave: dirty || advanced.length > 0,
    reset,
    clearRecovery,
  };
}

/** The confirmation shown before a save or edit that would drop legacy criteria. */
export function confirmSimplification(advanced: string[]): boolean {
  return (
    advanced.length === 0 ||
    window.confirm(
      [
        'This legacy ICP cannot be represented exactly by the simple editor.',
        'Continuing may remove criteria or broaden the employee range:',
        ...advanced.map((criterion) => `- ${criterion}`),
        '',
        'Continue with simplification?',
      ].join('\n'),
    )
  );
}
