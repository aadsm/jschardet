#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TEST_DATA_REPO } from './lib/test-data.js';
import { generate as generateWhatwgMap } from './generate-encodings-whatwg-map.js';
import { generate as generateModelBins } from './generate-model-bins.js';
import { generate as generateSbcsUndefinedBytes } from './generate-sbcs-undefined-bytes.js';
import { generate as generateConfusionCaseTables } from './generate-confusion-case-tables.js';
import { listChardetTags } from './chardet-version.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chardetDir = join(root, 'chardet');

function usage() {
  const self = process.env.npm_lifecycle_event
    ? `npm run ${process.env.npm_lifecycle_event} --`
    : `node scripts/update-chardet.js`;
  console.error(`Usage: ${self} <tag>`);
  console.error(`       ${self} --list [N]`);
  process.exit(1);
}

function refreshTestFixtures(tag) {
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
  execSync('node scripts/update-test-fixtures.js', { cwd: root, stdio: 'inherit' });
}

async function updateSubmodule(tag) {
  console.log(`Fetching ${tag}...`);
  execSync(`git fetch --depth=1 origin tag ${tag}`, { cwd: chardetDir, stdio: 'inherit' });
  console.log(`Checking out ${tag}...`);
  execSync(`git checkout ${tag}`, { cwd: chardetDir, stdio: 'inherit' });
  console.log(`Done. chardet pinned to ${tag}.`);
  generateWhatwgMap();
  generateSbcsUndefinedBytes();
  generateConfusionCaseTables();
  await generateModelBins();
  refreshTestFixtures(tag);
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
