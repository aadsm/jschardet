// Helpers for scripts that call chardet 7 (Python submodule).
//
// Plain ESM JS so it can be imported by any script without a transpiler.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Returns the path to the chardet submodule's src directory.
 *
 * @param {string} root  Repo root directory.
 */
export function chardet7SrcDir(root) {
  return join(root, 'chardet', 'src');
}

/**
 * Ensures chardet/src/chardet/_version.py exists.
 * hatch-vcs generates it at build time and it is gitignored, so a fresh
 * submodule has no _version.py; without it `import chardet` fails.
 * Synthesises it from the latest version heading in changelog.rst.
 *
 * @param {string} root  Repo root directory.
 */
export function ensureChardet7(root) {
  const versionFile = join(root, 'chardet', 'src', 'chardet', '_version.py');
  if (existsSync(versionFile)) return;
  let version = '0.0.0+local';
  try {
    const m = readFileSync(join(root, 'chardet', 'docs', 'changelog.rst'), 'utf-8')
      .match(/^(\d+\.\d+\.\d+)\s*\(/m);
    if (m) version = m[1];
  } catch {}
  writeFileSync(versionFile, `__version__ = "${version}"\n`);
  process.stderr.write(`generated chardet/_version.py (version=${version})\n`);
}

/**
 * Returns a display label like "chardet 7.0.1" read from changelog.rst.
 *
 * @param {string} root  Repo root directory.
 */
export function chardet7Label(root) {
  try {
    const m = readFileSync(join(root, 'chardet', 'docs', 'changelog.rst'), 'utf-8')
      .match(/^(\d+\.\d+\.\d+)\s*\(/m);
    if (m) return `chardet ${m[1]}`;
  } catch {}
  return 'chardet 7';
}
