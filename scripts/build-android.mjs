#!/usr/bin/env node
// Builds the Android app: the web bundle into dist-android/www (Capacitor's webDir), then the APK with Gradle.
//   node scripts/build-android.mjs [--entry <dir>] [--release] [--install]
// The app: the desktop's renderer (src/renderer) as it is, plus android.js — the desktop's main process and preload
// (src/main, src/preload.js) bundled for the page, Node's built-ins and Electron resolved to src/android/shims — loaded
// before everything else on the page.
// --entry <dir>: a test page instead (the playback spike): copied as is, each *.entry.js bundled into the file of the
// same name without ".entry".
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const entryDir = opt('--entry') ? path.resolve(root, opt('--entry')) : null;
const release = args.includes('--release');
const out = path.join(root, 'dist-android', 'www');

const env = { ...process.env };
env.ANDROID_HOME ||= path.join(os.homedir(), 'Library', 'Android', 'sdk');
if (!env.JAVA_HOME) {
  try { env.JAVA_HOME = execFileSync('brew', ['--prefix', 'openjdk@21'], { encoding: 'utf8' }).trim(); } catch { /* Gradle finds one itself */ }
}
const run = (cmd, argv, cwd = root) => execFileSync(cmd, argv, { cwd, env, stdio: 'inherit' });

const target = process.env.CDP_WEB_TARGET || 'chrome100';
fs.rmSync(out, { recursive: true, force: true });
if (entryDir) {
  if (!fs.existsSync(entryDir)) throw new Error(`No web entry at ${entryDir}`);
  fs.cpSync(entryDir, out, { recursive: true, filter: (src) => !src.endsWith('.entry.js') });
  const entries = fs.readdirSync(entryDir, { recursive: true }).filter((f) => String(f).endsWith('.entry.js'));
  for (const f of entries) {
    await esbuild.build({
      entryPoints: [path.join(entryDir, f)],
      outfile: path.join(out, String(f).replace(/\.entry\.js$/, '.js')),
      bundle: true, format: 'esm', target, sourcemap: release ? false : 'inline', logLevel: 'warning',
    });
  }
} else {
  await buildApp();
}

async function buildApp() {
  const renderer = path.join(root, 'src', 'renderer');
  fs.cpSync(renderer, out, { recursive: true });
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  const withBoot = html
    .replace('<script src="js/first-paint.js"></script>', '<script src="android.js"></script>\n  <script src="js/first-paint.js"></script>')
    .replace('<link rel="stylesheet" href="styles.css">', '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n  <link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="mobile.css">');
  if (!withBoot.includes('mobile.css')) throw new Error('index.html: no styles.css link to put mobile.css after');
  fs.copyFileSync(path.join(root, 'src', 'android', 'ui', 'mobile.css'), path.join(out, 'mobile.css'));
  fs.copyFileSync(path.join(root, 'src', 'android', 'ui', 'old-webview.html'), path.join(out, 'old-webview.html')); // (capacitor.config.json's errorPath)
  if (withBoot === html) throw new Error('index.html: no first-paint.js script to put android.js before');
  // Nothing from elsewhere on the page (the desktop's lets in Spotify's player): the page holds the bridges to the
  // phone's files (NativeFs), which answer any frame or script in it.
  const own = withBoot.replace(/ https:\/\/sdk\.scdn\.co/g, '').replace(/ frame-src[^;"]*;?/, " frame-src 'none';");
  if (/scdn|https:\/\//.test(own.match(/Content-Security-Policy" content="([^"]*)"/)[1])) throw new Error('index.html: CSP still lets in another site');
  fs.writeFileSync(path.join(out, 'index.html'), own);

  const shims = path.join(root, 'src', 'android', 'shims');
  const SHIMS = {
    fs: 'fs.js', 'fs/promises': 'fs-promises.js', path: 'path.js', os: 'os.js', url: 'url.js', crypto: 'crypto.js', electron: 'electron.js',
    stream: 'stream.js', 'stream/promises': 'stream.js', buffer: null, events: null, string_decoder: null,
    child_process: 'not-on-android.js', worker_threads: 'worker-threads.js', net: 'not-on-android.js', http: 'not-on-android.js',
    https: 'not-on-android.js', zlib: 'not-on-android.js', dgram: 'not-on-android.js', dns: 'not-on-android.js', tls: 'not-on-android.js',
    readline: 'not-on-android.js', util: 'not-on-android.js', assert: 'not-on-android.js',
  };
  const bundled = {};
  for (const f of fs.readdirSync(path.join(root, 'src', 'locales'))) {
    if (f.endsWith('.json')) bundled[`/app/src/locales/${f}`] = fs.readFileSync(path.join(root, 'src', 'locales', f), 'utf8');
  }
  // Karaoke's word timing: its models go beside its worker (below); word-fit.js only asks whether they're there.
  const karaoke = path.join(root, 'src', 'main', 'karaoke'), MODELS = ['vocals.int8.onnx', 'accompaniment.int8.onnx', 'aligner.onnx'];
  if (!MODELS.every((m) => fs.existsSync(path.join(karaoke, 'models', m)))) run('node', ['scripts/fetch-karaoke-models.js']);
  for (const m of MODELS) bundled[`/app/src/main/karaoke/models/${m}`] = ''; // (there, in workers/karaoke/models/)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const shimPlugin = {
    name: 'android-shims',
    setup(b) {
      b.onResolve({ filter: /^(node:)?[a-z_]+(\/[a-z]+)?$/ }, (a) => {
        const name = a.path.replace(/^node:/, '');
        if (!(name in SHIMS)) return undefined;
        if (SHIMS[name] === null) return { path: require.resolve(`${name}/`, { paths: [root] }) };
        return { path: path.join(shims, SHIMS[name]) };
      });
      // music-metadata and strtok3: their Node builds — the browser ones can't read a file by its path (parseFile),
      // which is what the shelf and the tags need; their fs is the shim's.
      b.onResolve({ filter: /^(music-metadata|strtok3)$/ }, (a) => ({ path: path.join(root, 'node_modules', a.path, 'lib', 'index.js') }));
      b.onResolve({ filter: /bundled-files\.js$/ }, () => ({ path: 'bundled-files', namespace: 'cdp-bundled' }));
      b.onLoad({ filter: /.*/, namespace: 'cdp-bundled' }, () => ({ contents: `module.exports = ${JSON.stringify(bundled)};`, loader: 'js' }));
    },
  };
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'android', 'boot.entry.js')],
    outfile: path.join(out, 'android.js'),
    bundle: true, format: 'iife', platform: 'browser', target, sourcemap: release ? false : 'inline', logLevel: 'warning',
    mainFields: ['browser', 'module', 'main'], conditions: ['browser'],
    define: { 'process.platform': '"android"', 'process.env.CDP_VERSION': JSON.stringify(pkg.version), __dirname: '"/app/src/main"', 'globalThis.fetch': '__nativeFetch' }, // (scrobble.js's default)
    inject: [path.join(root, 'src', 'android', 'shims', 'fetch.js')], // (Node's fetch → native HTTP, no CORS)
    plugins: [shimPlugin],
  });
  // The desktop's workers that run on Android too, as Web Workers (shims/worker-threads.js maps their names here).
  const WORKERS = { 'romanize-worker.js': 'romanize-worker.entry.js', 'word-fit-worker.js': 'word-fit-worker.entry.js' };
  // (a worker has no NativeFs: the karaoke code's fs and zlib read the app's files beside it)
  const workerFiles = { name: 'worker-files', setup(b) { b.onResolve({ filter: /^(node:)?(fs|zlib)$/ }, () => ({ path: path.join(shims, 'worker-files.js') })); } };
  for (const [name, entry] of Object.entries(WORKERS)) {
    const fitting = name === 'word-fit-worker.js';
    await esbuild.build({
      entryPoints: [path.join(root, 'src', 'android', entry)],
      outfile: path.join(out, 'workers', name),
      bundle: true, format: 'iife', platform: 'browser', target, sourcemap: release ? false : 'inline', logLevel: 'warning',
      mainFields: ['browser', 'module', 'main'], conditions: ['browser'],
      define: { 'process.platform': '"android"', ...(fitting ? { __dirname: '"karaoke"' } : {}) },
      plugins: fitting ? [workerFiles, shimPlugin] : [shimPlugin],
    });
  }
  // …and what it reads: the models, the dictionary (unzipped, see worker-files.js), onnxruntime's WebAssembly.
  const kOut = path.join(out, 'workers', 'karaoke');
  fs.mkdirSync(path.join(kOut, 'models'), { recursive: true });
  for (const m of MODELS) fs.copyFileSync(path.join(karaoke, 'models', m), path.join(kOut, 'models', m));
  fs.writeFileSync(path.join(kOut, 'cmudict.txt'), zlib.gunzipSync(fs.readFileSync(path.join(karaoke, 'cmudict.txt.gz'))));
  const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist'), ortOut = path.join(out, 'workers', 'ort');
  fs.mkdirSync(ortOut, { recursive: true });
  fs.copyFileSync(path.join(ortDist, 'ort-wasm-simd-threaded.wasm'), path.join(ortOut, 'ort-wasm-simd-threaded.wasm'));
  fs.copyFileSync(path.join(ortDist, 'ort-wasm-simd-threaded.mjs'), path.join(ortOut, 'ort-wasm-simd-threaded.js'));
  // Japanese's dictionary for romanize-worker.js, unzipped: Android's packaging unzips a .gz asset and drops the
  // extension itself, so the files are put there as they'll be served (the worker asks for them without .gz).
  const dict = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict'), dictOut = path.join(out, 'workers', 'kuromoji-dict');
  fs.mkdirSync(dictOut, { recursive: true });
  for (const f of fs.readdirSync(dict).filter((n) => n.endsWith('.dat.gz'))) {
    fs.writeFileSync(path.join(dictOut, f.replace(/\.gz$/, '')), zlib.gunzipSync(fs.readFileSync(path.join(dict, f))));
  }
}

run('npx', ['cap', 'sync', 'android']);
const androidDir = path.join(root, 'android');
fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${env.ANDROID_HOME}\n`);
run('./gradlew', ['-q', release ? 'assembleRelease' : 'assembleDebug'], androidDir);

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug',
  release ? 'app-release.apk' : 'app-debug.apk');
console.log(apk);
if (args.includes('--install')) run(path.join(env.ANDROID_HOME, 'platform-tools', 'adb'), ['install', '-r', apk]);
