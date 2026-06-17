// Vite plugin used by the bundle test configs. Redirects any import that
// resolves inside `srcDir` to a single bundle file, so tests run against
// the built artefact rather than unbundled src/.
//
// Boundary enforcement is delegated to the bundle's own export shape:
// imports of symbols a bundle doesn't expose fail at module-link time
// with a clear "X is not exported by ..." error. No enumerated
// allowlist or forbid list to keep in sync.

import { sep } from 'node:path';

export function bundleRedirectPlugin({ srcDir, bundle }) {
  const prefix = srcDir.endsWith(sep) ? srcDir : srcDir + sep;
  return {
    name: 'bundle-redirect',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!importer) return null;
      // Don't intercept the ?uint8array fixture imports — they need the
      // raw on-disk path so uint8arrayPlugin can read the bytes.
      if (id.includes('?uint8array')) return null;
      const resolved = await this.resolve(id, importer, { skipSelf: true });
      if (!resolved) return null;
      if (resolved.id === bundle) return null;
      if (resolved.id.startsWith(prefix)) return bundle;
      return null;
    },
  };
}
