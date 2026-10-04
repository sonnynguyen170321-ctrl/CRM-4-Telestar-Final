'use client';

import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';

import { useToast } from '@/context/ToastContext';
import { readApiError } from '@/lib/api/client';
import { DEFAULT_SEQUENCE_RULES, type SequenceRules } from '@/lib/sequences/rules';

const SETTINGS: Array<{ key: keyof SequenceRules; label: string; detail: string }> = [
  {
    key: 'sendOnWeekends',
    label: 'Send on weekends',
    detail: 'Steps may land on Saturday and Sunday in the lead’s timezone. Off: they move to Monday.',
  },
  {
    key: 'stopOnCompanyReply',
    label: 'Stop when someone at the company replies',
    detail:
      'Any reply from a person at the company — interest, a question, an unsubscribe or a “no” — pauses this sequence for their colleagues: same account, or same company email domain. Out-of-office replies do not count; personal addresses such as gmail.com never match.'
  },
  {
    key: 'excludeLeadsInOtherSequences',
    label: 'Refuse leads already in another sequence',
    detail:
      'Adding a lead that is running a different sequence is refused. Switching a lead into this one still works. It does not stop this sequence’s leads from being added to other sequences.',
  },
];

/** What every sequence does, whatever its settings — shown so nobody has to guess. */
const ALWAYS_ON = [
  'A reply pauses every sequence the lead is in, and hands a real conversation to the owner',
  'An out-of-office reply pauses the lead and proposes a date to resume',
  'An unsubscribe or a "not interested" ends all of the lead’s sequences',
  'A bounce pauses the lead’s sequences and blocks the address',
  'Moving a lead to Meeting booked pauses its sequences; Won or Lost, or archiving it, ends them',
  'Every email is checked against the suppression list right before it is sent',
  'Each mailbox stays within its daily sending cap; the rest waits for the next window',
];

/**
 * Sequence rules (lib/sequences/rules.ts). Each switch here is enforced by the engine; the list
 * below it is the behaviour every sequence has regardless.
 */
export function SequenceRulesPanel({ sequenceId }: { sequenceId: string }) {
  const { showToast } = useToast();
  const [rules, setRules] = useState<SequenceRules>(DEFAULT_SEQUENCE_RULES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const res = await fetch(`/api/sequences/${sequenceId}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = await res.json();
      const sequence = data.sequence ?? data;
      setRules({
        sendOnWeekends: Boolean(sequence.sendOnWeekends),
        stopOnCompanyReply: Boolean(sequence.stopOnCompanyReply),
        excludeLeadsInOtherSequences: Boolean(sequence.excludeLeadsInOtherSequences),
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sequenceId]);

  async function toggle(key: keyof SequenceRules, value: boolean) {
    const previous = rules;
    setRules({ ...rules, [key]: value });
    setSaving(true);
    try {
      const res = await fetch(`/api/sequences/${sequenceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        setRules(previous);
        showToast(await readApiError(res, 'Could not save the rule'), 'error');
        return;
      }
      showToast('Rule saved — applies from now on', 'success');
    } catch {
      setRules(previous);
      showToast('Network error saving the rule', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-card rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
        <ListChecks className="h-4 w-4 text-brand-red" aria-hidden="true" />
        Rules
      </h3>
      <p className="mt-1 max-w-[62ch] text-xs leading-5 text-text-secondary">
        All off by default. A change applies to steps scheduled and replies received from now on.
      </p>
      <div className="mt-4 space-y-2">
        {SETTINGS.map((setting) => (
          <label
            key={setting.key}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-card-border px-3 py-2.5"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-brand-red"
              checked={rules[setting.key]}
              disabled={!loaded || saving}
              onChange={(e) => void toggle(setting.key, e.target.checked)}
            />
            <span>
              <span className="block text-xs font-semibold text-text-primary">{setting.label}</span>
              <span className="block text-[11px] leading-4 text-text-secondary">{setting.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <h4 className="mt-5 text-xs font-semibold text-text-primary">Always on</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-4 text-text-secondary">
        {ALWAYS_ON.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  );
}
