// Builds the All files pane into renderer/out/: Monaco (VS Code's editor) with its features and Shiki (VS Code's
// TextMate grammars and themes), bundled so the page loads nothing from the network. `npm run build` (`-- --watch`).
import { readFileSync, writeFileSync } from 'node:fs'
import * as esbuild from 'esbuild'

const main = readFileSync('node_modules/monaco-editor/esm/vs/editor/editor.main.js', 'utf8')
const features = main.split('\n').filter((line) => line.startsWith("import '../features/")).map((line) => line.replace("'../features/", "'monaco-editor/features/"))
writeFileSync('renderer/src/monaco.js', [
  "// Monaco's editor with every feature it ships (find, folding, multi-cursor…) and none of its Monarch languages:",
  '// grammars come from Shiki. Written by build.mjs from monaco-editor\'s editor.main.js.',
  "export * from 'monaco-editor/editor/editor.api.js'",
  ...features,
  '',
].join('\n'))

const builds = [
  { entryPoints: { files: 'renderer/src/files.js' }, format: 'esm', splitting: true, loader: { '.ttf': 'file' } },
  { entryPoints: { 'editor.worker': 'monaco-editor/editor/editor.worker.js' }, format: 'iife' },
].map((options) => ({ ...options, bundle: true, minify: true, outdir: 'renderer/out', logLevel: 'info' }))

if (process.argv.includes('--watch')) for (const options of builds) await (await esbuild.context(options)).watch()
else await Promise.all(builds.map((options) => esbuild.build(options)))
