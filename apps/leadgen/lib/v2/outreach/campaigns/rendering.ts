import { createHash } from "node:crypto";
import { Liquid } from "liquidjs";

const liquid = new Liquid({
  dynamicPartials: false,
  ownPropertyOnly: true,
  strictFilters: true,
  strictVariables: true,
  lenientIf: true,
  templates: {},
  parseLimit: 100_000,
  renderLimit: 1_000,
  memoryLimit: 1_000_000,
});

export class CampaignRenderError extends Error {
  constructor(
    message: string,
    readonly unresolvedVariables: string[] = []
  ) {
    super(message);
    this.name = "CampaignRenderError";
  }
}

export async function renderCampaignTemplate(input: {
  template: string;
  context: Record<string, unknown>;
  requiredVariables?: readonly string[];
  seed: string;
}): Promise<string> {
  const unresolved = (input.requiredVariables ?? []).filter(
    (variable) => isMissing(readPath(input.context, variable))
  );
  if (unresolved.length > 0) {
    throw new CampaignRenderError(
      "Required campaign variables are unresolved: " + unresolved.join(", "),
      unresolved
    );
  }
  let rendered: string;
  try {
    rendered = await liquid.parseAndRender(input.template, input.context);
  } catch (error) {
    throw new CampaignRenderError(
      error instanceof Error ? error.message : "Campaign template rendering failed."
    );
  }
  return renderDeterministicSpintax(rendered, input.seed);
}

export function renderDeterministicSpintax(template: string, seed: string): string {
  let output = template;
  let pass = 0;
  const pattern = /\{([^{}]*\|[^{}]*)\}/g;
  while (pattern.test(output) && pass < 20) {
    pattern.lastIndex = 0;
    let occurrence = 0;
    output = output.replace(pattern, (_match, choices: string) => {
      const options = choices.split("|");
      const digest = createHash("sha256")
        .update(seed + ":" + pass + ":" + occurrence++)
        .digest();
      return options[digest.readUInt32BE(0) % options.length];
    });
    pass++;
  }
  return output;
}

export function findUnresolvedRequiredVariables(
  context: Record<string, unknown>,
  requiredVariables: readonly string[]
): string[] {
  return requiredVariables.filter((variable) => isMissing(readPath(context, variable)));
}

function readPath(context: Record<string, unknown>, path: string): unknown {
  let value: unknown = context;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function isMissing(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}