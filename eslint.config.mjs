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
    // `packages/*` is database-agnostic by contract. It was extracted from the former leadgen app so
    // the scoring, identity, search and research logic has no schema binding; the moment a package
    // imports a Prisma client or reaches into the app via `@/`, it is bound to this schema and the
    // extraction is undone.
    //
    // This is a rule rather than a convention because the failure is silent: the import compiles and
    // the tests pass, and the coupling is only discovered when the package is next reused.
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
