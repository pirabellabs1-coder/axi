import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".tmp-*", "scripts/**/*.cjs", ".next/**", "out/**", "build/**", "next-env.d.ts", ".claude/**", ".local/**", "design-system/**", "e2e-report/**", "playwright-report/**", "test-results/**"]),
  {
    rules: {
      // Textes français : les apostrophes dans le JSX sont voulues et lisibles.
      "react/no-unescaped-entities": "off",
      // Synchronisation d'état à partir des props/URL : toléré, à surveiller.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

eslintConfig.push({
  // Fixtures Playwright : le paramètre `use` n'est pas le hook React.
  files: ["e2e/**"],
  rules: { "react-hooks/rules-of-hooks": "off" },
});

export default eslintConfig;
