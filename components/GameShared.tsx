import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  runOnJS,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { CardView } from "@/components/CardView";
import type { Card, Combination, Player } from "@/lib/gameEngine";
import Colors from "@/constants/colors";

export const CARD_W = 58;
export const CARD_H = 84;
export const BTN_W = 84;
export const BTN_H = 84;
export const TOP_BAR_H = 44;
export const TABLE_M = 8;
export const SIDE_SECTION_W = 160;
export const TOP_SECTION_H = 82;
export const HAND_SECTION_H = CARD_H + 14;

export type FlyDirection = "top" | "bottom" | "left" | "right";

export const FLY_OFFSETS: Record<FlyDirection, { dx: number; dy: number }> = {
  bottom: { dx: 0, dy: 140 },
  top: { dx: 0, dy: -100 },
  left: { dx: -180, dy: 0 },
  right: { dx: 180, dy: 0 },
};
const FLY_ROTS: Record<FlyDirection, number> = {
  bottom: -12,
  top: 12,
  left: -18,
  right: 18,
};
const FLY_LANDING_ROTS: Record<FlyDirection, number> = {
  bottom: -4,
  top: 5,
  left: -7,
  right: 7,
};

export function getOpponentPosition(
  steps: number,
  total: number
): "top" | "left" | "right" {
  if (total === 1) return "top";
  if (total === 2) return steps === 1 ? "right" : "top";
  if (steps === 1) return "right";
  if (steps === 2) return "top";
  return "left";
}

export function CardFan({
  count,
  maxCards = 7,
}: {
  count: number;
  maxCards?: number;
}) {
  const n = Math.min(count, maxCards);
  if (n === 0) return null;
  const step = 15;
  const maxAngle = 22;
  const totalW = step * (n - 1) + 40;

  return (
    <View style={{ width: totalW, height: 66 }}>
      {Array.from({ length: n }, (_, i) => {
        const c = (n - 1) / 2;
        const angle = ((i - c) / Math.max(c, 1)) * maxAngle;
        const rise = Math.abs(i - c) * 4;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: i * step,
              bottom: rise,
              transform: [{ rotate: `${angle}deg` }],
              zIndex: i,
            }}
          >
            <CardView
              card={{ id: `bk${i}`, suit: null, rank: "3", isJoker: false }}
              faceDown
              small
            />
          </View>
        );
      })}
    </View>
  );
}

export function AvatarCircle({
  name,
  isActive,
  cardCount,
  finishPos,
  size = 44,
}: {
  name: string;
  isActive: boolean;
  cardCount: number;
  finishPos?: number;
  size?: number;
}) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (isActive) {
      pulse.value = withSequence(
        withTiming(1.15, { duration: 300 }),
        withSpring(1, { damping: 10, stiffness: 200 })
      );
    }
  }, [isActive]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Animated.View style={anim}>
      <View
        style={[
          sharedStyles.avatarOuter,
          { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 },
          isActive && sharedStyles.avatarOuterActive,
        ]}
      >
        <View
          style={[
            sharedStyles.avatarInner,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[sharedStyles.avatarInitials, { fontSize: size * 0.36 }]}>
            {initials}
          </Text>
        </View>
        <View style={sharedStyles.countBubble}>
          {finishPos !== undefined ? (
            <Ionicons name="trophy" size={8} color={Colors.gold} />
          ) : (
            <Text style={sharedStyles.countBubbleText}>{cardCount}</Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

export function TopOppSlot({
  player,
  isActive,
  cardCount,
}: {
  player: Player;
  isActive: boolean;
  cardCount?: number;
}) {
  const count = cardCount ?? player.hand.length;
  return (
    <View style={sharedStyles.topOppSlot}>
      <View style={sharedStyles.topOppRow}>
        <View style={sharedStyles.topOppAvatarCol}>
          <AvatarCircle
            name={player.name}
            isActive={isActive}
            cardCount={count}
            finishPos={player.finishPosition}
            size={42}
          />
          <Text style={sharedStyles.oppName} numberOfLines={1}>
            {player.name}
          </Text>
        </View>
        {player.finishPosition === undefined && count > 0 && (
          <CardFan count={count} maxCards={7} />
        )}
      </View>
    </View>
  );
}

export function SideOppSlot({
  player,
  isActive,
  side,
  cardCount,
}: {
  player: Player;
  isActive: boolean;
  side: "left" | "right";
  cardCount?: number;
}) {
  const count = cardCount ?? player.hand.length;
  const isLeft = side === "left";
  return (
    <View
      style={[
        sharedStyles.sideOppSlot,
        isLeft ? sharedStyles.sideLeft : sharedStyles.sideRight,
      ]}
    >
      {!isLeft && count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} maxCards={5} />
      )}
      <View style={sharedStyles.sideOppAvatarCol}>
        <AvatarCircle
          name={player.name}
          isActive={isActive}
          cardCount={count}
          finishPos={player.finishPosition}
          size={40}
        />
        <Text style={sharedStyles.oppName} numberOfLines={1}>
          {player.name}
        </Text>
      </View>
      {isLeft && count > 0 && player.finishPosition === undefined && (
        <CardFan count={count} maxCards={5} />
      )}
    </View>
  );
}

export function FlyingCards({
  cards,
  direction,
  onDone,
}: {
  cards: Card[];
  direction: FlyDirection;
  onDone: () => void;
}) {
  const { dx, dy } = FLY_OFFSETS[direction];
  const startRot = FLY_ROTS[direction];
  const landingRot = FLY_LANDING_ROTS[direction];

  const tx = useSharedValue(dx);
  const ty = useSharedValue(dy);
  const rot = useSharedValue(startRot);
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const FLIGHT = 380;
    const easing = Easing.bezier(0.25, 0.46, 0.45, 0.94);

    opacity.value = withTiming(1, { duration: 80 });

    tx.value = withTiming(0, { duration: FLIGHT, easing });
    ty.value = withTiming(0, { duration: FLIGHT, easing });

    rot.value = withSequence(
      withTiming(landingRot * 0.4, {
        duration: FLIGHT * 0.75,
        easing: Easing.out(Easing.cubic),
      }),
      withSpring(landingRot, { damping: 10, stiffness: 180 })
    );

    scale.value = withSequence(
      withTiming(1.12, { duration: FLIGHT * 0.7, easing: Easing.out(Easing.cubic) }),
      withSpring(0.96, { damping: 6, stiffness: 400 }),
      withSpring(1.0, { damping: 14, stiffness: 250 })
    );

    opacity.value = withSequence(
      withTiming(1, { duration: 80 }),
      withDelay(
        FLIGHT + 300,
        withTiming(0, { duration: 180 }, (finished) => {
          if (finished) runOnJS(onDone)();
        })
      )
    );
  }, []);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const display = cards.slice(0, 3);

  return (
    <View style={sharedStyles.flyingContainer} pointerEvents="none">
      <Animated.View style={[sharedStyles.flyingInner, aStyle]}>
        {display.map((card, i) => {
          const angle = (i - (display.length - 1) / 2) * 10;
          return (
            <View
              key={card.id}
              style={{
                position: "absolute",
                left: i * 12 - (display.length - 1) * 6,
                zIndex: i,
                transform: [{ rotate: `${angle}deg` }],
              }}
            >
              <CardView card={card} />
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const COMBO_LABELS: Record<string, string> = {
  single: "Singola",
  pair: "Coppia",
  triple: "Tris",
  straight: "Scala",
  bomb: "💣 Bomba",
  royal_straight: "★ Scala Reale",
};

export function PlayedPile({
  history,
  roundWinner,
}: {
  history: Combination[];
  roundWinner: string | null;
}) {
  const topCombo = history.length > 0 ? history[history.length - 1] : null;

  return (
    <View style={sharedStyles.pileArea} testID="pile-area">
      {roundWinner && (
        <Animated.View
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(250)}
          style={sharedStyles.winnerTag}
        >
          <Ionicons name="star" size={9} color={Colors.gold} />
          <Text style={sharedStyles.winnerText}>{roundWinner}</Text>
        </Animated.View>
      )}

      {history.length === 0 && (
        <Text style={sharedStyles.emptyText}>Inizia il round</Text>
      )}

      {history.length > 0 && (
        <View style={sharedStyles.pileStack}>
          {history.slice(-4).map((combo, si, arr) => {
            const isTop = si === arr.length - 1;
            const angle = (si - (arr.length - 1)) * 8;
            const ddx = (si - (arr.length - 1)) * 5;
            const ddy = (si - (arr.length - 1)) * 3;
            return (
              <View
                key={`p${si}`}
                style={[
                  sharedStyles.pileLayer,
                  {
                    zIndex: si,
                    opacity: isTop ? 1 : 0.4 + si * 0.15,
                    transform: [
                      { rotate: `${angle}deg` },
                      { translateX: ddx },
                      { translateY: ddy },
                    ],
                  },
                ]}
              >
                <View style={sharedStyles.pileCards}>
                  {combo.cards.slice(0, 5).map((card, ci) => (
                    <View
                      key={card.id}
                      style={{ marginLeft: ci > 0 ? -14 : 0, zIndex: ci }}
                    >
                      <CardView card={card} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
          {topCombo && (
            <View style={sharedStyles.comboLabel}>
              <View style={sharedStyles.comboChip}>
                <Text style={sharedStyles.comboChipText}>
                  {COMBO_LABELS[topCombo.type] ?? topCombo.type}
                  {topCombo.cards.length > 2 ? ` ×${topCombo.cards.length}` : ""}
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export function CardItem({
  card,
  isSelected,
  left,
  onPress,
  disabled,
  zIndex,
}: {
  card: Card;
  isSelected: boolean;
  left: number;
  onPress: () => void;
  disabled: boolean;
  zIndex: number;
}) {
  const liftY = useSharedValue(0);
  useEffect(() => {
    liftY.value = withSpring(isSelected ? -40 : 0, {
      damping: 14,
      stiffness: 260,
    });
  }, [isSelected]);
  const aStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: liftY.value }],
  }));
  return (
    <Animated.View
      style={[sharedStyles.handCardWrap, { left, zIndex }, aStyle]}
    >
      <CardView
        card={card}
        selected={isSelected}
        onPress={onPress}
        disabled={disabled}
        noLift
      />
    </Animated.View>
  );
}

export function StraightHand({
  cards,
  selectedIds,
  onPress,
  disabled,
  availW,
}: {
  cards: Card[];
  selectedIds: string[];
  onPress: (id: string) => void;
  disabled: boolean;
  availW: number;
}) {
  const n = cards.length;
  if (n === 0) {
    return (
      <View style={[sharedStyles.handCenter, { width: availW }]}>
        <Ionicons name="checkmark-circle" size={24} color={Colors.gold} />
        <Text style={sharedStyles.emptyHandText}>Carte finite!</Text>
      </View>
    );
  }
  const step = Math.max(20, Math.min(CARD_W, (availW - CARD_W) / Math.max(n - 1, 1)));
  const totalW = step * (n - 1) + CARD_W;

  return (
    <View style={[sharedStyles.handCenter, { width: availW }]}>
      <View style={[sharedStyles.handRow, { width: Math.min(totalW, availW) }]}>
        {cards.map((card, i) => (
          <CardItem
            key={card.id}
            card={card}
            isSelected={selectedIds.includes(card.id)}
            left={i * step}
            onPress={() => onPress(card.id)}
            disabled={disabled}
            zIndex={i}
          />
        ))}
      </View>
    </View>
  );
}

export const portraitOverlayStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3,16,8,0.97)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  card: {
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 40,
  },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 26,
    color: Colors.text,
    letterSpacing: 1,
    textAlign: "center",
  },
  sub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});

export const sharedTableStyles = StyleSheet.create({
  table: {
    position: "absolute",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(201,168,76,0.3)",
  },
  tableInnerBorder: {
    position: "absolute",
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(201,168,76,0.12)",
  },
  tableContent: { flex: 1, flexDirection: "column" },
  topSection: {
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(201,168,76,0.08)",
  },
  midSection: { flex: 1, flexDirection: "row", alignItems: "center" },
  sideSection: {
    width: SIDE_SECTION_W,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  centerSection: { flex: 1, alignItems: "center", justifyContent: "center" },
  handSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: BTN_W + 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(201,168,76,0.08)",
  },
});

export const sharedStyles = StyleSheet.create({
  flyingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
  },
  flyingInner: {
    width: CARD_W * 2.5,
    height: CARD_H,
    alignItems: "center",
    justifyContent: "center",
  },

  topOppSlot: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  topOppRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  topOppAvatarCol: { alignItems: "center", gap: 3 },

  sideOppSlot: { alignItems: "center", justifyContent: "center", gap: 6 },
  sideLeft: { flexDirection: "row" },
  sideRight: { flexDirection: "row-reverse" },
  sideOppAvatarCol: {
    alignItems: "center",
    gap: 3,
    marginHorizontal: 6,
  },

  oppName: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 10,
    color: "rgba(240,234,214,0.65)",
    maxWidth: 70,
    textAlign: "center",
  },

  avatarOuter: {
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarOuterActive: {
    borderColor: Colors.gold,
    shadowColor: Colors.gold,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  avatarInner: {
    backgroundColor: "rgba(11,59,37,0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.18)",
  },
  avatarInitials: {
    fontFamily: "Rajdhani_700Bold",
    color: Colors.text,
    letterSpacing: 0.5,
  },
  countBubble: {
    position: "absolute",
    bottom: -3,
    right: -3,
    backgroundColor: "rgba(4,16,8,0.9)",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.3)",
  },
  countBubbleText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
  },

  pileArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
  },
  winnerTag: {
    position: "absolute",
    top: -28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.goldMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    zIndex: 20,
  },
  winnerText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 11,
    color: Colors.gold,
  },
  emptyText: {
    fontFamily: "Rajdhani_500Medium",
    fontSize: 12,
    color: "rgba(240,234,214,0.18)",
  },
  pileStack: { alignItems: "center", justifyContent: "center" },
  pileLayer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  pileCards: { flexDirection: "row", alignItems: "flex-end" },
  comboLabel: { marginTop: CARD_H + 12 },
  comboChip: {
    backgroundColor: "rgba(201,168,76,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(201,168,76,0.4)",
  },
  comboChipText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 10,
    color: Colors.gold,
    letterSpacing: 1,
    textTransform: "uppercase",
  },

  handCenter: {
    alignItems: "center",
    justifyContent: "center",
    height: CARD_H,
    flexDirection: "row",
    gap: 6,
  },
  handRow: {
    position: "relative",
    height: CARD_H,
    alignSelf: "center",
  },
  handCardWrap: { position: "absolute", bottom: 0 },
  emptyHandText: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: 13,
    color: Colors.gold,
  },
});
