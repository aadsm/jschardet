// Run TS detect() on every corpus file in tests/data/.
//
// Writes one JSON record per line to the output file (default /tmp/ts_detect.jsonl):
// {id, encoding, confidence, language}.
//
// Usage:
//   npx tsx tests/compare-detect/typescript.mjs [--out /path/to/file.jsonl]

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'tests', 'data');

const argOut = process.argv.indexOf('--out');
const OUT = argOut !== -1 ? process.argv[argOut + 1] : '/tmp/ts_detect.jsonl';

const { detect } = await import(path.join(REPO_ROOT, 'src/chardet.js'));
const { EncodingEra } = await import(path.join(REPO_ROOT, 'src/enums.js'));

function collectFiles(dataDir) {
  const out = [];
  for (const dirName of fs.readdirSync(dataDir).sort()) {
    const dirPath = path.join(dataDir, dirName);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    if (dirName.lastIndexOf('-') === -1) continue;
    for (const fname of fs.readdirSync(dirPath).sort()) {
      const fp = path.join(dirPath, fname);
      if (fs.statSync(fp).isFile()) {
        out.push({ id: `${dirName}/${fname}`, fp });
      }
    }
  }
  return out;
}

const files = collectFiles(DATA_DIR);
process.stderr.write(`Detecting ${files.length} files with TypeScript port\n`);

const out = fs.createWriteStream(OUT);
for (let i = 0; i < files.length; i++) {
  if (i && i % 500 === 0) process.stderr.write(`  ${i}/${files.length}\n`);
  const { id, fp } = files[i];
  const data = fs.readFileSync(fp);
  const r = detect(data, { encodingEra: EncodingEra.ALL, preferSuperset: true });
  out.write(JSON.stringify({
    id,
    encoding: r.encoding ?? null,
    confidence: r.confidence ?? null,
    language: r.language ?? null,
  }) + '\n');
}
out.end();
process.stderr.write(`Wrote ${OUT}\n`);
