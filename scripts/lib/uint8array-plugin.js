// Vite plugin: import binary files as Uint8Array via the `?uint8array`
// query suffix. Vite ships `?raw` (string) and `?url` (URL string) but
// no first-class binary-bytes import; this plugin fills that gap so
// fixture-driven tests work identically in Node and browser modes.
//
// Usage in test code:
//   import data from './fixtures/foo.bin?uint8array';
//   //   ^ data: Uint8Array
//
// The bytes are read at transform time and emitted as a literal
// `new Uint8Array([...])`, so there's no fs call left at runtime.

import * as fs from 'node:fs';

const QUERY = '?uint8array';

export function uint8arrayPlugin() {
  return {
    name: 'uint8array-import',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith(QUERY)) return null;
      const cleanId = id.slice(0, -QUERY.length);
      // Defer to Vite's resolver for the underlying file path, then
      // re-attach the query so `load` sees it.
      return this.resolve(cleanId, importer, { skipSelf: true }).then((res) => {
        if (!res) return null;
        return res.id + QUERY;
      });
    },
    load(id) {
      if (!id.endsWith(QUERY)) return null;
      const filePath = id.slice(0, -QUERY.length);
      const bytes = fs.readFileSync(filePath);
      const arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return `export default new Uint8Array([${arr.join(',')}]);`;
    },
  };
}
