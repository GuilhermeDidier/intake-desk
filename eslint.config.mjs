import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Pages render on the server (UTC, en-US) and hydrate in the visitor's
    // browser. A locale-less toLocale*() formats differently on each side and
    // React throws a hydration error (#418), so always pass the locale.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/][arguments.length=0]",
          message: 'Pass a locale (e.g. "en-US"): server and browser format differently without one.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
