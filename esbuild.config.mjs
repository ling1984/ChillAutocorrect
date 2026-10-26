import { build, context } from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'main.js', format: 'cjs',
  target: 'es2022', platform: 'browser', sourcemap: false,
  external: ['obsidian', 'electron', '@electron/remote', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language', '@lezer/common'],
};
if (process.argv.includes('--watch')) await (await context(options)).watch();
else await build(options);
