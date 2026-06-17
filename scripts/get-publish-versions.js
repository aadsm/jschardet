#!/usr/bin/env node
// Prints CURRENT_PKG_VERSION, CURRENT_TAG_VERSION, CURRENT_PUBLISHED_VERSION
// as KEY=VALUE lines to stdout (suitable for >> $GITHUB_ENV).
// Prints version mismatch warnings to stderr.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version: pkgVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tagVersion = execSync(`git tag --list 'v*' --sort='-version:refname'`).toString().trim().split('\n')[0];
const publishedVersion = execSync('npm view jschardet version').toString().trim();

if (pkgVersion !== publishedVersion) {
  process.stderr.write(`Warning: package version (${pkgVersion}) doesn't match published version (${publishedVersion})\n`);
}
if (tagVersion !== `v${pkgVersion}`) {
  process.stderr.write(`Warning: tag version (${tagVersion}) doesn't match package version (v${pkgVersion})\n`);
}

process.stdout.write([
  `CURRENT_PKG_VERSION=${pkgVersion}`,
  `CURRENT_TAG_VERSION=${tagVersion}`,
  `CURRENT_PUBLISHED_VERSION=${publishedVersion}`,
].join('\n') + '\n');
