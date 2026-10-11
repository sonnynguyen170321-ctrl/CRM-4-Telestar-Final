/**
 * The campaign ICP surfaces: creating a campaign asks for an ICP, the campaign page exposes
 * switch / copy / edit / preview / submit / rescore, and the review queue shows a readable diff.
 * Source-level checks, matching how the other UI contracts in this repo are pinned.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { emptyIcpRulesV2 } from '@telestar/core-scoring/rules/emptyIcpRulesV2';

import { applyRequirementPrefill } from '@/lib/leadgen/icpRequirementPrefill';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('new campaign modal', () => {
  const modal = source('components/NewCampaignModal.tsx');

  it('asks for an ICP and sends it with the campaign', () => {
    expect(modal).toContain('ICP *');
    expect(modal).toContain("mode: 'library'");
    expect(modal).toContain("mode: 'custom'");
    expect(modal).toContain('icp,');
  });

  it('preselects the template ICP and says what happens to a custom one', () => {
    expect(modal).toContain('p.isDefault');
    expect(modal).toContain('submit it for review');
    expect(modal).toContain('not scored until you do');
  });

  it('opens the ICP editor after a custom ICP is created', () => {
    expect(modal).toContain('/campaigns/${created.id}/icp');
  });
});

describe('campaign ICP page', () => {
  const panel = source('components/icp/CampaignIcpPanel.tsx');

  it('shows the current ICP, switches, copies, previews on this campaign and offers the rescore', () => {
    expect(panel).toContain('Switch ICP');
    expect(panel).toContain('Make custom ICP');
    expect(panel).toContain('campaignId={campaignId}');
    expect(panel).toContain('RescorePreview');
    expect(panel).toContain('A custom ICP that is still in review cannot be chosen');
  });

  it('is linked from the team campaign detail and the admin campaign list', () => {
    expect(source('components/team/CampaignDetail.tsx')).toContain('/campaigns/${campaignId}/icp');
    expect(source('app/admin/campaigns/page.tsx')).toContain('/campaigns/${c.id}/icp');
  });
});

describe('review queue and editor card', () => {
  it('shows what changes, previews per campaign, and sends back with a note', () => {
    const queue = source('components/icp/IcpReviewQueue.tsx');
    expect(queue).toContain('What changes');
    expect(queue).toContain('Preview on leads');
    expect(queue).toContain('Send back');
    expect(queue).toContain('campaignId={campaign.id}');
  });

  it('labels the rep button for what it does, from the server decision', () => {
    const card = source('components/icp/IcpEditorCard.tsx');
    expect(card).toContain("profile.publishMode === 'submit' ? 'Submit for review' : 'Publish'");
    expect(card).toContain('Waiting for review by a team lead or manager');
  });
});

describe('applyRequirementPrefill', () => {
  const requirement = {
    targetTitles: [' CEO ', 'CEO', 'COO'],
    targetCountries: ['Vietnam'],
    targetIndustries: ['Logistics'],
    companySizeMin: 20,
    companySizeMax: null,
  };

  it('fills what the client asked for, de-duplicated, and sets the industry rule to must-match', () => {
    const out = applyRequirementPrefill(emptyIcpRulesV2('r', 'R'), requirement);
    expect(out.persona.titleAllowlist).toEqual(['CEO', 'COO']);
    expect(out.geography.targetCountries).toEqual(['Vietnam']);
    expect(out.industry).toMatchObject({ mode: 'allowlist', targetIndustries: ['Logistics'] });
    expect(out.size.minEmployees).toBe(20);
    expect(out.size.maxEmployees).toBeUndefined();
  });

  it('leaves the rules alone with no requirement, and never mutates its input', () => {
    const base = emptyIcpRulesV2('r', 'R');
    expect(applyRequirementPrefill(base, null)).toBe(base);
    const before = JSON.stringify(base);
    applyRequirementPrefill(base, requirement);
    expect(JSON.stringify(base)).toBe(before);
  });
});
