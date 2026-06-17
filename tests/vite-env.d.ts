// Vite query-suffix imports used by fixture-driven tests. Vite reads the
// file at transform time and inlines the bytes as a Uint8Array, so the
// same import works under both `npm test` (Node) and `npm run test:browser`.
declare module '*?uint8array' {
  const data: Uint8Array;
  export default data;
}
