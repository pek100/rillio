#!/usr/bin/env node
// Cross-platform replacement for the upstream scripts/build.sh.
// Builds the wasm bridge from crates/core (via crates/core-web) and transpiles
// the generated glue + bridge/worker sources with babel.
//
// Usage: node scripts/build.mjs [--dev]

import { spawnSync } from 'node:child_process';
import { renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv.includes('--dev') ? '--dev' : '--release';
const outDir = join(pkgRoot, 'wasm_build');

const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: pkgRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
        console.error(`\n[build] failed: ${cmd} ${args.join(' ')}`);
        process.exit(r.status ?? 1);
    }
};

const babel = (input, output) =>
    run('npx', ['babel', input, '--config-file', './.babelrc', '--out-file', output]);

mkdirSync(outDir, { recursive: true });

run('wasm-pack', ['build', '--no-typescript', '--no-pack', '--out-dir', 'wasm_build', mode, '--target', 'web']);

renameSync(join(outDir, 'stremio_core_web_bg.wasm'), join(pkgRoot, 'stremio_core_web_bg.wasm'));

babel('wasm_build/stremio_core_web.js', 'stremio_core_web.js');
babel('src/bridge.js', 'bridge.js');
babel('src/worker.js', 'worker.js');

console.log('[build] ok');
