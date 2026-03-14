/**
 * ESLint 配置。
 * 目前规则保持轻量，重点约束 TypeScript 基础语义和常见风格问题。
 */
import typescriptEslint from "typescript-eslint";

export default [{
    // 当前只对 TypeScript 文件启用这组规则。
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        // 导入命名统一约束为驼峰或帕斯卡，减少命名风格漂移。
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        // 基础质量规则，优先覆盖容易引发真实问题的部分。
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];
