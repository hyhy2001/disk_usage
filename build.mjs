import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

const jsDir = './js';
const cssDir = './css';

// Recursively walk a directory and collect matching files.
function walk(dir, predicate) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        stack.push(full);
      } else if (entry.isFile() && predicate(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// Find all JS files (recursive) excluding *.min.js
const jsFiles = walk(jsDir, n => n.endsWith('.js') && !n.endsWith('.min.js'));

// Find all CSS files (recursive) excluding *.min.css
const cssFiles = walk(cssDir, n => n.endsWith('.css') && !n.endsWith('.min.css'));

const entryPoints = [...jsFiles, ...cssFiles];

console.log(`Found ${jsFiles.length} JS files and ${cssFiles.length} CSS files to minify.`);

// Plugin: rewrite relative imports from "./foo.js" -> "./foo.min.js"
// so the browser keeps fetching minified files for the rest of the module graph.
const rewriteImportsToMin = {
  name: 'rewrite-imports-to-min',
  setup(build) {
    build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
      if (args.kind === 'entry-point') return null;
      // Only rewrite .js imports (skip .css, .json, etc.)
      if (!args.path.endsWith('.js')) return null;
      // Skip already-minified imports
      if (args.path.endsWith('.min.js')) return null;
      const newPath = args.path.replace(/\.js$/, '.min.js');
      return { path: newPath, external: true };
    });
  },
};

const buildOptions = {
  entryPoints,
  outdir: '.',
  outbase: '.', // keeps 'js' and 'css' subfolders
  minify: true,
  bundle: true, // needed for onResolve plugin to intercept imports
  format: 'esm',
  target: ['es2020'],
  outExtension: { '.js': '.min.js', '.css': '.min.css' },
  plugins: [rewriteImportsToMin],
  logLevel: 'info',
};

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('Build complete.');
  }
}

build().catch(() => process.exit(1));
