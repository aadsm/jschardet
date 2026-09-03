#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEST_DATA_REPO } from './lib/test-data.js';
import { generate as generateWhatwgMap } from './generate-encodings-whatwg-map.js';
import { generate as generateModelBins } from './generate-model-bins.js';
import { generate as generateSbcsUndefinedBytes } from './generate-sbcs-undefined-bytes.js';
import { generate as generateByteTables } from './generate-byte-tables.js';
import { listChardetTags } from './chardet-version.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chardetDir = join(root, 'chardet');

function usage() {
  const self = process.env.npm_lifecycle_event
    ? `npm run ${process.env.npm_lifecycle_event} --`
    : `node scripts/update-chardet.js`;
  console.error(`Usage: ${self} <tag|commit-sha>`);
  console.error(`       ${self} --list [N]`);
  process.exit(1);
}

// A full 40-hex commit SHA pins a chardet build with no release tag (e.g. a
// prerelease that carries a not-yet-released fix). The tag path keys the
// corpus and generated-file stamps on the tag; the SHA path lets everything
// downstream fall through to its tagless behaviour (chardet-version.js stamps
// the short hash, the corpus derives to test-data 'main').
function isCommitSha(ref) {
  return /^[0-9a-f]{40}$/.test(ref);
}

function refreshTestFixturesForTag(tag) {
  // The corpus ref is derived from the submodule at run time, so the only
  // corpus work an update needs is refreshing the committed fixtures — but
  // check the matching test-data tag exists first: chardet tags test-data
  // with the same version for every release, so a missing tag means the
  // convention broke upstream. Stop rather than silently regenerate the
  // fixtures from the 'main' fallback. tests/data/ needs no refresh here —
  // ensureTestData re-clones it on the next test run when .test-data-ref
  // goes stale.
  const remoteTag = execSync(
    `git ls-remote --tags ${TEST_DATA_REPO} refs/tags/${tag}`,
    { encoding: 'utf8' },
  );
  if (!remoteTag.trim()) {
    throw new Error(`test-data repo has no tag ${tag}; fixtures not refreshed`);
  }
  // Pass the ref rather than letting the script derive it: the checkout is
  // already at the new tag while HEAD still records the old pin, so deriving
  // would (rightly) refuse.
  execSync(`node scripts/update-test-fixtures.js ${tag}`, { cwd: root, stdio: 'inherit' });
}

function refreshTestFixturesFromMain() {
  // A tagless pin (a commit SHA) derives its corpus to test-data 'main',
  // mirroring upstream's rule for dev builds. Pass 'main' explicitly rather
  // than deriving: the checkout is already at the new commit while HEAD still
  // records the old pin, so getTestDataRef would (rightly) refuse the drift.
  execSync(`node scripts/update-test-fixtures.js main`, { cwd: root, stdio: 'inherit' });
}

async function updateSubmodule(ref) {
  const sha = isCommitSha(ref);
  console.log(`Fetching ${ref}...`);
  if (sha) {
    // A bare `git fetch <sha>` needs enough depth to reach the commit; the
    // remote's default depth for an arbitrary object is 1, which is all the
    // pin needs (range analysis deepens the history separately before this).
    execSync(`git fetch --depth=1 origin ${ref}`, { cwd: chardetDir, stdio: 'inherit' });
  } else {
    execSync(`git fetch --depth=1 origin tag ${ref}`, { cwd: chardetDir, stdio: 'inherit' });
  }
  console.log(`Checking out ${ref}...`);
  execSync(`git checkout ${ref}`, { cwd: chardetDir, stdio: 'inherit' });
  console.log(`Done. chardet pinned to ${ref}.`);
  generateWhatwgMap();
  generateSbcsUndefinedBytes();
  generateByteTables();
  await generateModelBins();
  if (sha) {
    refreshTestFixturesFromMain();
  } else {
    refreshTestFixturesForTag(ref);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    const { tags, current } = listChardetTags(parseInt(args[1], 10) || 5);
    console.log(tags.map(t => t === current ? `${t} (current)` : t).join('\n'));
  } else if (args[0]) {
    await updateSubmodule(args[0]);
  } else {
    usage();
  }
}

await main();
