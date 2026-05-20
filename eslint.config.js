// @ts-check
/**
 * ESLint flat config (v9+).
 *
 * Rule selection follows the "modern, widely accepted" baseline:
 *   - typescript-eslint recommended (no type-aware rules — those are slower
 *     and noisier; we already run `tsc --noEmit` for type checking).
 *   - react-hooks recommended (catches the most common React bugs).
 *   - react-refresh for Vite HMR safety.
 *   - eslint-config-prettier last to disable any stylistic rules that
 *     conflict with Prettier — Prettier owns formatting.
 *
 * Stylistic concerns (quotes, semicolons, indentation, trailing commas)
 * are handled by Prettier (.prettierrc.json), not ESLint.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
    // Global ignores.
    {
        ignores: [
            "dist/**",
            "build/**",
            "src-tauri/target/**",
            "src-tauri/target-test/**",
            "node_modules/**",
            "spec/generated/**",
            "docs/screenshots/**",
            "tests/screenshots/out/**",
            "tests/_legacy-removed-task13/**",
            "tests/_legacy-removed-conform-restructure/**",
            "*.config.js",
            "*.config.ts",
            "scripts/**",
        ],
    },

    // Base recommended rules.
    js.configs.recommended,
    ...tseslint.configs.recommended,

    // Project-wide rule tuning.
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
        },
        rules: {
            // TypeScript already enforces unused locals via tsconfig; let it.
            // Keep ESLint quiet so noise doesn't drown the genuine warnings.
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            // `any` shows up legitimately at constraint-handler boundaries
            // (the `c: never` cast pattern). Warn, don't error.
            "@typescript-eslint/no-explicit-any": "warn",
            // Allow ts-expect-error with a description; ban naked ts-ignore.
            "@typescript-eslint/ban-ts-comment": [
                "error",
                {
                    "ts-expect-error": "allow-with-description",
                    "ts-ignore": true,
                    "ts-nocheck": true,
                    "ts-check": false,
                },
            ],
            // Empty object type {} is occasionally useful as a placeholder.
            "@typescript-eslint/no-empty-object-type": "off",
            // We use `interface I {}` for nominal-style typing in a few places.
            "@typescript-eslint/no-empty-interface": "off",
        },
    },

    // React-specific rules for source files.
    {
        files: ["src/**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
        },
    },

    // Tests: loosen a couple of rules that fight test conventions.
    {
        files: ["tests/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
        },
    },

    // Prettier — must come LAST to disable stylistic rules.
    prettierConfig,
);
