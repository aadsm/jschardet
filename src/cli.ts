#!/usr/bin/env node
/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { detect, DEFAULT_MAX_BYTES, type DetectOptions, type DetectionResult } from './chardet.js';
import { EncodingEra } from './enums.js';
import { ISO_TO_LANGUAGE } from './utils.js';
import { VERSION } from './version.js';

// Mirrors chardet/src/chardet/cli.py, which builds its CLI declaratively with
// argparse. OPTIONS below is the single source of truth: each entry maps 1:1 to
// a `parser.add_argument(...)` call in cli.py, and both the parseArgs config and
// the --help text are derived from it so they cannot drift apart. Re-syncing
// with upstream is one table edit per argparse argument.

// Python: [e.name.lower() for e in EncodingEra if e.bit_count() == 1] + ["all"]
const ERA_NAMES = [
  ...Object.entries(EncodingEra)
    .filter(([, v]) => (v & (v - 1)) === 0) // single-bit members
    .map(([k]) => k.toLowerCase()),
  'all',
];

interface CliOption {
  name: string; // long flag, e.g. 'encoding-era'
  short?: string; // e.g. 'e'
  type: 'boolean' | 'string';
  help: string; // verbatim from the Python help=
  metavar?: string; // value placeholder shown in --help, e.g. 'ERA'
  choices?: readonly string[];
  default?: string;
}

const OPTIONS: readonly CliOption[] = [
  { name: 'minimal', type: 'boolean', help: 'Output only the encoding name' },
  { name: 'language', short: 'l', type: 'boolean', help: 'Include detected language in output' },
  { name: 'encoding-era', short: 'e', type: 'string', metavar: 'ERA', choices: ERA_NAMES, help: 'Encoding era filter' },
  { name: 'include-encodings', short: 'i', type: 'string', metavar: 'LIST', help: 'Comma-separated list of encodings to consider' },
  { name: 'exclude-encodings', short: 'x', type: 'string', metavar: 'LIST', help: 'Comma-separated list of encodings to exclude' },
  { name: 'no-match-encoding', type: 'string', metavar: 'ENC', default: 'cp1252', help: 'Encoding to return when detection is inconclusive (default: cp1252)' },
  { name: 'empty-input-encoding', type: 'string', metavar: 'ENC', default: 'utf-8', help: 'Encoding to return for empty input (default: utf-8)' },
  { name: 'help', short: 'h', type: 'boolean', help: 'Show this help message and exit' },
  { name: 'version', type: 'boolean', help: "Show program's version number and exit" },
];

// Node's parseArgs is the analogue of argparse's parser; build its options map
// from the table above.
const PARSE_ARGS_OPTIONS = Object.fromEntries(
  OPTIONS.map(o => [o.name, o.short ? { type: o.type, short: o.short } : { type: o.type }]),
) as Record<string, { type: 'boolean' | 'string'; short?: string }>;

// The parsed values, typed off the same option names (parseArgs widens these
// to string | boolean when options are computed rather than a literal).
interface CliValues {
  minimal?: boolean;
  language?: boolean;
  'encoding-era'?: string;
  'include-encodings'?: string;
  'exclude-encodings'?: string;
  'no-match-encoding'?: string;
  'empty-input-encoding'?: string;
  help?: boolean;
  version?: boolean;
}

// argparse synthesises --help for free; render an equivalent from the table.
function formatHelp(): string {
  const lines = [
    'Usage: jschardet [options] [files ...]',
    '',
    'Detect character encoding of files.',
    '',
    'Options:',
  ];
  for (const o of OPTIONS) {
    const value = o.type === 'string' ? ` ${o.metavar ?? 'VALUE'}` : '';
    const flag = `${o.short ? `-${o.short}, ` : '    '}--${o.name}${value}`;
    lines.push(`  ${flag.padEnd(34)}${o.help}`);
  }
  return `${lines.join('\n')}\n`;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function printResult(
  result: DetectionResult,
  label: string,
  minimal: boolean,
  language: boolean,
  write: (s: string) => void,
): void {
  if (minimal) {
    if (language) {
      const iso = result.language ?? 'und';
      write(`${result.encoding} ${iso}\n`);
    } else {
      write(`${result.encoding}\n`);
    }
  } else if (language) {
    const iso = result.language ?? 'und';
    const name = titleCase(ISO_TO_LANGUAGE[iso] ?? iso);
    write(`${label}: ${result.encoding} ${iso} (${name}) with confidence ${result.confidence}\n`);
  } else {
    write(`${label}: ${result.encoding} with confidence ${result.confidence}\n`);
  }
}

export interface MainOptions {
  stdin?: Uint8Array;
  write?: (s: string) => void;
  writeErr?: (s: string) => void;
  detectFn?: (bytes: Uint8Array, options: DetectOptions) => DetectionResult;
}

export async function main(argv: string[], opts: MainOptions = {}): Promise<number> {
  const write = opts.write ?? process.stdout.write.bind(process.stdout);
  const writeErr = opts.writeErr ?? process.stderr.write.bind(process.stderr);
  const detectFn = opts.detectFn ?? detect;

  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: PARSE_ARGS_OPTIONS,
  });

  const files = parsed.positionals;
  const values = parsed.values as CliValues;

  if (values.help) {
    write(formatHelp());
    return 0;
  }

  if (values.version) {
    write(`jschardet ${VERSION}\n`);
    return 0;
  }

  const minimal = values.minimal ?? false;
  const language = values.language ?? false;
  const eraName = values['encoding-era'];
  const era = eraName
    ? EncodingEra[eraName.toUpperCase() as keyof typeof EncodingEra] ?? EncodingEra.ALL
    : EncodingEra.ALL;

  const include = values['include-encodings']
    ? values['include-encodings'].split(',').map(s => s.trim())
    : undefined;
  const exclude = values['exclude-encodings']
    ? values['exclude-encodings'].split(',').map(s => s.trim())
    : undefined;
  const noMatchEncoding = values['no-match-encoding'] ?? 'cp1252';
  const emptyInputEncoding = values['empty-input-encoding'] ?? 'utf-8';

  const detectOptions: DetectOptions = {
    encodingEra: era,
    includeEncodings: include,
    excludeEncodings: exclude,
    noMatchEncoding,
    emptyInputEncoding,
  };

  if (files.length > 0) {
    let errors = 0;
    for (const filepath of files) {
      let data: Uint8Array;
      try {
        data = readFileSync(filepath).subarray(0, DEFAULT_MAX_BYTES);
      } catch (e) {
        writeErr(`jschardet: ${filepath}: ${e}\n`);
        errors += 1;
        continue;
      }
      let result: DetectionResult;
      try {
        result = detectFn(data, detectOptions);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        writeErr(`jschardet: ${filepath}: detection failed: ${msg}\n`);
        errors += 1;
        continue;
      }
      printResult(result, filepath, minimal, language, write);
    }
    return errors === files.length ? 1 : 0;
  }

  let data: Uint8Array;
  if (opts.stdin !== undefined) {
    data = opts.stdin.subarray(0, DEFAULT_MAX_BYTES);
  } else {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      const buf = chunk as Buffer;
      chunks.push(buf);
      total += buf.length;
      if (total >= DEFAULT_MAX_BYTES) break;
    }
    data = Buffer.concat(chunks).subarray(0, DEFAULT_MAX_BYTES);
  }

  let result: DetectionResult;
  try {
    result = detectFn(data, detectOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(`jschardet: stdin: detection failed: ${msg}\n`);
    return 1;
  }
  printResult(result, 'stdin', minimal, language, write);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { if (code !== 0) process.exit(code); });
}
