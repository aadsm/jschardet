// Shared test-data clone helpers. Imported by tests/utils.ts (which uses
// them at runtime for the accuracy suite) and by scripts that need to
// pull files from the chardet test-data repo (e.g. update-test-fixtures.js).
//
// Plain ESM JS so it can be consumed by both .ts (via NodeNext .js imports)
// and .js (scripts/) without a transpiler.

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DATA_REPO = 'https://github.com/chardet/test-data.git';
export const TEST_DATA_REF_FILE = '.test-data-ref';

const _root = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const _chardetDir = path.join(_root, 'chardet');
const CHARDET_REPO = 'https://github.com/chardet/chardet';

function _git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Maps a chardet commit SHA to its release tag, or null. Resolution order:
 * the submodule's local tags when its repository is available, then the
 * public chardet remote (covers uninitialized and re-shallowed submodules,
 * at the cost of a network round trip).
 *
 * @param {string} sha  Full chardet commit SHA.
 * @returns {string|null}
 */
export function resolveChardetTag(sha) {
  if (fs.existsSync(path.join(_chardetDir, '.git'))) {
    try {
      const local = _git(`tag --points-at ${sha}`, _chardetDir).split('\n')[0];
      if (local) return local;
    } catch {
      // fall through to the remote
    }
  }
  try {
    // Peeled (^{}) entries carry the commit SHA for annotated tags.
    for (const line of _git(`ls-remote --tags ${CHARDET_REPO}`, _root).split('\n')) {
      const m = line.match(/^([0-9a-f]{40})\trefs\/tags\/(.+?)(\^\{\})?$/);
      if (m && m[1] === sha) return m[2];
    }
  } catch {
    // offline, or no remote access
  }
  return null;
}

/**
 * Refuses a submodule checkout that is not the pin recorded in HEAD. The
 * corpus follows the checkout, but src/models/*.bin.js is generated from the
 * pin, so a drifted checkout scores one chardet release's corpus against
 * another's model data — failures that read as port regressions and are not.
 */
function _assertCheckoutMatchesPin() {
  let checkout, pin;
  try {
    checkout = _git('rev-parse HEAD', _chardetDir);
    pin = _git('ls-tree HEAD chardet', _root).split(/\s+/)[2];
  } catch {
    return; // uninitialized submodule or no git metadata: nothing to compare
  }
  if (checkout !== pin) {
    throw new Error(
      `chardet submodule is checked out at ${checkout.slice(0, 12)}, not the pin ` +
      `recorded in HEAD (${pin.slice(0, 12)}); the corpus and src/models/*.bin.js ` +
      `would come from different chardet releases.\n` +
      `  Fix: git submodule update --checkout chardet`,
    );
  }
}

let _cachedRef;

/**
 * Derives the test-data ref from the chardet submodule, mirroring how
 * upstream keys its corpus on the installed chardet version: the submodule
 * checkout when present (so an update run tests the new corpus before the
 * pin commit exists), the recorded pin otherwise, mapped to the test-data
 * tag of the same name. A commit at no release tag derives to 'main' —
 * upstream's rule for dev builds. Memoized per process.
 *
 * @returns {string}
 */
export function getTestDataRef() {
  if (_cachedRef !== undefined) return _cachedRef;
  _assertCheckoutMatchesPin();
  let sha;
  try {
    sha = _git('rev-parse HEAD', _chardetDir);
  } catch {
    sha = _git('ls-tree HEAD chardet', _root).split(/\s+/)[2];
  }
  const tag = resolveChardetTag(sha);
  if (tag === null) {
    process.stderr.write(
      `WARNING: chardet @ ${sha.slice(0, 12)} is not at a release tag; using test-data 'main'\n`,
    );
  }
  _cachedRef = tag ?? 'main';
  return _cachedRef;
}

export function gitCloneShallow(repo, dest, branch) {
  const branchArg = branch ? `--branch=${branch}` : '';
  execSync(`git clone --depth=1 ${branchArg} ${repo} ${dest}`, { stdio: 'pipe' });
}

/**
 * Ensures the test-data directory exists and is at the ref derived from
 * the chardet submodule. Clones from GitHub if the directory is absent or
 * stale; otherwise no-op.
 *
 * @param {string} dest     Destination directory (e.g. tests/data/).
 * @param {string} tmpRoot  Where to create the temporary clone workspace.
 */
export function ensureTestData(dest, tmpRoot) {
  const ref = getTestDataRef();
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    const refFile = path.join(dest, TEST_DATA_REF_FILE);
    if (fs.existsSync(refFile) && fs.readFileSync(refFile, 'utf8').trim() === ref) {
      return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  process.stderr.write(`Cloning chardet test corpus (${ref}) into ${dest}...\n`);
  cloneTestData(dest, ref === 'main' ? null : ref, tmpRoot);
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
