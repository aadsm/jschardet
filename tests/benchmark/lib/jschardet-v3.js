// Installs jschardet 3 on demand for benchmark scripts.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Ensures jschardet 3.1.4 is installed in tests/bench-deps/jschardet-3/.
 * Installs via npm if the directory is absent.
 *
 * @param {string} root  Repo root directory.
 */
export function ensureJschardetV3(root) {
  const v3Dir = join(root, 'tests', 'bench-deps', 'jschardet-3');
  const v3Entry = join(v3Dir, 'node_modules', 'jschardet');
  if (existsSync(v3Entry)) return;
  process.stderr.write('jschardet 3 not found — installing to tests/bench-deps/jschardet-3/...\n');
  mkdirSync(v3Dir, { recursive: true });
  // npm requires a package.json in the target dir to treat it as a project root;
  // without it, npm falls back to the nearest ancestor package.json (the main project).
  writeFileSync(join(v3Dir, 'package.json'), '{"name":"jschardet-bench-deps","private":true}\n');
  execSync('npm install jschardet@3.1.4 --no-package-lock', { cwd: v3Dir, stdio: 'inherit' });
}
