import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { makeShadow, NoticePalette } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { TableText } from "./TableText";
import {
  NOTICES,
  noticeBox,
  noticeRise,
  noticeTiming,
  selectorGlow,
  type KindTone,
  type NoticeBox,
  type NoticeKind,
  type NoticeShape,
} from "./noticeModel";

type Paint = {
  fill: string;
  edge: string;
  ink: string;
  strong: string;
  warn?: string;
  glow?: { color: string; opacity: number };
  dot?: { color: string; glow?: number };
};

const Ink = createContext<{ paint: Paint; box: NoticeBox; scale: number } | null>(null);

export function TableNotice<K extends NoticeKind>({
  kind,
  tone,
  scale,
  shown = true,
  children,
}: {
  kind: K;
  tone: KindTone<K>;
  scale: number;
  shown?: boolean;
  children: ReactNode;
}) {
  const shape: NoticeShape = NOTICES[kind].shape;
  const paint = (NoticePalette[shape] as Record<string, Paint>)[tone];
  const box = useMemo(() => noticeBox(kind, scale), [kind, scale]);
  const reduceMotion = usePrefersReducedMotion();
  const { enter, exit } = noticeTiming(shape, reduceMotion);
  const rise = noticeRise(scale, reduceMotion);

  const life = useSharedValue(0);
  const risen = useSharedValue(0);
  useEffect(() => {
    life.value = withTiming(shown ? 1 : 0, { duration: shown ? enter : exit });
    if (shown) {
      risen.value = 0;
      risen.value = withTiming(1, { duration: enter });
    }
    return () => {
      cancelAnimation(life);
      cancelAnimation(risen);
    };
  }, [shown, enter, exit, life, risen]);
  const motion = useAnimatedStyle(() => ({
    opacity: life.value,
    transform: [{ translateY: (1 - risen.value) * rise }],
  }));

  const ink = useMemo(() => ({ paint, box, scale }), [paint, box, scale]);
  return (
    <Animated.View
      testID={`notice-${kind}`}
      pointerEvents="none"
      style={[
        styles.plate,
        {
          height: box.height,
          paddingHorizontal: box.padX,
          gap: box.gap,
          borderRadius: box.radius,
          backgroundColor: paint.fill,
          borderColor: paint.edge,
        },
        paint.glow && makeShadow(paint.glow.color, 0, 0, paint.glow.opacity, selectorGlow(tone, scale), 0),
        motion,
      ]}
    >
      <Ink.Provider value={ink}>{children}</Ink.Provider>
    </Animated.View>
  );
}

function useInk(what: string) {
  const ink = useContext(Ink);
  if (!ink) throw new Error(`${what} is drawn inside a TableNotice`);
  return ink;
}

export function NoticeDot({ testID }: { testID?: string }) {
  const { paint, box } = useInk("NoticeDot");
  const dot = paint.dot;
  if (!dot) throw new Error("this notice's tone paints no dot");
  return (
    <View
      testID={testID}
      style={[
        { width: box.dot, height: box.dot, borderRadius: box.dot / 2, backgroundColor: dot.color },
        dot.glow !== undefined && makeShadow(dot.color, 0, 0, dot.glow, box.dotGlow, 0),
      ]}
    />
  );
}

export function NoticeText({
  strong = false,
  warn = false,
  maxWidth,
  testID,
  children,
}: {
  strong?: boolean;
  warn?: boolean;
  maxWidth?: number;
  testID?: string;
  children: ReactNode;
}) {
  const { paint, box, scale } = useInk("NoticeText");
  return (
    <TableText
      numberOfLines={1}
      testID={testID}
      style={[
        styles.text,
        (strong || box.bold) && styles.bold,
        strong && styles.strong,
        {
          color: warn ? (paint.warn ?? paint.strong) : strong ? paint.strong : paint.ink,
          fontSize: strong ? box.strongFontSize : box.fontSize,
          letterSpacing: strong ? box.strongTracking : box.tracking,
        },
        maxWidth !== undefined && { maxWidth: maxWidth * scale },
      ]}
    >
      {children}
    </TableText>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  text: {
    fontFamily: "Rajdhani_600SemiBold",
    textTransform: "uppercase",
  },
  bold: { fontFamily: "Rajdhani_700Bold" },
  strong: { fontVariant: ["tabular-nums"] },
});
