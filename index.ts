// Entry point for loaders that resolve a plugin directory through `index.ts`
// (a configured plugin path does that) rather than the package `exports` field.
// The published package uses `exports` and the relative imports of src/.
export { default } from "./src/index";
