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
  }
]);

export default eslintConfig;
