import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // `_name` means "deliberately discarded" throughout this codebase — a destructure that
      // drops a field, or a caught error nobody inspects. Only args honoured that convention
      // before, so intentional discards like `const { password: _omitted, ...rest }` still
      // warned and pushed people toward deleting code that is doing its job.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_"
        }
      ],
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    // `.cjs` is CommonJS by definition — `require()` is the only import form the format has, so
    // `no-require-imports` is not reporting a problem there, it is reporting the file extension.
    // These are operational entry points (`scripts/build.cjs`, `scripts/worker-start.cjs`) that
    // work and are deliberately not ESM; converting them for stylistic purity would change how
    // production processes start, which is a real risk taken for no benefit.
    //
    // Narrow on purpose: this turns off exactly one rule for exactly the file type where it
    // cannot apply, rather than excluding `scripts/` from linting.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    // `packages/*` is shared by two apps with two different database schemas (Tenant/Account/Contact
    // in this app, V2Organization/V2Company/V2Contact in apps/leadgen). The moment a package imports
    // a Prisma client or reaches into an app via `@/`, it is bound to one of those schemas and stops
    // being shareable — which is the entire reason the code was extracted.
    //
    // This is a rule rather than a convention because the failure is silent: the import compiles, the
    // tests pass in whichever app ran them, and the coupling is only discovered when the other app
    // breaks.
    files: ["packages/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@prisma/client", "@prisma/client/*", "**/generated/prisma", "**/generated/prisma/*"],
              message:
                "packages/* must stay database-agnostic. Take the data as an argument and let the app's adapter do the query."
            },
            {
              group: ["@/*"],
              message:
                "packages/* must not import application code. Move the shared logic into a package, or pass it in."
            }
          ]
        }
      ]
    }
  }
]);

export default eslintConfig;
