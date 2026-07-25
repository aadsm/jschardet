#!/usr/bin/env node
// Prints CURRENT_PKG_VERSION, CURRENT_TAG_VERSION, CURRENT_STABLE_TAG_VERSION,
// CURRENT_PUBLISHED_VERSION and CURRENT_PUBLISHED_RC_VERSION as KEY=VALUE lines
// to stdout (suitable for >> $GITHUB_ENV).
// Prints version mismatch warnings to stderr.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version: pkgVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// versionsort.suffix=- makes git sort v4.0.0-rc.1 *below* v4.0.0; without it a
// release candidate outranks the release it precedes.
const tags = execSync(`git -c versionsort.suffix=- tag --list 'v*' --sort='-version:refname'`)
  .toString().trim().split('\n').filter(Boolean);
const tagVersion = tags[0] ?? '';
// Newest tag with no prerelease suffix. Graduating a release candidate reports
// its changelog against this instead, so the notes cover the whole rc series
// rather than only what changed since the previous rc.
const stableTagVersion = tags.find(tag => !tag.includes('-')) ?? tagVersion;

// dist-tags rather than `npm view jschardet version`: the latter only reports
// `latest`, so every prerelease run would warn about a mismatch that isn't one.
const distTags = JSON.parse(execSync('npm view jschardet dist-tags --json').toString());
const publishedVersion = distTags.latest ?? '';
const publishedRcVersion = distTags.rc ?? '';

if (!Object.values(distTags).includes(pkgVersion)) {
  const summary = Object.entries(distTags).map(([tag, version]) => `${tag}: ${version}`).join(', ');
  process.stderr.write(`Warning: package version (${pkgVersion}) isn't published under any dist-tag (${summary})\n`);
}
if (tagVersion !== `v${pkgVersion}`) {
  process.stderr.write(`Warning: tag version (${tagVersion}) doesn't match package version (v${pkgVersion})\n`);
}

process.stdout.write([
  `CURRENT_PKG_VERSION=${pkgVersion}`,
  `CURRENT_TAG_VERSION=${tagVersion}`,
  `CURRENT_STABLE_TAG_VERSION=${stableTagVersion}`,
  `CURRENT_PUBLISHED_VERSION=${publishedVersion}`,
  `CURRENT_PUBLISHED_RC_VERSION=${publishedRcVersion}`,
].join('\n') + '\n');
