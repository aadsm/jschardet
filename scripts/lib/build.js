// Shared build helper for scripts.
//
// Plain ESM JS so it can be imported by any script without a transpiler.

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Ensures the TypeScript build is up to date.
 * Runs `npm run build` if build/index.js is missing.
 *
 * @param {string} root  Repo root directory.
 */
export function ensureBuild(root) {
  if (existsSync(join(root, 'build', 'index.js'))) return;
  process.stderr.write('build/index.js not found — running npm run build...\n');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
