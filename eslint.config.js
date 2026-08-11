"use strict";

/*
** ESLint flat config for LuaNode-VM.
** ESLint v9+ uses the flat config format (eslint.config.js).
*/

const globals = require("globals");

module.exports = [
    {
        files: ["src/**/*.js", "*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser,
                ...globals.es2022,
                BigInt: "readonly",
                WorkerGlobalScope: "readonly",
            },
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "no-undef": "error",
            "no-redeclare": "error",
            "no-cond-assign": "error",
            "no-constant-condition": ["error", { checkLoops: false }],
            "no-debugger": "error",
            "no-dupe-keys": "error",
            "no-duplicate-case": "error",
            "no-empty": ["error", { allowEmptyCatch: true }],
            "no-extra-semi": "error",
            "no-irregular-whitespace": "error",
            "no-unreachable": "error",
            "no-useless-escape": "warn",
            "no-var": "warn",
            "prefer-const": "warn",
            "eqeqeq": ["warn", "smart"],
            "semi": ["error", "always"],
            "no-trailing-spaces": "error",
        },
    },
    {
        files: ["tests/**/*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.jest,
                BigInt: "readonly",
            },
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "no-undef": "error",
            "no-redeclare": "error",
            "no-debugger": "error",
            "no-dupe-keys": "error",
            "no-duplicate-case": "error",
            "no-empty": ["error", { allowEmptyCatch: true }],
            "no-extra-semi": "error",
            "no-unreachable": "error",
            "semi": ["error", "always"],
        },
    },
    {
        ignores: [
            "node_modules/**",
            "test_*.js",
            "test2.js",
            "test_current.js",
        ],
    },
];
