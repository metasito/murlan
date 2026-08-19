/**
 * Web loads its faces through CSS, not `useFonts`.
 *
 * `@expo-google-fonts/*` ships TTF only — 2.1 MB across the six weights the app
 * uses — so importing any of them here would put every byte in the web bundle
 * whether or not a glyph is ever drawn from it. The browser gets the WOFF2
 * subsets in public/fonts instead, declared by the @font-face block in
 * public/index.html and fetched only when text is first painted in that face.
 *
 * Rebuild the subsets with `node scripts/build-fonts.mjs`;
 * tests/fontSubset.test.ts fails if a string grows a character they lack, or if
 * a weight loses its declaration.
 */
export const APP_FONTS = {};
