import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');

const jsDir = './js';
const cssDir = './css';

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

// Per-file minify list excludes the single-bundle entry (built separately,
// see buildAppBundle) so it isn't double-written by the rewrite-to-min path.
const appEntry = path.join(jsDir, 'app.js');
const jsFiles = walk(jsDir, n => n.endsWith('.js') && !n.endsWith('.min.js'))
  .filter(f => path.resolve(f) !== path.resolve(appEntry));

const rewriteImportsToMin = {
  name: 'rewrite-imports-to-min',
  setup(build) {
    build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
      if (args.kind === 'entry-point') return null;
      if (!args.path.endsWith('.js')) return null;
      if (args.path.endsWith('.min.js')) return null;
      const newPath = args.path.replace(/\.js$/, '.min.js');
      return { path: newPath, external: true };
    });
  },
};

function getCssBundleJobs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];

  const jobs = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const bundleName = entry.name;
    const bundleDir = path.join(rootDir, bundleName);
    const partsDir = path.join(bundleDir, 'parts');

    const partsIndexFile = path.join(partsDir, '_index.css');
    const partFiles = fs.existsSync(partsIndexFile)
      ? [partsIndexFile]
      : (fs.existsSync(partsDir)
        ? walk(partsDir, n => n.endsWith('.css') && !n.endsWith('.min.css')).sort()
        : []);

    const namedMain = path.join(bundleDir, `${bundleName}.css`);
    const indexMain = path.join(bundleDir, 'index.css');
    const mainFile = fs.existsSync(namedMain)
      ? namedMain
      : (fs.existsSync(indexMain) ? indexMain : null);

    if (partFiles.length === 0 && !mainFile) continue;

    const outFile = mainFile
      ? mainFile.replace(/\.css$/, '.min.css')
      : path.join(bundleDir, `${bundleName}.min.css`);

    jobs.push({ bundleName, partFiles, mainFile, outFile });
  }

  return jobs;
}

async function buildCssBundles() {
  const jobs = getCssBundleJobs(cssDir);

  for (const job of jobs) {
    let result;

    try {
      if (job.partFiles.length) {
        result = await esbuild.build({
          entryPoints: job.partFiles,
          bundle: true,
          minify: true,
          write: false,
          target: ['es2020'],
          loader: { '.css': 'css' },
        });
      } else {
        result = await esbuild.build({
          entryPoints: [job.mainFile],
          bundle: true,
          minify: true,
          write: false,
          target: ['es2020'],
          loader: { '.css': 'css' },
        });
      }
    } catch (e) {
      console.error(`Error building ${job.bundleName}:`, e.message);
      process.exit(1);
    }

    const output = result.outputFiles?.[0]?.text ?? '';
    fs.mkdirSync(path.dirname(job.outFile), { recursive: true });
    fs.writeFileSync(job.outFile, output);
    console.log(`CSS bundle: ${job.outFile}`);
  }

  return jobs.length;
}

async function buildJs(watchMode) {
  const jsBuildOptions = {
    entryPoints: jsFiles,
    outdir: '.',
    outbase: '.',
    minify: true,
    bundle: true,
    format: 'esm',
    target: ['es2020'],
    outExtension: { '.js': '.min.js' },
    plugins: [rewriteImportsToMin],
    logLevel: 'info',
  };

  if (watchMode) {
    const ctx = await esbuild.context(jsBuildOptions);
    await ctx.watch();
    return;
  }

  await esbuild.build(jsBuildOptions);
}

async function buildAppBundle() {
  if (!fs.existsSync(appEntry)) return;
  await esbuild.build({
    entryPoints: [appEntry],
    outfile: path.join(jsDir, 'app.min.js'),
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2020'],
    logLevel: 'info',
  });
  console.log(`JS bundle: ${path.join(jsDir, 'app.min.js')}`);
}

// fonts.css is @font-face only with url('../../fonts/*.ttf') and no @import,
// so minify-in-place (bundle:false) — esbuild leaves url() verbatim and the
// output sits beside the source in css/core/, keeping ../../fonts/ valid.
// setup.html references css/core/fonts.min.css, so this must be emitted.
async function buildFontsCss() {
  const src = path.join(cssDir, 'core', 'fonts.css');
  if (!fs.existsSync(src)) return;
  const outFile = path.join(cssDir, 'core', 'fonts.min.css');
  await esbuild.build({
    entryPoints: [src],
    outfile: outFile,
    bundle: false,
    minify: true,
    target: ['es2020'],
    loader: { '.css': 'css' },
    logLevel: 'info',
  });
  console.log(`CSS bundle: ${outFile}`);
}

async function buildAppCssBundle() {
  const appCss = path.join(cssDir, 'app.css');
  if (!fs.existsSync(appCss)) return;
  const outFile = path.join(cssDir, 'app.min.css');
  await esbuild.build({
    entryPoints: [appCss],
    outfile: outFile,
    bundle: true,
    minify: true,
    target: ['es2020'],
    loader: { '.css': 'css' },
    external: ['*.ttf', '*.woff', '*.woff2'],
    logLevel: 'info',
  });
  // esbuild leaves external url() paths verbatim (e.g. ../../fonts/ from the
  // original css/core/fonts.css). The bundle lives one level shallower at
  // css/app.min.css, and every font asset resolves to webroot/fonts, so
  // rebase any */fonts/ ref to ../fonts/ relative to the bundle.
  const css = fs.readFileSync(outFile, 'utf8')
    .replace(/url\((['"]?)(?:\.\.\/)+fonts\//g, 'url($1../fonts/');
  fs.writeFileSync(outFile, css);
  console.log(`CSS bundle: ${outFile}`);
}

async function build() {
  console.log(`Found ${jsFiles.length} JS files to minify.`);

  if (isWatch) {
    await buildJs(true);
    await buildAppBundle();
    const cssCount = await buildCssBundles();
    await buildFontsCss();
    await buildAppCssBundle();
    console.log(`Watching JS files and built ${cssCount} CSS bundles (rerun build for CSS updates).`);
    return;
  }

  await buildJs(false);
  await buildAppBundle();
  const cssCount = await buildCssBundles();
  await buildFontsCss();
  await buildAppCssBundle();
  console.log(`Build complete. (${cssCount} CSS bundles)`);
}

build().catch(() => process.exit(1));
