# `.agent/generated/` — derived facts

**Never hand-edited.** Every file here is produced by `npm run agent -- facts` from the code
that defines the fact. A generator owns its output; editing it makes the next run a silent
revert and the value untrustworthy in the meantime.

Populated in phase 3:

| File | Derived from |
|---|---|
| `project-facts.json` | `package.json`, repository layout |
| `role-map.json` | `prisma/schema.prisma`, `lib/auth.ts`, `lib/podScoping.ts` |
| `route-map.json` | `app/**` |
| `ai-contract.json` | `lib/ai/registry.ts` |
| `env-contract.json` | `lib/env.ts` |
| `queue-map.json` | `workers/**`, `lib/queue/**` |

Authorities are declared in [`../registry/sources.yaml`](../registry/sources.yaml).
