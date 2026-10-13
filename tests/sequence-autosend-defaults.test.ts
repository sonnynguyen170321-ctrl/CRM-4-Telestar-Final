import { describe, expect, it } from 'vitest';
import { resolveAutoComplete } from '@/lib/sequences/steps';

/** An email step with a template sends itself unless the caller says otherwise. */
describe('the auto-send default for a step', () => {
  it('is on for an email step with a template', () => {
    expect(resolveAutoComplete({ channel: 'email', templateId: 't1' })).toBe(true);
  });
  it('is off for an email step with no template, and for other channels', () => {
    expect(resolveAutoComplete({ channel: 'email', templateId: null })).toBe(false);
    expect(resolveAutoComplete({ channel: 'phone', templateId: 't1' })).toBe(false);
  });
  it('respects an explicit choice either way', () => {
    expect(resolveAutoComplete({ channel: 'email', templateId: 't1', autoComplete: false })).toBe(false);
    expect(resolveAutoComplete({ channel: 'email', templateId: null, autoComplete: true })).toBe(true);
  });
});
