import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chardetDir = join(root, 'chardet');

// An unchecked-out submodule leaves an empty directory behind, and git commands
// run inside it walk up to the parent repo and answer about jschardet instead —
// silently, so callers report a jschardet commit as if it were a chardet one.
function assertChardetCheckedOut() {
  if (!existsSync(join(chardetDir, '.git'))) {
    throw new Error("chardet submodule isn't checked out — run `git submodule update --init chardet`");
  }
}

// Fetches all remote tags and returns two maps for hash->tag resolution plus
// a version-sorted list. peeled maps actual commit hashes (from annotated-tag
// ^{} entries); direct maps tag-object hashes (lightweight tags / fallback).
function fetchRemoteTagMaps() {
  const lines = execSync('git ls-remote --tags --sort=-version:refname origin', {
    cwd: chardetDir, stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim().split('\n');
  const peeled = new Map();
  const direct = new Map();
  const commitOf = new Map();
  const sorted = [];
  for (const line of lines) {
    const [h, ref] = line.split('\t');
    if (!ref) continue;
    const tag = ref.replace('refs/tags/', '');
    if (tag.endsWith('^{}')) {
      peeled.set(h.trim(), tag.slice(0, -3));
      commitOf.set(tag.slice(0, -3), h.trim()); // replaces the tag-object hash
    } else {
      direct.set(h.trim(), tag);
      if (!commitOf.has(tag)) commitOf.set(tag, h.trim());
      if (/^\d+\.\d+/.test(tag)) sorted.push(tag);
    }
  }
  return { peeled, direct, commitOf, sorted };
}

function resolveHash(hash, { peeled, direct }) {
  return peeled.get(hash) ?? direct.get(hash) ?? null;
}

export function chardetVersion() {
  assertChardetCheckedOut();
  const hash = execSync('git rev-parse HEAD', { cwd: chardetDir }).toString().trim();
  const short = hash.slice(0, 12);
  const tag = resolveHash(hash, fetchRemoteTagMaps());
  return tag ? `${tag} (${short})` : short;
}

// Returns the full chardet commit hash pinned at the given parent-repo ref, or
// null if chardet wasn't present at that ref. Without a ref, the checkout's.
export function chardetCommitAt(ref) {
  assertChardetCheckedOut();
  if (!ref) return execSync('git rev-parse HEAD', { cwd: chardetDir }).toString().trim();
  try {
    const lsTree = execSync(`git ls-tree ${ref} chardet`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    return lsTree.split(/\s+/)[2] || null;
  } catch {
    return null;
  }
}

// Describes a chardet commit for release notes: its release tag when it is
// one; otherwise the newest release it descends from (base), how many commits
// it is past that release (ahead), and its commit date. base and ahead are null
// when the checkout lacks the history to tell (a shallow clone).
export function describeChardetCommit(hash) {
  assertChardetCheckedOut();
  const git = cmd => execSync(cmd, { cwd: chardetDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  const maps = fetchRemoteTagMaps();
  const tag = resolveHash(hash, maps);
  let date = null;
  try {
    date = git(`git show -s --format=%cs ${hash}`);
  } catch {}
  let base = null;
  let ahead = null;
  if (!tag) {
    for (const candidate of maps.sorted) {
      const commit = maps.commitOf.get(candidate);
      try {
        git(`git merge-base --is-ancestor ${commit} ${hash}`);
      } catch {
        continue; // not an ancestor, or its commit isn't in this checkout
      }
      base = candidate;
      ahead = parseInt(git(`git rev-list --count ${commit}..${hash}`), 10);
      break;
    }
  }
  return { tag, date, base, ahead };
}

// Returns the N most recent chardet tags from the remote, plus the current tag.
// Result: { tags: string[], current: string | null }
export function listChardetTags(n) {
  assertChardetCheckedOut();
  const headHash = execSync('git rev-parse HEAD', { cwd: chardetDir }).toString().trim();
  const maps = fetchRemoteTagMaps();
  const current = resolveHash(headHash, maps);
  const top = maps.sorted.slice(0, n);
  if (current && !top.includes(current)) top.push(current);
  return { tags: top, current };
}
