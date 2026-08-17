# Court card art

The twelve J/Q/K figures drawn inside the card face by `components/CardView.tsx`.

## Licence

**Public domain.** From Byron Knoll's *Vector Playing Cards*
(<https://code.google.com/p/vector-playing-cards/>), mirrored at
[hayeah/playing-cards-assets](https://github.com/hayeah/playing-cards-assets),
which records the same provenance. No attribution is required and none is
claimed; the files here are cropped and rasterised renderings of those SVGs.

## Regenerating

```bash
node scripts/build-court-art.mjs
```

The script downloads the source SVGs (~7.5 MB, not vendored), renders each in
Chromium and crops away the source card's own border and index corners, which
this app draws itself. `CROP` in that script and `COURT_ART_BOX` in
`components/cardFaceModel.ts` must stay equal — the source deck and this app's
card share an aspect ratio (0.688 vs 0.690), so placing the art at the fractions
it was cut from reproduces a real card's proportions.

## Why bitmaps and not the SVGs

The detailed source SVGs are 0.4–1.1 MB each — 7.5 MB for twelve — and each is
thousands of paths, which `react-native-svg` would re-parse for every card on
screen. Rendered at 82×241 they are ~35 KB each, 428 KB in total, and draw as a
single texture.

The repository also has `simple/` variants at ~12 KB. They are not used: they
carry no figure at all, only the rank letter and a large suit symbol, and are
byte-identical between jack, queen and king of the same suit.

## Why the jokers are not here

The source deck's joker is four suit symbols, identical in its red and black
variants. Murlan's two jokers are the deck's top two cards and have to be told
apart instantly, so they stay hand-drawn in `CardView.tsx`, distinguished by
what the figure holds and by colour.
