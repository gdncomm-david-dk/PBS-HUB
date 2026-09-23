import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/generated/**", "**/out/**", "**/node_modules/**", "solution/**", "shared/assets.generated.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
