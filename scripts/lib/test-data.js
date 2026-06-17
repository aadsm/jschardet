// Shared test-data clone helpers. Imported by tests/utils.ts (which uses
// them at runtime for the accuracy suite) and by scripts that need to
// pull files from the chardet test-data repo (e.g. update-test-fixtures.js).
//
// Plain ESM JS so it can be consumed by both .ts (via NodeNext .js imports)
// and .js (scripts/) without a transpiler.

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const TEST_DATA_REPO = 'https://github.com/chardet/test-data.git';
export const TEST_DATA_REF = '7.4.3';
export const TEST_DATA_REF_FILE = '.test-data-ref';

export function gitCloneShallow(repo, dest, branch) {
  const branchArg = branch ? `--branch=${branch}` : '';
  execSync(`git clone --depth=1 ${branchArg} ${repo} ${dest}`, { stdio: 'pipe' });
}

/**
 * Ensures the test-data directory exists and is at the expected ref.
 * Clones from GitHub if the directory is absent or stale; otherwise no-op.
 *
 * @param {string} dest     Destination directory (e.g. tests/data/).
 * @param {string} tmpRoot  Where to create the temporary clone workspace.
 */
export function ensureTestData(dest, tmpRoot) {
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    const refFile = path.join(dest, TEST_DATA_REF_FILE);
    if (fs.existsSync(refFile) && fs.readFileSync(refFile, 'utf8').trim() === TEST_DATA_REF) {
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  process.stderr.write(`Cloning chardet test corpus (${TEST_DATA_REF}) into ${dest}...\n`);
  cloneTestData(dest, TEST_DATA_REF, tmpRoot);
}

/**
 * Shallow-clone the test-data repo at `ref` (with fallback to default
 * branch if the tag is missing) into `dest`. Copies every top-level
 * directory in the clone into `dest` and writes a `.test-data-ref`
 * marker so callers can detect cache staleness. Cleans up the temp
 * working tree afterwards.
 *
 * @param {string} dest      Destination directory (created if missing).
 * @param {string|null} ref  Git tag/branch to fetch, or null for default.
 * @param {string} tmpRoot   Where to create the temp clone (caller picks
 *                           a writable location, e.g. tests/ or os.tmpdir()).
 */
export function cloneTestData(dest, ref, tmpRoot) {
  const tmp = fs.mkdtempSync(path.join(tmpRoot, '.tmp-clone-'));
  try {
    if (ref !== null) {
      try {
        gitCloneShallow(TEST_DATA_REPO, tmp, ref);
      } catch {
        process.stderr.write(
          `WARNING: test-data ref '${ref}' not found, falling back to default branch\n`,
        );
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        gitCloneShallow(TEST_DATA_REPO, tmp);
        ref = null;
      }
    } else {
      gitCloneShallow(TEST_DATA_REPO, tmp);
    }

    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(tmp)) {
      if (item.startsWith('.')) continue;
      const src = path.join(tmp, item);
      if (!fs.statSync(src).isDirectory()) continue;
      fs.cpSync(src, path.join(dest, item), { recursive: true });
    }
    const refLabel = ref ?? 'main';
    fs.writeFileSync(path.join(dest, TEST_DATA_REF_FILE), refLabel + '\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
