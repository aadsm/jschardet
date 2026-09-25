#!/usr/bin/env node
// Usage: node scripts/generate-changelog.js <from-tag> <version> <semver-update>
// Prints the full changelog file contents to stdout.
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chardetCommitAt, describeChardetCommit } from './chardet-version.js';

const [fromTag, version, semverUpdate] = process.argv.slice(2);
if (!fromTag || !version || !semverUpdate) {
  process.stderr.write('Usage: generate-changelog.js <from-tag> <version> <semver-update>\n');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
// repository.url is in npm's git+https://….git form; commit links need neither part.
const repoUrl = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

const log = execSync(`git log --pretty='format:%h %s' ${fromTag}..HEAD~1`).toString().trim();
const allLines = log.split('\n').filter(Boolean);
const filteredLines = allLines.filter(line => /^\S+ ci:/.test(line));
const commits = allLines
  .filter(line => !/^\S+ ci:/.test(line))
  .map(line => line.replace(/^(\S+) /, (_, hash) => `- [${hash}](${repoUrl}/commit/${hash}) `))
  .join('\n');
const omittedNote = filteredLines.length > 0
  ? `- _(${filteredLines.length} ci commit${filteredLines.length === 1 ? '' : 's'} omitted)_`
  : '';
const changesList = [commits, omittedNote].filter(Boolean).join('\n');

const DIST_FILES = [
  'dist/jschardet.js',
  'dist/jschardet.min.js',
  'dist/jschardet.esm.js',
  'dist/jschardet.esm.min.js',
];

function fmt(n) {
  return n.toLocaleString('en-US');
}

const sizeLines = DIST_FILES.map(file => {
  let oldSize = null;
  let newSize = null;

  try {
    oldSize = parseInt(execSync(`git cat-file -s ${fromTag}:${file}`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(), 10);
  } catch {}

  try {
    newSize = statSync(file).size;
  } catch {}

  if (oldSize === null && newSize === null) return null;
  if (oldSize === null) return `- ${file} (new, ${fmt(newSize)} bytes)`;
  if (newSize === null) return `- ${file} (deleted, was ${fmt(oldSize)} bytes)`;

  const delta = newSize - oldSize;
  const sign = delta >= 0 ? '+' : '-';
  const pct = ((Math.abs(delta) / oldSize) * 100).toFixed(2);
  return `- ${file} ${sign}${fmt(Math.abs(delta))} ${sign}${pct}% (${fmt(oldSize)} -> ${fmt(newSize)})`;
}).filter(Boolean).join('\n');

// A release tag reads "7.6.0 (<hash>, 2026-08-14)"; an untagged commit reads
// "<hash> (7.6.0 + 32 commits, 2026-08-30)", so the notes say how far past a
// release the pin is. The hash links to the commit on GitHub.
function formatChardet(hash) {
  const { tag, date, base, ahead } = describeChardetCommit(hash);
  const link = `[${hash.slice(0, 12)}](https://github.com/chardet/chardet/commit/${hash})`;
  if (tag) return `${tag} (${[link, date].filter(Boolean).join(', ')})`;
  const since = base ? `${base} + ${ahead} commit${ahead === 1 ? '' : 's'}` : null;
  const details = [since, date].filter(Boolean).join(', ');
  return details ? `${link} (${details})` : link;
}

const currentChardet = chardetCommitAt();
const oldChardet = chardetCommitAt(fromTag);
const chardetLine = (oldChardet && oldChardet !== currentChardet)
  ? `Based on chardet ${formatChardet(oldChardet)} → ${formatChardet(currentChardet)}`
  : `Based on chardet ${formatChardet(currentChardet)}`;

// 'release' promotes a release candidate rather than bumping a version part,
// so "(release update)" would read oddly.
const updateLabel = semverUpdate === 'release' ? 'final release' : `${semverUpdate} update`;

process.stdout.write(
  `Version ${version} (${updateLabel})\n\n${chardetLine}\n\nChanges since ${fromTag}:\n${changesList}\n\nBundle size changes since ${fromTag}:\n${sizeLines}\n`
);
