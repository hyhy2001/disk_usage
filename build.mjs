import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const isWatch = process.argv.includes('--watch');

const jsDir = './js';
const cssDir = './css';

const common = { minify: true, target: ['es2020'], logLevel: 'info' };

// js/app.js imports all 14 modules in order -> single ESM bundle for index.html.
async function buildAppJs(watchMode) {
  const entry = path.join(jsDir, 'app.js');
  if (!fs.existsSync(entry)) return;
  const options = {
    ...common,
    entryPoints: [entry],
    outfile: path.join(jsDir, 'app.min.js'),
    bundle: true,
    format: 'esm',
  };
  if (watchMode) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`Watching JS: ${options.outfile}`);
    return;
  }
  await esbuild.build(options);
  console.log(`JS bundle: ${options.outfile}`);
}

// css/app.css @imports the 4 entry stylesheets -> single bundle for index.html.
// Fonts are marked external so esbuild doesn't try to load .ttf; their url()
// is then rebased from ../../fonts/ (valid for css/core/fonts.css) to ../fonts/
// (valid for the shallower css/app.min.css).
async function buildAppCss() {
  const entry = path.join(cssDir, 'app.css');
  if (!fs.existsSync(entry)) return;
  const outFile = path.join(cssDir, 'app.min.css');
  await esbuild.build({
    ...common,
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    loader: { '.css': 'css' },
    external: ['*.ttf', '*.woff', '*.woff2'],
  });
  const css = fs.readFileSync(outFile, 'utf8')
    .replace(/url\((['"]?)(?:\.\.\/)+fonts\//g, 'url($1../fonts/');
  fs.writeFileSync(outFile, css);
  console.log(`CSS bundle: ${outFile}`);
}

// setup.html loads css/core/fonts.min.css and css/core/index.min.css directly.
// Minify in place (no bundle) so url('../../fonts/*.ttf') in fonts.css stays
// valid beside the source and index.css (no @import/url) is just compressed.
async function buildCoreCss() {
  for (const name of ['fonts', 'index']) {
    const src = path.join(cssDir, 'core', `${name}.css`);
    if (!fs.existsSync(src)) continue;
    const outFile = path.join(cssDir, 'core', `${name}.min.css`);
    await esbuild.build({
      ...common,
      entryPoints: [src],
      outfile: outFile,
      bundle: false,
      loader: { '.css': 'css' },
    });
    console.log(`CSS bundle: ${outFile}`);
  }
}

// Stamp index.html's ?v= query params with each bundle's content hash so the
// browser refetches only when a bundle actually changes -- no manual version
// bump. JS and CSS are hashed independently (a CSS-only change won't bust the
// JS cache). Runs only on a full build, not in watch mode (CSS isn't rebuilt
// there, so its hash would be stale).
function stampIndexHtml() {
  const indexFile = './index.html';
  if (!fs.existsSync(indexFile)) return;
  const hashes = {};
  for (const rel of ['js/app.min.js', 'css/app.min.css']) {
    if (!fs.existsSync(rel)) continue;
    hashes[path.basename(rel)] = crypto
      .createHash('sha1')
      .update(fs.readFileSync(rel))
      .digest('hex')
      .slice(0, 8);
  }
  const html = fs.readFileSync(indexFile, 'utf8');
  const stamped = html.replace(
    /(app\.min\.(?:js|css))\?v=[A-Za-z0-9]+/g,
    (match, file) => (hashes[file] ? `${file}?v=${hashes[file]}` : match)
  );
  if (stamped !== html) {
    fs.writeFileSync(indexFile, stamped);
    console.log(`Stamped index.html: ${Object.entries(hashes).map(([f, h]) => `${f}?v=${h}`).join(', ')}`);
  } else {
    console.log('index.html cache stamps already current.');
  }
}

async function build() {
  await buildAppJs(isWatch);
  await buildAppCss();
  await buildCoreCss();
  if (!isWatch) stampIndexHtml();
  console.log(isWatch
    ? 'Watching JS bundle (rerun build for CSS updates).'
    : 'Build complete.');
}

build().catch(() => process.exit(1));
