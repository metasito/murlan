# Murlan Visual & Audio Upgrade — Design Spec

> **STATUS: SHIPPED.** Verified implemented on 2026-08-15 by reading the code, not the
> changelog. The ornate SVG card back, the gold selected-glow ring, the `-14px` spring lift,
> the face-card gold border and the unified MP3 web audio via `decodeAudioData` are all
> present. This document is kept as a historical record of that work — it is **not** a
> backlog item. Do not re-implement it.
>
> Current design direction lives in `docs/BRIEF.md`; this spec predates it and does not
> describe the visual work still outstanding.

**Date:** 2026-06-04
**Aesthetic direction:** Opulent Casino — richer golds with glow, deeper felt, premium card rendering, satisfying sounds

---

## Scope

Incremental polish across four areas. No new components, no architecture changes, no game logic touched. Both `app/game.tsx` and `app/(online)/game.tsx` must be updated together wherever layout constants or shared visuals are involved.

---

## 1. Cards (`components/CardView.tsx`)

### Card face

- Border-radius: 6 → **8px**
- Drop shadow: increase depth — `0 4px 16px rgba(0,0,0,0.7)` (web: `boxShadow`)
- Rank font size: 14 → **15px** (normal), 10 → **11px** (small)
- Center suit symbol: 30 → **34px**, add `textShadowColor` matching the suit color at 30% opacity and `textShadowRadius: 4`
- **Selected state:** Replace thin `borderColor` change with a gold glow ring:
  - Web: `boxShadow: "0 0 0 2px #C9A84C, 0 0 12px rgba(201,168,76,0.5)"`
  - Native: `borderColor: "#C9A84C"` + `borderWidth: 2` + `shadowColor: "#C9A84C"`, `shadowOpacity: 0.5`, `shadowRadius: 8`
- Joker colored: background `#FFF8F0` (warm cream)
- Joker B&W: background `#F4F4F4` (cool white)

### Face cards (J, Q, K)

- Add a thin gold border: `1.5px solid rgba(201,168,76,0.4)` to distinguish royals from number cards

### Card back (faceDown branch)

Replace current two-rectangle pattern with an ornate SVG pattern using `react-native-svg` (already imported):
- Outer border: gold `#C9A84C` at 80% opacity, `1.5px` stroke
- Inner border inset 4px: gold at 40% opacity
- Background fill: diagonal crosshatch of thin diamond shapes in `rgba(201,168,76,0.12)`
- Central motif: a four-pointed star `✦` or small SVG diamond in `rgba(201,168,76,0.6)`
- Background color stays felt-green `Colors.felt`

---

## 2. Table & Atmosphere (`components/GameShared.tsx`)

### Felt table

- Replace 3-stop `LinearGradient` with 5-stop: `["#0F5A35", "#0D4A2E", "#0B3B25", "#082B1A", "#061E12"]`, `locations: [0, 0.25, 0.5, 0.75, 1]` — produces a casino spotlight center effect
- Table outer border: `rgba(201,168,76,0.3)` → **`rgba(201,168,76,0.5)`**, border width 3 → **3.5px**
- Inner border opacity: 0.12 → **0.2**
- Add a vignette overlay: four `absoluteFill`-positioned `LinearGradient` strips with `pointerEvents: "none"` — one on each edge, each fading from `rgba(0,0,0,0.32)` at the edge to `transparent` inward (12% of table size). Purely decorative depth.

### Player avatars (`AvatarCircle`)

- Active avatar: apply `Shadow.gold` from `lib/theme.ts` to `avatarOuterActive` (already defined, just not applied)
- Inactive avatar inner: solid `rgba(11,59,37,0.95)` → `LinearGradient ["#0D4A2E", "#0B3B25"]`
- Count bubble border: `rgba(201,168,76,0.3)` → **`rgba(201,168,76,0.55)`**
- Finished player bubble: swap bare trophy icon for a gold-background bubble (`backgroundColor: Colors.goldMuted`, `borderColor: Colors.gold`)

### Combo label chip (`PlayedPile`)

- Background: `rgba(201,168,76,0.2)` → **`rgba(201,168,76,0.28)`**
- Letter-spacing: 1 → **1.5**
- Bomb and royal_straight chips: distinct styling — `backgroundColor: "rgba(255,80,80,0.2)"`, `borderColor: "rgba(255,80,80,0.5)"`, text color `#FF8080`
- Prefix `✦` before bomb/royal_straight label text

### GameBillboard (top bar)

- "Il tuo turno" state: add a pulsing gold dot `●` before the text, animated with `withRepeat(withSequence(withTiming(1,...), withTiming(0.3,...)))` at ~1.8s cycle
- Combo label font size: 12 → **13px**

---

## 3. Animations

### Card selection (`CardItem` in `GameShared.tsx`)

- Lift: -10 → **-14px**
- Replace `withTiming` with `withSpring(selected ? -14 : 0, { damping: 12, stiffness: 280 })` — snappier, physical
- Add simultaneous scale: `withSpring(selected ? 1.04 : 1.0, { damping: 10, stiffness: 260 })`

### GIOCA button (`app/game.tsx` + `app/(online)/game.tsx`)

- When valid: add a continuous slow bloom — `withRepeat(withSequence(withTiming(1.0,...), withTiming(0.88,...)), -1)` on a `glowOpacity` shared value applied to the gradient's outer glow (web: `boxShadow` opacity, native: `shadowOpacity`). Cycle ~2s.
- On press: add brief brightness flash — `withSequence(withTiming(1.08, {duration:80}), withSpring(1.0, {damping:10}))` on scale after the current scale-down

### Flying cards (`FlyingCards` in `GameShared.tsx`)

- Add parabolic arc: introduce a `midArcY` shared value that peaks at `-20px` at 50% of flight using `withSequence(withTiming(-20, {duration: FLIGHT*0.5}), withTiming(0, {duration: FLIGHT*0.5}))`, added to `ty`
- Flight duration: 340 → **380ms**
- On landing: trigger a micro-bounce on `PlayedPile` — expose an `onLand` callback that animates a `scale 1.0 → 1.05 → 1.0` spring on the pile container

### Bomb / Royal Straight screen shake (`app/game.tsx` + `app/(online)/game.tsx`)

- Add a `shakeX` shared value on the root `View`
- When `combo.type === "bomb" || "royal_straight"` is detected (same place `playBomb()` is called): trigger `withSequence(withTiming(4), withTiming(-4), withTiming(3), withTiming(-3), withTiming(2), withTiming(-2), withTiming(0))` — 300ms total oscillation
- Applied via `useAnimatedStyle` on the root view's `transform`

### Turn pulse (`useTurnPulse` in `GameShared.tsx`)

- Existing: opacity-only glow on hand section
- Add: `borderColor` interpolated from `transparent` → `rgba(201,168,76,0.3)` in sync with the glow value, applied to `handSection` style

### Winner celebration (`app/result.tsx` `WinnerCelebration`)

- `celebGlow` circle: add scale pulse synced with the existing opacity pulse — `withRepeat(withSequence(withTiming(1.15,...), withTiming(1.0,...)), -1)` on a `glowScale` shared value

---

## 4. Sound System (`lib/sounds.ts`)

### Unification: both platforms use MP3 files

**Problem:** Web currently uses synthesized oscillator tones; native uses MP3 files. Sounds differ between platforms.

**Solution:** Load the same MP3 assets on web via `fetch` + `AudioContext.decodeAudioData`:

```ts
// New web audio cache
const webAudioCache: Record<string, AudioBuffer> = {};

async function playWeb(key: string, assetModule: number, volume = 1.0): Promise<void> {
  const ctx = getWebCtx();
  if (!ctx) return;
  let buffer = webAudioCache[key];
  if (!buffer) {
    // On Expo web, require() returns a URL string
    const url = assetModule as unknown as string;
    const resp = await fetch(url);
    const arrayBuf = await resp.arrayBuffer();
    buffer = await ctx.decodeAudioData(arrayBuf);
    webAudioCache[key] = buffer;
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = volume;
  source.start();
}
```

- All `playWeb*` synthesized functions are **removed**
- Each `export async function playXxx()` uses `playWeb(key, require(...), volume)` on web instead of the synthesized function
- `preloadSounds()` on web: fetch + decode all 12 assets in parallel, populate `webAudioCache`

### Replace MP3 files in `assets/sounds/`

Source all 12 files as free CC0 audio from mixkit.co / freesound.org. Target character per file:

| File | Target character | Max duration |
|---|---|---|
| `card_select.mp3` | Crisp paper flick/card tap | 150ms |
| `card_play.mp3` | Satisfying card slap on felt | 200ms |
| `card_pass.mp3` | Soft whoosh or skip | 200ms |
| `your_turn.mp3` | 2-note attention chime | 400ms |
| `round_start.mp3` | Brief shuffle or deal fanfare | 600ms |
| `round_win.mp3` | 3-note ascending win jingle | 700ms |
| `urgent_tick.mp3` | Sharp tick, slightly alarming | 100ms |
| `bomb.mp3` | Deep thud + crack impact | 500ms |
| `game_win.mp3` | Full triumphant fanfare | 1500ms |
| `game_lose.mp3` | Descending somber 3-note | 800ms |
| `deal.mp3` | Rapid card-dealing flutter | 400ms |
| `exchange.mp3` | Magical swap chime | 500ms |

---

## Files Changed

| File | Change |
|---|---|
| `components/CardView.tsx` | Card face polish, selected glow ring, ornate back SVG, face card gold border |
| `components/GameShared.tsx` | Felt table gradient, vignette, avatar polish, combo chip, billboard dot, card selection spring+scale, flying card arc+duration, turn pulse border, pile bounce callback |
| `app/game.tsx` | GIOCA bloom + press flash, screen shake on bomb |
| `app/(online)/game.tsx` | Same as above (must mirror game.tsx changes) |
| `app/result.tsx` | Winner glow scale pulse |
| `lib/sounds.ts` | Unified web+native MP3 playback, remove synthesized functions |
| `assets/sounds/*.mp3` | Replace all 12 with higher-quality CC0 files |

## Files NOT Changed

- `lib/gameEngine.ts` — game rules untouched
- `lib/socket.ts` — socket singleton untouched
- `server/` — no backend changes
- `shared/schema.ts` — no schema changes
- Layout constants (`CARD_W`, `CARD_H`, `SIDE_BTN_W`, etc.) — untouched
- `lib/theme.ts` — no token changes (values used as-is)
