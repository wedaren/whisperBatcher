/*
 * 构建脚本。
 * 负责把扩展入口 `src/extension.ts` 打包到 `dist/extension.js`。
 */
const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * 让 esbuild 输出适配 VS Code 的问题匹配器。
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// 当前主分支只打包扩展入口，不包含额外 CLI / MCP 入口。
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			// 放在插件数组末尾，确保能看到最终构建结果。
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		// 开发阶段持续监听并重新打包。
		await ctx.watch();
	} else {
		// 生产或 CI 场景执行单次构建。
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	// 构建失败时返回非零退出码，交给 npm script 或 CI 处理。
	console.error(e);
	process.exit(1);
});
