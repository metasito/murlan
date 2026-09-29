import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { makeShadow, NoticePalette } from "@/lib/theme";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { TableText } from "./TableText";
import {
  NOTICES,
  noticeBox,
  noticeGlow,
  noticeRise,
  noticeTiming,
  type KindTone,
  type NoticeBox,
  type NoticeKind,
  type NoticeShape,
} from "./noticeModel";

type Paint = { fill: string; edge: string; ink: string; strong: string; glow?: { color: string; opacity: number } };

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
  const box = noticeBox(kind, scale);
  const reduceMotion = usePrefersReducedMotion();
  const { enter, exit } = noticeTiming(shape, reduceMotion);
  const rise = noticeRise(scale, reduceMotion);

  const life = useSharedValue(0);
  const risen = useSharedValue(0);
  useEffect(() => {
    life.value = withTiming(shown ? 1 : 0, { duration: shown ? enter : exit });
    if (shown) risen.value = withTiming(1, { duration: enter });
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
        paint.glow && makeShadow(paint.glow.color, 0, 0, paint.glow.opacity, noticeGlow(tone, scale), 0),
        motion,
      ]}
    >
      <Ink.Provider value={ink}>{children}</Ink.Provider>
    </Animated.View>
  );
}

export function NoticeText({
  strong = false,
  maxWidth,
  testID,
  children,
}: {
  strong?: boolean;
  maxWidth?: number;
  testID?: string;
  children: ReactNode;
}) {
  const ink = useContext(Ink);
  if (!ink) throw new Error("NoticeText is drawn inside a TableNotice");
  const { paint, box, scale } = ink;
  return (
    <TableText
      numberOfLines={1}
      testID={testID}
      style={[
        styles.text,
        strong && styles.strong,
        {
          color: strong ? paint.strong : paint.ink,
          fontSize: box.fontSize,
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
  strong: {
    fontFamily: "Rajdhani_700Bold",
    fontVariant: ["tabular-nums"],
  },
});
