#!/usr/bin/env node
// Usage: node scripts/generate-changelog.js <from-tag> <version> <semver-update>
// Prints the full changelog file contents to stdout.
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chardetVersion, chardetVersionAt } from './chardet-version.js';

const [fromTag, version, semverUpdate] = process.argv.slice(2);
if (!fromTag || !version || !semverUpdate) {
  process.stderr.write('Usage: generate-changelog.js <from-tag> <version> <semver-update>\n');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const repoUrl = pkg.repository.url.replace(/\.git$/, '');

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

const currentChardet = chardetVersion();
const oldChardet = chardetVersionAt(fromTag);
const chardetLine = (oldChardet && oldChardet !== currentChardet)
  ? `Based on chardet ${oldChardet} → ${currentChardet}`
  : `Based on chardet ${currentChardet}`;

process.stdout.write(
  `Version ${version} (${semverUpdate} update)\n\n${chardetLine}\n\nChanges since ${fromTag}:\n${changesList}\n\nBundle size changes since ${fromTag}:\n${sizeLines}\n`
);
