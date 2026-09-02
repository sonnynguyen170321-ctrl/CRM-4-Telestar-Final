// W8: the canonical campaign merge-variable catalog. These mirror the `predefined` keys
// built in campaignRuntime.buildLeadRenderContext, so the authoring UI advertises exactly
// the variables that resolve at send time. Sample values drive the preview (rendered with
// the real LiquidJS renderer) — they are clearly-labelled EXAMPLE data, never a real lead.

export type CampaignMergeVariable = {
  key: string;
  label: string;
  sample: string;
};

export const CAMPAIGN_MERGE_VARIABLES: readonly CampaignMergeVariable[] = [
  { key: "first_name", label: "Contact first name", sample: "Mai" },
  { key: "last_name", label: "Contact last name", sample: "Nguyen" },
  { key: "name", label: "Contact full name", sample: "Mai Nguyen" },
  { key: "contact", label: "Contact full name (alias)", sample: "Mai Nguyen" },
  { key: "title", label: "Contact job title", sample: "Head of Sales" },
  { key: "email", label: "Recipient email", sample: "mai.nguyen@acme.example" },
  { key: "company", label: "Company name", sample: "Acme Co" },
  { key: "website", label: "Company website", sample: "https://acme.example" },
  { key: "domain", label: "Company domain", sample: "acme.example" },
  { key: "country", label: "Company country", sample: "Vietnam" },
  { key: "project", label: "Project name", sample: "Q3 Outbound" },
  { key: "icp", label: "ICP profile name", sample: "Mid-market SaaS" },
];

/** A representative context for the authoring preview. Mirrors the message-preparation
 *  context shape ({ ...custom, ...predefined, custom }); values are example data. */
export function buildSampleRenderContext(): Record<string, unknown> {
  const predefined = Object.fromEntries(
    CAMPAIGN_MERGE_VARIABLES.map((variable) => [variable.key, variable.sample])
  );
  return { ...predefined, custom: {} };
}
