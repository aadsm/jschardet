#!/usr/bin/env node
// Usage: node scripts/get-version-bump.js <semver-update>
// Prints the arguments to hand to `npm version` for the requested bump.
//
// Exists because two kinds of choice in .github/workflows/npm-publish.yml don't
// map onto an npm keyword as-is:
//   - the pre* bumps need an explicit --preid, otherwise npm drops the
//     identifier entirely (`npm version prerelease` on 4.3.2 yields 4.3.3-0,
//     not 4.3.3-rc.0). On a version that already carries an -rc.N suffix the
//     --preid is a no-op, so passing it unconditionally is safe.
//   - `release` isn't an npm keyword at all. It graduates a release candidate
//     to its final version (4.0.0-rc.1 -> 4.0.0) by passing that version
//     explicitly. Relying on `npm version patch` would happen to do the same
//     thing, but only by accident of semver's rules, and it would report the
//     bump as a patch in the changelog.
import { readFileSync } from 'node:fs';

// The prerelease identifier, matching the `rc` npm dist-tag that
// .github/workflows/npm-publish.yml publishes prereleases under.
const PREID = 'rc';
const PLAIN = ['patch', 'minor', 'major'];
const PRE = ['prepatch', 'preminor', 'premajor', 'prerelease'];

const [semverUpdate] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (PLAIN.includes(semverUpdate)) {
  process.stdout.write(`${semverUpdate}\n`);
} else if (PRE.includes(semverUpdate)) {
  process.stdout.write(`${semverUpdate} --preid=${PREID}\n`);
} else if (semverUpdate === 'release') {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const final = version.split('-')[0];
  if (final === version) {
    fail(`Error: 'release' promotes a release candidate to final, but package.json is already at a final version (${version})`);
  }
  process.stdout.write(`${final}\n`);
} else {
  fail(`Error: unknown version bump '${semverUpdate ?? ''}' (expected one of: ${[...PLAIN, ...PRE, 'release'].join(', ')})`);
}
