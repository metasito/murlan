import React, { useContext, useEffect } from "react";
import { View, StyleSheet, Pressable, Image, Platform } from "react-native";
import { TableText } from "@/components/table/TableText";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { Asset } from "expo-asset";
import Svg, { Path, Circle, G, Rect } from "react-native-svg";
import { Card, Suit, getCardDisplayRank } from "@/lib/game/gameEngine";
import {
  cardShadow,
  Colors,
  FontSize,
  Layer,
  Motion,
  withAlpha,
} from "@/lib/theme";
import { CardCastContext } from "@/components/table/feltReady";
import { GLOSS_SPOT_ART, LampGloss } from "@/components/table/LampGloss";
import type { OwnedRects } from "@/components/table/useCardRects";
import { cardBackId, getCardBack, useCardBackId, type CardBackId } from "@/lib/cosmetics";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { useTranslation } from "@/lib/i18n";
import { cardSpokenName } from "@/lib/cardNames";
import {
  CARD_BACK_H,
  CARD_BACK_W,
  CARD_H,
  CARD_W,
  cardRadius,
  COURT_RANKS,
  courtArtRect,
  faceMarks,
  INDEX_SUIT_SIZE,
  INDEX_SUIT_Y,
  INDEX_TEXT_W,
  INDEX_X,
  rankFontSize,
  rankInset,
  stockLipHeight,
  SUIT_GLYPHS,
  suitMarksPath,
} from "@/components/cardFaceModel";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

// Suit → colour. `Suit` is plural ("spades") while the theme tokens are singular
// ("spade"), so the mapping has to be explicit. Typed as Record<Suit, string> so
// the compiler catches a missing or misspelled suit instead of silently
// yielding undefined.
export const SUIT_COLORS: Record<Suit, string> = {
  spades: Colors.spade,
  hearts: Colors.heart,
  diamonds: Colors.diamond,
  clubs: Colors.club,
};


// Court panel: horizontal extent in card fractions, vertical extent derived
// from the fixed local box the half-figure is authored in, so the two mirrored
// halves always meet exactly on the panel's centre line.
const PANEL_X0 = 0.22;
const PANEL_X1 = 0.78;
const PANEL_BOX_W = 40;
const PANEL_HALF_H = 38;



// ─── Suit marks ───────────────────────────────────────────────────────────────
//
// Drawn as vector paths rather than as the Unicode ♠♥♦♣ glyphs: the system font
// that resolves those characters differs on every platform, so a text-based pip
// is a different shape on iOS, Android and web. These are one shape everywhere.
// The glyphs are `SUIT_GLYPHS`, in cardFaceModel.ts.

export function SuitShape({ suit, color }: { suit: Suit; color: string }) {
  return <Path d={SUIT_GLYPHS[suit]} fill={color} />;
}

// ─── Joker figures ────────────────────────────────────────────────────────────
//
// Murlan's two jokers are the deck's top two cards and must be told apart at a
// glance, which the source deck's identical red/black art does not allow.
//
// One half-figure printed twice, the second rotated 180° about the panel
// centre, authored in a fixed PANEL_BOX_W × PANEL_HALF_H box.
//
// Keep every feature at least ~2 local units across: at ~0.8px per unit
// anything finer resolves to a smudge. The two differ only in the marotte —
// star-tipped for the red joker, plain for the black.
type FigureKind = "joker_colored" | "joker_bw";

// The robe is drawn as line work with a wash inside it, never as a solid fill:
// at this size a filled bust is a black rectangle with a dot on top. Keeping
// the large shape open and reserving solid ink for the small shapes — head,
// crown, held object — is what lets the figure read at all.
const ROBE = "M6.5,38 L6.5,31 Q6.5,26 13,24.2 L27,24.2 Q33.5,26 33.5,31 L33.5,38 Z";
const ROBE_STROKE = 1.5;

function CourtHalf({
  kind,
  color,
  paper,
}: {
  kind: FigureKind;
  color: string;
  paper: string;
}) {
  return (
    <G>
      <Path d={ROBE} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={ROBE_STROKE} />
      {/* Collar: a narrow shield under the chin rather than a band across the
          whole chest. A full-width band reads as a belt and flattens the
          figure into a capsule. */}
      <Path d="M15.4,23.4 L24.6,23.4 L26.4,28 L20,30.4 L13.6,28 Z" fill={color} />
      <G>
        <Circle cx={13.5} cy={33} r={1.8} fill={color} />
        <Circle cx={26.5} cy={33} r={1.8} fill={color} />
      </G>

      <Circle cx={20} cy={18.6} r={5.6} fill={color} />

      <G>
        <Path d="M10,14.4 L11.6,6.4 L15.6,11 L20,4.2 L24.4,11 L28.4,6.4 L30,14.4 Z" fill={color} />
        <Circle cx={11} cy={4.4} r={2.4} fill={color} />
        <Circle cx={20} cy={2.4} r={2.4} fill={color} />
        <Circle cx={29} cy={4.4} r={2.4} fill={color} />
      </G>

      {/* Held object, kept inside the panel and thick enough to survive the
          scale — a hairline staff reads as an antenna. */}
      {kind === "joker_colored" && (
        <G transform="rotate(13 32 20)">
          <Rect x={31} y={12} width={2.2} height={18} rx={1} fill={color} />
          <Path
            d="M32.1,4.4 L33.8,8.5 L38.2,8.8 L34.8,11.7 L35.9,16 L32.1,13.6 L28.3,16 L29.4,11.7 L26,8.8 L30.4,8.5 Z"
            fill={color}
          />
        </G>
      )}
      {kind === "joker_bw" && (
        <G transform="rotate(13 32 20)">
          <Rect x={31} y={12} width={2.2} height={18} rx={1} fill={color} />
          <Circle cx={32.1} cy={9.4} r={3.3} fill={color} />
          <Circle cx={32.1} cy={9.4} r={1.3} fill={paper} />
        </G>
      )}
    </G>
  );
}

function CourtPanel({
  kind,
  color,
  w,
  h,
}: {
  kind: FigureKind;
  color: string;
  w: number;
  h: number;
}) {
  const x0 = w * PANEL_X0;
  const panelW = w * (PANEL_X1 - PANEL_X0);
  const k = panelW / PANEL_BOX_W;
  const boxH = PANEL_HALF_H * 2;
  const panelH = boxH * k;
  const y0 = (h - panelH) / 2;

  return (
    <G>
      <Rect
        x={x0}
        y={y0}
        width={panelW}
        height={panelH}
        rx={3}
        fill="none"
        stroke={color}
        strokeOpacity={0.22}
        strokeWidth={0.9}
      />
      <G transform={`translate(${x0},${y0}) scale(${k})`}>
        <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} />
        <G transform={`rotate(180 ${PANEL_BOX_W / 2} ${boxH / 2})`}>
          <CourtHalf kind={kind} color={color} paper={Colors.cardPaper} />
        </G>
        <Path
          d={`M2,${boxH / 2} L${PANEL_BOX_W - 2},${boxH / 2}`}
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={1}
        />
      </G>
    </G>
  );
}

// ─── Card face art ────────────────────────────────────────────────────────────

function CardFaceArtBase({
  card,
  color,
  w,
  h,
  compact,
}: {
  card: Card;
  color: string;
  w: number;
  h: number;
  /** Too small for a pip field — one centred mark instead. */
  compact: boolean;
}) {
  const suit = card.suit;
  const indexSuitSize = h * INDEX_SUIT_SIZE;
  const indexX = w * INDEX_X;
  const indexY = h * INDEX_SUIT_Y;

  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      {card.isJoker && !compact && (
        <CourtPanel kind={card.rank === "joker_colored" ? "joker_colored" : "joker_bw"} color={color} w={w} h={h} />
      )}
      {suit && <Path d={suitMarksPath(suit, faceMarks(card.rank, w, h, compact))} fill={color} />}
      {card.isJoker && (
        <>
          <JokerStar x={indexX} y={indexY} size={indexSuitSize} color={color} filled={card.rank === "joker_colored"} />
          <JokerStar
            x={w - indexX}
            y={h - indexY}
            size={indexSuitSize}
            color={color}
            filled={card.rank === "joker_colored"}
          />
        </>
      )}
    </Svg>
  );
}

const CardFaceArt = React.memo(
  CardFaceArtBase,
  (a, b) => a.card.id === b.card.id && a.color === b.color && a.w === b.w && a.h === b.h && a.compact === b.compact
);

// Red and black Joker differ by fill as well as by colour, so the two are still
// distinguishable without colour vision.
function JokerStar({
  x, y, size, color, filled,
}: { x: number; y: number; size: number; color: string; filled: boolean }) {
  const k = size / 10;
  return (
    <G transform={`translate(${x},${y}) scale(${k})`}>
      <Path
        d="M0,-5 L1.5,-1.5 L5,-1.2 L2.3,1.3 L3.1,4.8 L0,2.8 L-3.1,4.8 L-2.3,1.3 L-5,-1.2 L-1.5,-1.5 Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : 1.2}
      />
    </G>
  );
}

// ─── Court art ────────────────────────────────────────────────────────────────
//
// The twelve court figures are real engraved artwork, not drawing code: a J, Q
// or K is a specific figure that people recognise, and hand-written paths at
// this size produced shapes that read as neither. Public domain, from Byron
// Knoll's vector-playing-cards via hayeah/playing-cards-assets — provenance and
// regeneration are recorded in assets/images/cards/README.md.
//
// Each key is a function so Metro can statically resolve the require() calls,
// the same shape lib/device/soundAssets.ts uses.
const COURT_ART: Record<string, () => number> = {
  J_clubs:      () => require("../assets/images/cards/jack_of_clubs.png") as number,
  J_diamonds:   () => require("../assets/images/cards/jack_of_diamonds.png") as number,
  J_hearts:     () => require("../assets/images/cards/jack_of_hearts.png") as number,
  J_spades:     () => require("../assets/images/cards/jack_of_spades.png") as number,
  Q_clubs:      () => require("../assets/images/cards/queen_of_clubs.png") as number,
  Q_diamonds:   () => require("../assets/images/cards/queen_of_diamonds.png") as number,
  Q_hearts:     () => require("../assets/images/cards/queen_of_hearts.png") as number,
  Q_spades:     () => require("../assets/images/cards/queen_of_spades.png") as number,
  K_clubs:      () => require("../assets/images/cards/king_of_clubs.png") as number,
  K_diamonds:   () => require("../assets/images/cards/king_of_diamonds.png") as number,
  K_hearts:     () => require("../assets/images/cards/king_of_hearts.png") as number,
  K_spades:     () => require("../assets/images/cards/king_of_spades.png") as number,
};

let cardArtWarmed: Promise<void> | null = null;

/**
 * Fetches the court, back and stock bitmaps once per session, so a card
 * arriving from an opponent's hand is already decoded when it lands rather
 * than popping in a beat later (#838). Fire-and-forget: a rejected load leaves
 * a card with no art rather than throwing into the table.
 */
export function warmCardArt(): void {
  if (cardArtWarmed) return;
  const art = [...Object.values(COURT_ART), ...Object.values(BACK_ART), STOCK_ART, GLOSS_SPOT_ART];
  cardArtWarmed = Asset.loadAsync(art.map((load) => load()))
    .then(() => undefined)
    .catch(() => undefined);
}

function CourtArt({ card, w, h }: { card: Card; w: number; h: number }) {
  const source = card.suit ? COURT_ART[`${card.rank}_${card.suit}`] : undefined;
  if (!source) return null;
  const rect = courtArtRect(w, h);
  return (
    <Image
      source={source()}
      style={[styles.courtArt, rect]}
      resizeMode="contain"
      {...a11yHidden()}
    />
  );
}

// ─── Card back and stock ──────────────────────────────────────────────────────
//
// Baked by scripts/bake-card-art.mjs; tests/tooling/cardArt.test.ts fails on a stale one.

const BACK_ART: Record<CardBackId, () => number> = {
  smeraldo:   () => require("../assets/images/cards/back_smeraldo.webp") as number,
  oro:        () => require("../assets/images/cards/back_oro.webp") as number,
  rubino:     () => require("../assets/images/cards/back_rubino.webp") as number,
  zaffiro:    () => require("../assets/images/cards/back_zaffiro.webp") as number,
  inchiostro: () => require("../assets/images/cards/back_inchiostro.webp") as number,
};

const STOCK_ART = () => require("../assets/images/cards/stock.webp") as number;

/**
 * The gold glow under a selected or catching card, until the felt draws it. Its own component: a
 * card that read the cast would re-render as the lamp moves and restart its rectangle's mapper.
 */
export function FallbackGlow({ style }: { style: React.ComponentProps<typeof Animated.View>["style"] }) {
  return useContext(CardCastContext) === "felt" ? null : <Animated.View pointerEvents="none" style={style} />;
}

// ─── CardView ─────────────────────────────────────────────────────────────────

/** The finger-down acknowledgement: how far a pressed card rises, in points, and tips, in degrees. */
export const PRESS_RISE = -3;
export const PRESS_TILT = -1.5;
const ACTIVATE = "activate";
const ACTIVATE_KEYS = new Set(["Enter", " "]);

interface CardViewProps {
  card: Card;
  selected?: boolean;
  onPress?: () => void;
  /**
   * A screen reader's activate, and Enter and Space, with no touch of its own: a hand card's
   * finger belongs to the row's tap (`components/table/hand.tsx`).
   */
  onActivate?: () => void;
  /** Multiplies the base card size (face 64×90, back 27×48 at scale 1). */
  scale?: number;
  /** Too small for a pip field — one centred mark instead, no court bitmap. */
  compact?: boolean;
  faceDown?: boolean;
  /**
   * Draw a specific back rather than the one the player chose. For offering
   * the choice itself — a picker showing five backs cannot show five copies
   * of the current one.
   */
  backId?: CardBackId;
  disabled?: boolean;
  style?: object;
  noLift?: boolean;
  /**
   * The width this card can be tapped on, when a neighbour is drawn over the
   * rest of it. A hand overlaps its cards, so all but the last expose a strip
   * narrower than they are, and a tap resolved at the card's own centre — where
   * a pointer driver aims — lands on the neighbour. Defaults to the full width.
   */
  hitWidth?: number;
  /**
   * Names the pressable rather than the card box inside it, because the two are
   * different targets: a driver aims at the centre of what it is given, and the
   * card's own centre is under the neighbour drawn over it. Only the strip
   * resolves to this card.
   */
  testID?: string;
  /**
   * The card is the visual content of an enclosing labelled control, so it
   * must not also announce itself — otherwise a screen reader reads the same
   * card twice, once for the wrapper and once for this.
   */
  decorative?: boolean;
  /**
   * What tapping this card does right now, when that is not the ordinary
   * "play it". Takes the place of the selected hint rather than joining it —
   * `accessibilityState.selected` already carries the selection.
   */
  hint?: string;
  /** The key this view is drawn as in `rects`, its publisher's own: the lamp's gloss reads its centre there. */
  rectKey?: string;
  rects?: OwnedRects;
  /**
   * Discrete equivalents of a gesture this card also answers, for assistive
   * technology only (WCAG 2.5.7). They cost no pixels and appear to nobody
   * else — the same shape `Slider` and `ReplayControls` already use.
   *
   * `accessibilityActions` is half the answer and only the native half:
   * react-native-web forwards it nowhere, so on web the arrow keys below are
   * the whole of it. A drag with no keyboard equivalent fails the criterion
   * outright on the surface this app actually ships.
   */
  a11yActions?: { name: string; label?: string }[];
  onA11yAction?: (name: string) => void;
  /** Which action each arrow key takes, on web. */
  a11yActionKeys?: Record<string, string>;
}

function CardViewBase({
  card,
  selected = false,
  onPress,
  onActivate,
  scale = 1,
  compact = false,
  faceDown = false,
  backId,
  disabled = false,
  style,
  noLift = false,
  decorative = false,
  rectKey,
  rects,
  hitWidth,
  testID,
  hint,
  a11yActions,
  onA11yAction,
  a11yActionKeys,
}: CardViewProps) {
  const { t } = useTranslation();
  const selectedHint = useA11yHint(
    decorative ? undefined : (hint ?? (selected ? t("cardView.selectedA11yHint") : undefined))
  );
  const reduceMotion = usePrefersReducedMotion();
  const chosenBack = useCardBackId();
  const backKey = backId ? cardBackId(backId) : chosenBack;
  const back = getCardBack(backKey);
  const translateY = useSharedValue(0);
  // Finger-down acknowledgement. Separate from the selection lift so a press
  // reads instantly even when the resulting selection is rejected.
  const press = useSharedValue(0);

  const interactive = (!!onPress || !!onActivate) && !disabled;

  useEffect(() => {
    if (noLift) {
      translateY.value = 0;
      return;
    }
    const target = selected ? -14 : 0;
    translateY.value = reduceMotion
      ? withTiming(target, { duration: Motion.duration.tap })
      : withSpring(target, Motion.spring.pickup);
  }, [selected, noLift, reduceMotion, translateY]);

  // Must precede the effect that reads `press` — the React Compiler skips any component that mutates a value an effect captured.
  const handlePressIn = () => {
    if (!interactive) return;
    press.value = reduceMotion ? 1 : withSpring(1, Motion.spring.pickup);
  };
  const handlePressOut = () => {
    if (!interactive) return;
    press.value = reduceMotion ? 0 : withSpring(0, Motion.spring.land);
  };
  const handlePress = () => {
    if (!interactive) return;
    onPress!();
  };
  const handleActivate = () => {
    if (interactive) onActivate?.();
  };

  useEffect(
    () => () => {
      cancelAnimation(translateY);
      cancelAnimation(press);
    },
    [translateY, press]
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + press.value * PRESS_RISE },
      { rotate: `${press.value * PRESS_TILT}deg` },
    ],
  }));

  const w = faceDown ? CARD_BACK_W(scale) : CARD_W(scale);
  const h = faceDown ? CARD_BACK_H(scale) : CARD_H(scale);
  const cast = useContext(CardCastContext);
  const shadow = cast === "felt" ? null : cardShadow(faceDown ? "back" : selected ? "lifted" : "face", cast);

  if (faceDown) {
    const backStyle = {
      borderRadius: cardRadius(w),
      borderColor: withAlpha(back.ink, 0.32),
      ...shadow,
    };
    return (
      <Animated.View style={[animStyle, style]}>
        <View
          testID="card-box-back"
          style={[styles.card, { width: w, height: h }, styles.cardBack, backStyle]}
        >
          <Image source={BACK_ART[backKey]()} style={StyleSheet.absoluteFill} resizeMode="stretch" {...a11yHidden()} />
          <LampGloss rectKey={rectKey} rects={rects} width={w} height={h} />
        </View>
      </Animated.View>
    );
  }

  const stockStyle = { borderRadius: cardRadius(w), ...shadow };
  const lipStyle = { width: w, height: h, top: stockLipHeight(h), borderRadius: cardRadius(w) };

  const rankText = card.isJoker ? "JK" : getCardDisplayRank(card.rank);
  // "10" is the only two-glyph rank. At the single-glyph size it renders wider
  // than the index column and collides with the left pip column; the wide
  // ratio in cardFaceModel is the one that fits.
  const rankFont = rankFontSize(rankText, h);
  const inset = rankInset(h);
  const rankBox = { fontSize: rankFont, lineHeight: rankFont, width: w * INDEX_TEXT_W, top: inset };
  const color = card.isJoker
    ? card.rank === "joker_colored" ? Colors.heart : Colors.cardInk
    : card.suit ? SUIT_COLORS[card.suit] : Colors.spade;

  // react-native-web forwards `onKeyDown` straight to the DOM, and forwards
  // `accessibilityActions` nowhere at all — so on web this is the only
  // equivalent of the drag there is. Native reaches the same two actions
  // through VoiceOver's and TalkBack's own rotor.
  const webActionKeys =
    Platform.OS === "web" && (onActivate !== undefined || (a11yActionKeys !== undefined && onA11yAction !== undefined))
      ? {
          onKeyDown: (e: { key: string; preventDefault?: () => void }) => {
            if (onActivate !== undefined && ACTIVATE_KEYS.has(e.key)) {
              e.preventDefault?.();
              handleActivate();
              return;
            }
            const action = a11yActionKeys?.[e.key];
            if (action === undefined || onA11yAction === undefined) return;
            e.preventDefault?.();
            onA11yAction(action);
          },
        }
      : {};
  const actions = onActivate ? [{ name: ACTIVATE }, ...(a11yActions ?? [])] : a11yActions;
  const onAction = (name: string) => {
    if (onActivate && name === ACTIVATE) handleActivate();
    else onA11yAction?.(name);
  };
  const touch = onPress ? { onPress: handlePress, onPressIn: handlePressIn, onPressOut: handlePressOut } : {};

  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        testID={testID}
        {...touch}
        disabled={!interactive}
        {...a11yHidden(decorative)}
        accessibilityLabel={decorative ? undefined : cardSpokenName(card, t)}
        // No onPress at all is information, not a control — it keeps its name
        // but claiming `button` would announce an action that does not exist.
        //
        // An onPress that is momentarily disabled stays a button reporting
        // itself unavailable: dropping the role would make the hand vanish and
        // reappear in the button rotation every turn.
        {...a11yState({ role: onPress || onActivate ? "button" : undefined, selected, disabled: !interactive })}
        {...selectedHint.props}
        accessibilityActions={actions}
        onAccessibilityAction={
          onA11yAction || onActivate ? (e) => onAction(e.nativeEvent.actionName) : undefined
        }
        {...webActionKeys}
        // The pressable is the tap strip; the view inside it is the card. Two
        // boxes rather than one because `styles.card` clips to its own rounded
        // corners, and a strip narrower than the card would clip the art with it.
        style={{ width: hitWidth ?? w, height: h }}
      >
        <View pointerEvents="none" style={[styles.lip, lipStyle]} />
        {/* Named because it is not the same box as the pressable around it: in
            a hand, that one is only the strip this card exposes. Anything
            measuring what the player *sees* has to measure this.

            It takes no hits, which is what makes the strip above the only box
            deciding which card a tap belongs to. The ink overflows the strip,
            and the platforms do not agree about that overflow on their own: the
            web hit-tests it and lets paint order settle which card wins, while
            UIKit does not hit-test outside a view's bounds at all. */}
        <View
          testID="card-box"
          pointerEvents="none"
          style={[styles.card, styles.stock, { width: w, height: h }, stockStyle]}
        >
          {selectedHint.node}
          <Image source={STOCK_ART()} style={StyleSheet.absoluteFill} resizeMode="stretch" {...a11yHidden()} />
          <CardFaceArt card={card} color={color} w={w} h={h} compact={compact} />
          {!compact && COURT_RANKS.has(card.rank) && <CourtArt card={card} w={w} h={h} />}
          <TableText
            {...a11yHidden()}
            style={[
              styles.rankText,
              rankBox,
              card.isJoker && styles.rankTextJoker,
              { color },
            ]}
          >
            {rankText}
          </TableText>
          <TableText
            {...a11yHidden()}
            style={[
              styles.rankText,
              rankBox,
              card.isJoker && styles.rankTextJoker,
              styles.rankTextBottom,
              { top: undefined, bottom: inset, color },
            ]}
          >
            {rankText}
          </TableText>
          <LampGloss rectKey={rectKey} rects={rects} width={w} height={h} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * A card id is `rank_suit` (lib/game/gameEngine.ts createDeck), so equal ids mean an
 * identical face. That is what lets this compare by id: every `game:state`
 * arrives as fresh JSON, so the card objects are new on every server message
 * even when nothing about the hand changed.
 */
export function cardViewPropsEqual(a: CardViewProps, b: CardViewProps): boolean {
  return (
    a.card.id === b.card.id &&
    a.selected === b.selected &&
    a.onPress === b.onPress &&
    a.onActivate === b.onActivate &&
    a.scale === b.scale &&
    a.compact === b.compact &&
    a.faceDown === b.faceDown &&
    a.backId === b.backId &&
    a.disabled === b.disabled &&
    a.noLift === b.noLift &&
    a.decorative === b.decorative &&
    a.rectKey === b.rectKey &&
    a.rects === b.rects &&
    a.style === b.style &&
    a.hitWidth === b.hitWidth &&
    a.testID === b.testID &&
    a.hint === b.hint &&
    a.a11yActions === b.a11yActions &&
    a.onA11yAction === b.onA11yAction &&
    a.a11yActionKeys === b.a11yActionKeys
  );
}

export const CardView = React.memo(CardViewBase, cardViewPropsEqual);
CardView.displayName = "CardView";

// iOS antialiases only the edges of a layer whose own transform rotates, skews or has perspective
// (RCTViewComponentView.mm), never of the children of a rotated one, so a card's edge layers carry
// a perspective, which leaves a flat layer where it was.
const edgeAntialiased = Platform.select({ ios: { transform: [{ perspective: 1000 }] } });

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardPaper,
    borderWidth: 1,
    borderColor: Colors.cardEdge,
    overflow: "hidden",
    ...edgeAntialiased,
  },
  cardBack: {
    backgroundColor: Colors.felt,
    borderWidth: 1,
  },
  // A solid view under the card rather than a shadow layer: nothing to mask, on the felt or off it.
  lip: { position: "absolute", left: 0, zIndex: Layer.felt, backgroundColor: Colors.cardLip, ...edgeAntialiased },
  stock: { zIndex: Layer.table },
  // The index characters sit in the drawn index column: the suit mark below
  // them comes from the SVG layer, so the two must agree on INDEX_X.
  courtArt: {
    position: "absolute",
  },
  rankText: {
    position: "absolute",
    fontFamily: "Rajdhani_700Bold",
    letterSpacing: -0.5,
    textAlign: "center",
    left: 0,
  },
  rankTextJoker: {
    fontSize: FontSize.xs,
    lineHeight: 12,
  },
  rankTextBottom: {
    top: undefined,
    left: undefined,
    right: 0,
    transform: [{ rotate: "180deg" }],
  },
});
