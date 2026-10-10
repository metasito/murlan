import { createContext, useContext, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg from "react-native-svg";
import { Colors, Layer, makeShadow, NoticePalette, Scrim, withAlpha } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { DIAGNOSTICS, diag, type DiagRows } from "@/lib/diagnostics";
import type { Suit } from "@/lib/game/gameEngine";
import { clocked } from "./noticeClock";
import { SUIT_COLORS, SuitShape } from "@/components/CardView";
import { TableText } from "./TableText";
import {
  NOTICES,
  noticeBlink,
  noticeBox,
  noticeGlow,
  noticeRise,
  noticeTiming,
  mockupPx,
  NOTICE_KEY,
  panelLine,
  panelParts,
  type KindTone,
  type NoticeBox,
  type NoticeKind,
  type NoticeShape,
  type PanelLine,
} from "./noticeModel";
import { PILL_PLATE_STOPS, PILL_SHADOW } from "./scorePillModel";

type Paint = {
  fill: string;
  edge: string;
  ink: string;
  strong: string;
  warn?: string;
  glow?: { color: string; opacity: number };
  dot?: { color: string; glow?: number };
  top?: string;
  quiet?: string;
  hairline?: string;
};

const CARD_FACE = [Colors.cardPaper, Colors.cardPaperMid, Colors.cardPaperEdge] as const;
const CARD_FACE_STOPS = [0, 0.55, 1] as const;
const DISC_FILL = [Colors.seatDisc, Colors.seatDiscDeep] as const;
const PLATE_SHADOW = withAlpha(Colors.shadow, PILL_SHADOW.alpha);
const DISC_GLOW = 10;
const TILE_SHADOW = 3;
const TILE_CAST = withAlpha(Colors.shadow, 0.5);
const SUIT_BOX = "-5.2 -5.2 10.4 10.4";
const DIM_Z = Layer.hint;
const BADGE = { padX: 7, padY: 3, radius: 8, tracking: 1 } as const;
// A one-off: how often diagnostics read the calm dot, not a motion the player sees.
const DOT_SAMPLE_MS = 100;
// `noticeTiming` already answers the app's preference. Left to the root's ReduceMotion.Always, a
// sequence skips every leg but its last, and a float never shows at all.
const ANSWERED = ReduceMotion.Never;

const Ink = createContext<{ kind: NoticeKind; paint: Paint; box: NoticeBox; dotGlow: number; scale: number } | null>(null);

/** Which stage a notice's diagnostics rows come from: the bench's gallery, or the table when unset. */
export const NoticeSource = createContext<DiagRows["notice"]["src"]>(undefined);

type Probe = { kind: NoticeKind; shape: NoticeShape; src: DiagRows["notice"]["src"] };

function probed<T>(animation: T, probe: Probe, phase: DiagRows["notice"]["phase"]): T {
  if (!DIAGNOSTICS) return animation;
  return clocked(animation, (ms, dt) => diag({ k: "notice", t: performance.now(), ...probe, phase, ms, dt }));
}

export function TableNotice<K extends NoticeKind>({
  kind,
  tone,
  scale,
  shown = true,
  still = false,
  children,
}: {
  kind: K;
  tone: KindTone<K>;
  scale: number;
  shown?: boolean;
  /** Shown on the frame it mounts and gone on the frame it hides: for a notice another clock times. */
  still?: boolean;
  children: ReactNode;
}) {
  const shape: NoticeShape = NOTICES[kind].shape;
  const paint = (NoticePalette[shape] as Record<string, Paint>)[tone];
  const box = useMemo(() => noticeBox(kind, scale), [kind, scale]);
  const glow = noticeGlow(kind, tone, scale);
  const reduceMotion = usePrefersReducedMotion();
  const { enter, hold, exit } = noticeTiming(shape, reduceMotion);
  const rise = noticeRise(scale, reduceMotion);
  const held = shape === "float" ? hold : null;
  const src = useContext(NoticeSource);

  const life = useSharedValue(still && shown ? 1 : 0);
  const risen = useSharedValue(still ? 1 : 0);
  const wasShown = useRef(false);
  useEffect(() => {
    const leaving = wasShown.current && !shown;
    const arriving = !wasShown.current && shown;
    wasShown.current = shown;
    const probe = { kind, shape, src };
    if (still) {
      life.value = shown ? 1 : 0;
      if (DIAGNOSTICS && arriving) diag({ k: "notice", t: performance.now(), ...probe, phase: "still", ms: 0, dt: 0 });
      return;
    }
    const fadeIn = withTiming(1, { duration: enter, reduceMotion: ANSWERED });
    const entrance = arriving ? probed(fadeIn, probe, "enter") : fadeIn;
    const out = withTiming(0, { duration: exit, reduceMotion: ANSWERED });
    life.value = held !== null && shown
      ? withSequence(ANSWERED, entrance, withTiming(1, { duration: held, reduceMotion: ANSWERED }), probed(out, probe, "exit"))
      : shown ? entrance : leaving ? probed(out, probe, "exit") : out;
    if (shown) {
      risen.value = 0;
      risen.value = withTiming(1, { duration: enter, reduceMotion: ANSWERED });
    }
    return () => {
      cancelAnimation(life);
      cancelAnimation(risen);
    };
  }, [shown, still, held, enter, exit, life, risen, kind, shape, src]);
  const motion = useAnimatedStyle(() => ({
    opacity: life.value,
    transform: [{ translateY: (1 - risen.value) * rise }],
  }));

  const ink = useMemo(() => ({ kind, paint, box, dotGlow: glow.dot, scale }), [kind, paint, box, glow.dot, scale]);
  const panel = shape === "panel";
  const unit = mockupPx(1, scale);
  const { offsetY, blur } = PILL_SHADOW.lifted;
  return (
    <Animated.View
      testID={`notice-${kind}`}
      pointerEvents="none"
      style={[
        panel ? styles.panel : styles.plate,
        {
          height: box.height,
          paddingHorizontal: box.padX,
          paddingVertical: box.padY,
          gap: box.gap,
          borderRadius: box.radius,
          backgroundColor: paint.fill,
          borderColor: paint.edge,
        },
        box.minHeight !== undefined && { minHeight: box.minHeight },
        box.maxWidth !== undefined && { maxWidth: box.maxWidth },
        paint.glow && makeShadow(paint.glow.color, 0, 0, paint.glow.opacity, glow.plate, 0),
        panel && {
          width: box.width,
          boxShadow: `${paint.hairline ? `inset 0px ${unit}px 0px ${paint.hairline}, ` : ""}0px ${offsetY * unit}px ${blur * unit}px ${PILL_SHADOW.spread * unit}px ${PLATE_SHADOW}`,
        },
        motion,
      ]}
    >
      {paint.top && (
        <LinearGradient
          colors={[paint.top, paint.fill, paint.fill]}
          locations={PILL_PLATE_STOPS}
          style={[StyleSheet.absoluteFill, { borderRadius: box.radius - StyleSheet.hairlineWidth }]}
        />
      )}
      <Ink.Provider value={ink}>{children}</Ink.Provider>
    </Animated.View>
  );
}

export function NoticeDim() {
  return <View pointerEvents="none" style={styles.dim} />;
}

function useInk(what: string) {
  const ink = useContext(Ink);
  if (!ink) throw new Error(`${what} is drawn inside a TableNotice`);
  return ink;
}

export function NoticeDot({ testID, blink = false }: { testID?: string; blink?: boolean }) {
  const { kind, paint, box, dotGlow } = useInk("NoticeDot");
  const reduceMotion = usePrefersReducedMotion();
  const timing = blink ? noticeBlink(reduceMotion) : null;
  const half = timing?.half;
  const dim = timing?.dim;
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (half === undefined || dim === undefined) {
      if (!DIAGNOSTICS || !blink) return undefined;
      const sample = () => diag({ k: "dot", t: performance.now(), kind, opacity: opacity.get() });
      sample();
      const every = setInterval(sample, DOT_SAMPLE_MS);
      return () => {
        clearInterval(every);
        sample();
      };
    }
    let first: number | null = null;
    const halfEnded = (ms: number) => {
      if (first === null) {
        first = ms;
        return;
      }
      diag({ k: "blink", t: performance.now(), kind, period: first + ms });
      first = null;
    };
    const fade = withTiming(dim, { duration: half, easing: Easing.inOut(Easing.ease) });
    // `noticeBlink` already answers the app's preference; Reanimated's own reads the system's once, at load.
    opacity.value = withRepeat(DIAGNOSTICS ? clocked(fade, halfEnded) : fade, -1, true, undefined, ReduceMotion.Never);
    return () => {
      cancelAnimation(opacity);
      opacity.value = 1;
    };
  }, [half, dim, opacity, blink, kind]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const dot = paint.dot;
  if (!dot) throw new Error("this notice's tone paints no dot");
  return (
    <Animated.View
      testID={testID}
      style={[
        { width: box.dot, height: box.dot, borderRadius: box.dot / 2, backgroundColor: dot.color },
        dot.glow !== undefined && makeShadow(dot.color, 0, 0, dot.glow, dotGlow, 0),
        fade,
      ]}
    />
  );
}

export function NoticeLine({ line, children }: { line: PanelLine; children: ReactNode }) {
  const { paint, scale } = useInk("a panel part");
  const type = panelLine(line, scale);
  return (
    <TableText
      style={[
        styles.line,
        type.bold && styles.bold,
        line === "hint" && styles.hint,
        { color: line === "main" ? paint.ink : paint.quiet ?? paint.ink, fontSize: type.fontSize, letterSpacing: type.tracking },
      ]}
    >
      {children}
    </TableText>
  );
}

export function NoticeName({ children }: { children: ReactNode }) {
  const { paint } = useInk("a panel part");
  return <TableText style={[styles.bold, { color: paint.strong }]}>{children}</TableText>;
}

export function NoticeTile({ rank, suit }: { rank: string; suit: Suit }) {
  const { scale } = useInk("a panel part");
  const part = panelParts(scale);
  const unit = mockupPx(1, scale);
  const ink = SUIT_COLORS[suit];
  return (
    <LinearGradient
      testID="notice-tile"
      colors={CARD_FACE}
      locations={CARD_FACE_STOPS}
      start={{ x: 0.3, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={[
        styles.tile,
        { minWidth: part.tile.width, minHeight: part.tile.height, borderRadius: part.tile.radius },
        { boxShadow: `0px ${part.tileLip}px 0px ${Colors.cardLip}, 0px ${unit}px ${TILE_SHADOW * unit}px ${TILE_CAST}` },
      ]}
    >
      <TableText style={[styles.bold, { color: ink, fontSize: part.tileFont }]}>{rank}</TableText>
      <Svg width={part.tileSuit} height={part.tileSuit} viewBox={SUIT_BOX}>
        <SuitShape suit={suit} color={ink} />
      </Svg>
    </LinearGradient>
  );
}

export function NoticeDisc({ children }: { children: ReactNode }) {
  const { paint, scale } = useInk("a panel part");
  const part = panelParts(scale);
  return (
    <LinearGradient
      testID="notice-disc"
      colors={DISC_FILL}
      start={{ x: 0.3, y: 0.25 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.disc,
        { width: part.disc, height: part.disc, borderRadius: part.disc / 2 },
        makeShadow(Colors.goldLit, 0, 0, 0.3, mockupPx(DISC_GLOW, scale), 0),
      ]}
    >
      <TableText style={[styles.bold, { color: paint.ink, fontSize: part.discFont }]}>{children}</TableText>
    </LinearGradient>
  );
}

export function NoticeText({
  strong = false,
  warn = false,
  maxWidth,
  align,
  testID,
  children,
}: {
  strong?: boolean;
  warn?: boolean;
  maxWidth?: number;
  align?: "left" | "right";
  testID?: string;
  children: ReactNode;
}) {
  const { paint, box, scale } = useInk("NoticeText");
  return (
    <TableText
      numberOfLines={box.lines}
      testID={testID}
      style={[
        styles.text,
        !box.upper && styles.sentence,
        (strong || box.bold) && styles.bold,
        strong && styles.strong,
        {
          color: warn ? (paint.warn ?? paint.strong) : strong ? paint.strong : paint.ink,
          fontSize: strong ? box.strongFontSize : box.fontSize,
          letterSpacing: strong ? box.strongTracking : box.tracking,
          lineHeight: box.lineHeight,
          textAlign: align,
        },
        maxWidth !== undefined && { maxWidth: maxWidth * scale },
      ]}
    >
      {children}
    </TableText>
  );
}

/** A gold key inside the plate's run, naming the action a press on the plate takes. */
export function NoticeKey({ testID, children }: { testID?: string; children: ReactNode }) {
  const { box, scale } = useInk("NoticeKey");
  return (
    <TableText
      numberOfLines={1}
      testID={testID}
      style={[
        styles.text,
        styles.bold,
        {
          color: Colors.badgeInk,
          backgroundColor: Colors.gold,
          fontSize: box.fontSize,
          lineHeight: box.lineHeight,
          letterSpacing: mockupPx(NOTICE_KEY.tracking, scale),
          paddingHorizontal: mockupPx(NOTICE_KEY.padX, scale),
          paddingVertical: mockupPx(NOTICE_KEY.padY, scale),
          borderRadius: mockupPx(NOTICE_KEY.radius, scale),
          overflow: "hidden",
        },
      ]}
    >
      {children}
    </TableText>
  );
}

/** A glyph set as a letter of the plate's run: its size and ink, then the run's tracking. */
export function NoticeIcon({ name }: { name: ComponentProps<typeof Ionicons>["name"] }) {
  const { paint, box } = useInk("NoticeIcon");
  return <Ionicons name={name} size={box.fontSize} color={paint.ink} style={{ marginRight: box.tracking }} />;
}

/** A glyph beside the plate's words, `px` mockup px square. */
export function NoticeGlyph({ name, px }: { name: ComponentProps<typeof Ionicons>["name"]; px: number }) {
  const { paint, scale } = useInk("NoticeGlyph");
  return <Ionicons name={name} size={mockupPx(px, scale)} color={paint.strong} />;
}

/** A count on gold at the plate's end, as `#turn u`. */
export function NoticeBadge({ children }: { children: ReactNode }) {
  const { box, scale } = useInk("NoticeBadge");
  return (
    <View
      style={[
        styles.badge,
        { paddingHorizontal: mockupPx(BADGE.padX, scale), paddingVertical: mockupPx(BADGE.padY, scale), borderRadius: mockupPx(BADGE.radius, scale) },
      ]}
    >
      <TableText style={[styles.bold, styles.strong, { color: Colors.badgeInk, fontSize: box.fontSize, letterSpacing: mockupPx(BADGE.tracking, scale) }]}>
        {children}
      </TableText>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  panel: { borderWidth: 1 },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: Scrim.medium, zIndex: DIM_Z },
  line: { fontFamily: "Rajdhani_600SemiBold" },
  hint: { textTransform: "uppercase", textAlign: "center" },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.cardEdge,
  },
  disc: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.goldLitDisc,
  },
  text: {
    fontFamily: "Rajdhani_600SemiBold",
    textTransform: "uppercase",
    flexShrink: 1,
  },
  sentence: { textTransform: "none" },
  bold: { fontFamily: "Rajdhani_700Bold" },
  strong: { fontVariant: ["tabular-nums"] },
  badge: { backgroundColor: Colors.gold },
});
