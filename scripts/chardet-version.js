import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chardetDir = join(root, 'chardet');

// Fetches all remote tags and returns two maps for hash->tag resolution plus
// a version-sorted list. peeled maps actual commit hashes (from annotated-tag
// ^{} entries); direct maps tag-object hashes (lightweight tags / fallback).
function fetchRemoteTagMaps() {
  const lines = execSync('git ls-remote --tags --sort=-version:refname origin', {
    cwd: chardetDir, stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim().split('\n');
  const peeled = new Map();
  const direct = new Map();
  const sorted = [];
  for (const line of lines) {
    const [h, ref] = line.split('\t');
    if (!ref) continue;
    const tag = ref.replace('refs/tags/', '');
    if (tag.endsWith('^{}')) {
      peeled.set(h.trim(), tag.slice(0, -3));
    } else {
      direct.set(h.trim(), tag);
      if (/^\d+\.\d+/.test(tag)) sorted.push(tag);
    }
  }
  return { peeled, direct, sorted };
}

function resolveHash(hash, { peeled, direct }) {
  return peeled.get(hash) ?? direct.get(hash) ?? null;
}

export function chardetVersion() {
  const hash = execSync('git rev-parse HEAD', { cwd: chardetDir }).toString().trim();
  const short = hash.slice(0, 12);
  const tag = resolveHash(hash, fetchRemoteTagMaps());
  return tag ? `${tag} (${short})` : short;
}

// Returns the chardet version pinned at the given git ref (tag or commit)
// in the parent repo, or null if chardet wasn't present at that ref.
export function chardetVersionAt(ref) {
  let hash;
  try {
    const lsTree = execSync(`git ls-tree ${ref} chardet`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    hash = lsTree.split(/\s+/)[2];
  } catch {
    return null;
  }
  if (!hash) return null;
  const short = hash.slice(0, 12);
  const tag = resolveHash(hash, fetchRemoteTagMaps());
  return tag ? `${tag} (${short})` : short;
}

// Returns the N most recent chardet tags from the remote, plus the current tag.
// Result: { tags: string[], current: string | null }
export function listChardetTags(n) {
  const headHash = execSync('git rev-parse HEAD', { cwd: chardetDir }).toString().trim();
  const maps = fetchRemoteTagMaps();
  const current = resolveHash(headHash, maps);
  const top = maps.sorted.slice(0, n);
  if (current && !top.includes(current)) top.push(current);
  return { tags: top, current };
}
