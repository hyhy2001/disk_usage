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

const jsFiles = walk(jsDir, n => n.endsWith('.js') && !n.endsWith('.min.js'));

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

    const partFiles = fs.existsSync(partsDir)
      ? walk(partsDir, n => n.endsWith('.css') && !n.endsWith('.min.css')).sort()
      : [];

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
    const chunks = [];

    if (job.partFiles.length) {
      for (const file of job.partFiles) {
        chunks.push(fs.readFileSync(file, 'utf8'));
      }
    }

    if (job.mainFile && job.partFiles.length === 0) {
      chunks.push(fs.readFileSync(job.mainFile, 'utf8'));
    }

    const source = chunks.join('\n');
    const result = await esbuild.transform(source, {
      loader: 'css',
      minify: true,
      target: ['es2020'],
    });

    fs.mkdirSync(path.dirname(job.outFile), { recursive: true });
    fs.writeFileSync(job.outFile, result.code);
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

async function build() {
  console.log(`Found ${jsFiles.length} JS files to minify.`);

  if (isWatch) {
    await buildJs(true);
    const cssCount = await buildCssBundles();
    console.log(`Watching JS files and built ${cssCount} CSS bundles (rerun build for CSS updates).`);
    return;
  }

  await buildJs(false);
  const cssCount = await buildCssBundles();
  console.log(`Build complete. (${cssCount} CSS bundles)`);
}

build().catch(() => process.exit(1));
