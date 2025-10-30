import nextConfig from "eslint-config-next";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import jest from "eslint-plugin-jest";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default [
    ...nextConfig,
    {
        files: ["**/*.{js,jsx,ts,tsx}"],
        ignores: ["**/*.config.js", "**/*.config.mjs"],
        
        plugins: {
            "@typescript-eslint": typescriptEslint,
            jest,
            "unused-imports": unusedImports,
            import: importPlugin,
        },

        languageOptions: {
            parser: typescriptParser,
            globals: {
                ...globals.node,
                ...globals.es2020,
                ...jest.environments.globals.globals,
            },
            ecmaVersion: 2020,
            sourceType: "module",
            parserOptions: {
                project: "./tsconfig.json",
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },

        settings: {
            "import/resolver": {
                typescript: {},
                node: {},
            },
        },

        rules: {
            "no-console": ["warn", {
                allow: ["warn", "error"],
            }],
            semi: ["error", "never"],
            "no-duplicate-imports": "error",
            "space-in-parens": ["error", "never"],
            "object-curly-spacing": ["error", "always"],
            "no-self-compare": "error",
            "comma-spacing": ["error", {
                before: false,
                after: true,
            }],
            "computed-property-spacing": ["error", "never"],
            "func-call-spacing": ["error", "never"],
            "key-spacing": ["error", {
                beforeColon: false,
            }],
            "no-multi-spaces": "error",
            "no-multiple-empty-lines": "error",
            "no-whitespace-before-property": "error",
            quotes: ["error", "single"],
            "rest-spread-spacing": ["error", "never"],
            "padding-line-between-statements": ["warn"],
            "no-unused-vars": "off",
            "unused-imports/no-unused-imports": "error",
            "unused-imports/no-unused-vars": ["warn", {
                vars: "all",
                varsIgnorePattern: "^_",
                args: "after-used",
                argsIgnorePattern: "^_",
            }],
            "sort-imports": ["error", {
                ignoreDeclarationSort: true,
            }],
            "import/no-unresolved": ["off"],
            "import/order": ["error", {
                groups: [
                    "builtin",
                    "external",
                    "internal",
                    "parent",
                    "sibling",
                    "index",
                    "object",
                    "type",
                ],
                pathGroups: [{
                    pattern: "{react,react-dom/**,react-router-dom,next,next/**,next-auth/**}",
                    group: "builtin",
                    position: "before",
                }, {
                    pattern: "{**/*.css,**/*.scss}",
                    group: "type",
                    position: "after",
                }, {
                    pattern: "@public/**",
                    group: "type",
                    position: "after",
                }],
                pathGroupsExcludedImportTypes: ["builtin"],
                alphabetize: {
                    order: "asc",
                    caseInsensitive: true,
                },
                "newlines-between": "always",
            }],
            "import/no-duplicates": ["error", {
                "prefer-inline": true,
            }],
            "@typescript-eslint/consistent-type-imports": ["error", {
                prefer: "type-imports",
                fixStyle: "inline-type-imports",
            }],
            "@typescript-eslint/strict-boolean-expressions": ["warn", {
                allowString: false,
                allowNumber: false,
                allowNullableObject: false,
                allowNullableBoolean: false,
                allowNullableString: false,
                allowNullableNumber: false,
                allowAny: false,
            }],
            "@typescript-eslint/restrict-template-expressions": ["warn", {
                allowNumber: true,
                allowBoolean: false,
                allowAny: false,
                allowNullish: false,
                allowRegExp: false,
            }],
            "max-params": ["warn", 3],
        },
    },
];
