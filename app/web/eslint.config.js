import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs["recommended"].rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
    },
    plugins: {
      svelte: sveltePlugin,
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
    },
  },
];
