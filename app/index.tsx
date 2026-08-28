import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path } from "react-native-svg";
import { getLattice } from "@/components/cardFaceModel";
import { DEFAULT_CARD_BACK } from "@/lib/cosmetics";
import { CardBacks } from "@/lib/tokens";
import {
  DEPTH_BANDS,
  LANDSCAPE_CARDS,
  PORTRAIT_CARDS,
  cardBox,
  restingPose,
  type FloatingCardSpec,
} from "@/components/homeCardField";
import { homeMenu, type HomeAction } from "@/components/homeMenuModel";
import { hapticLight } from "@/lib/haptics";
import Feather from "@expo/vector-icons/Feather";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useGame } from "@/context/GameContext";
import { useSocket } from "@/context/SocketContext";
import { usePrefersReducedMotion } from "@/lib/accessibility";
import { Colors, FontSize, makeShadow, Motion, Radius, Spacing, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { useTranslation } from "@/lib/i18n";
import { SettingsModal } from "@/components/SettingsModal";
import { a11yHidden, a11yState } from "@/lib/a11y";
import { markTutorialSeen, tutorialSeen } from "@/lib/tutorialSeen";


/** The field borrows the lattice of the back a fresh install deals with. */
const LATTICE_SPACING = CardBacks[DEFAULT_CARD_BACK].lattice;
const LATTICE_INK = 0.16;
const LATTICE_STROKE = 0.6;

/**
 * The tail of a leg already `t0` of its *duration* through it.
 * `Easing.inOut(Easing.sin)` is exactly (1 - cos(pi t)) / 2, so a leg resumed
 * by restarting that ease leaves from a standstill — which is the tell that
 * the drift is a keyframe rather than motion that was already under way.
 */
function resumeSine(t0: number) {
  const covered = (1 - Math.cos(Math.PI * t0)) / 2;
  return (t: number) => {
    "worklet";
    return ((1 - Math.cos(Math.PI * (t0 + t * (1 - t0)))) / 2 - covered) / (1 - covered);
  };
}

/**
 * A there-and-back loop with no end, entered at `at` rather than at rest, so a
 * field of them is scattered and already moving on first paint. Under reduced
 * motion it is that position and nothing more: there is nothing here to
 * convey, only mood.
 *
 * How far along its *value* a card starts is not how far along its *time* it
 * starts — an ease is the difference between the two — so the entry point goes
 * back through the ease rather than standing in for a fraction of the leg.
 */
function phased(at: number, from: number, to: number, halfMs: number, reduceMotion: boolean) {
  if (reduceMotion) return at;
  const t0 = Math.acos(1 - 2 * ((at - from) / (to - from))) / Math.PI;
  const leg = (target: number, ms: number) =>
    withTiming(target, { duration: ms, easing: Easing.inOut(Easing.sin) });
  return withSequence(
    withTiming(to, { duration: halfMs * (1 - t0), easing: resumeSine(t0) }),
    withRepeat(withSequence(leg(from, halfMs), leg(to, halfMs)), -1, false)
  );
}

/**
 * One drifting card. Two shared values carry three channels: the rise, and a
 * swing whose tilt and sideways travel peak together the way a hanging card's
 * do. Both start part-way through their first leg, so the field is already in
 * motion on first paint (components/homeCardField.ts).
 */
function FloatingCard({ spec }: { spec: FloatingCardSpec }) {
  const reduceMotion = usePrefersReducedMotion();
  const band = DEPTH_BANDS[spec.depth];
  const { width, height } = cardBox(spec.depth);
  const { rise: restLift, swing: restSwing } = restingPose(spec);
  const lift = useSharedValue(restLift);
  const swing = useSharedValue(restSwing);

  useEffect(() => {
    lift.value = phased(restLift, 0, 1, band.driftMs / 2, reduceMotion);
    swing.value = phased(restSwing, -1, 1, band.tiltMs / 2, reduceMotion);
  }, [band, lift, reduceMotion, restLift, restSwing, swing]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -lift.value * band.rise },
      { translateX: swing.value * band.sway },
      { rotate: `${swing.value * band.tilt}deg` },
    ],
  }));

  return (
    <Animated.View
      testID="floating-card"
      style={[
        styles.floatingCard,
        { left: `${spec.x * 100}%`, width, height, opacity: band.opacity },
        makeShadow(Colors.shadow, 0, band.shadow.offsetY, band.shadow.opacity, band.shadow.radius, band.shadow.elevation),
        animStyle,
      ]}
    >
      {/* The shadow is cast by the view above, which does not clip: iOS reads
          `overflow: hidden` as masksToBounds, and a masked layer casts none. */}
      <View style={styles.floatingCardFace}>
        <LinearGradient colors={[Colors.feltLight, Colors.felt]} style={StyleSheet.absoluteFill} />
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path
            d={getLattice(width, height, LATTICE_SPACING)}
            stroke={Colors.gold}
            strokeOpacity={LATTICE_INK}
            strokeWidth={LATTICE_STROKE}
            fill="none"
          />
        </Svg>
        <View style={styles.floatingCardPattern} />
      </View>
    </Animated.View>
  );
}

/** The whole field, decorative and out of reach of both the tab order and
 * assistive technology. */
function CardField({ cards }: { cards: FloatingCardSpec[] }) {
  return (
    <View testID="card-field" style={StyleSheet.absoluteFill} pointerEvents="none" {...a11yHidden()}>
      {cards.map((spec) => (
        <FloatingCard key={`${spec.depth}-${spec.x}`} spec={spec} />
      ))}
    </View>
  );
}

/** One item after another, so the screen assembles rather than appearing. */
const ENTRANCE_STEP_MS = Motion.duration.fast;
/** How far an entering item travels. */
const RISE = 24;

function useEntrance(step: number) {
  const reduceMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(RISE);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    const delay = step * ENTRANCE_STEP_MS;
    opacity.value = withDelay(delay, withTiming(1, { duration: Motion.duration.slow }));
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: Motion.duration.slow, easing: Easing.out(Easing.cubic) })
    );
  }, [opacity, reduceMotion, step, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

function usePressScale() {
  const reduceMotion = usePrefersReducedMotion();
  const scale = useSharedValue(1);

  // Must precede the hook that reads `scale` — the React Compiler skips any
  // component that mutates a value a hook captured.
  const press = () => {
    if (reduceMotion) return;
    scale.value = withSequence(
      withTiming(PRESS_SCALE, { duration: Motion.duration.flash }),
      withTiming(1, { duration: Motion.duration.fast })
    );
  };

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return { style, press };
}

const PRESS_SCALE = 0.96;

/**
 * The one thing on the screen worth doing next. Never two, never absent —
 * which of the ways to play is promoted is `homeMenu`'s decision, not this
 * component's.
 */
function HomeHero({
  label,
  sublabel,
  icon,
  onPress,
  step,
}: {
  label: string;
  sublabel?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  step: number;
}) {
  const entrance = useEntrance(step);
  const { style: pressed, press } = usePressScale();

  return (
    <Animated.View style={[entrance, pressed]}>
      <Pressable
        testID="home-hero"
        onPress={() => {
          press();
          hapticLight();
          onPress();
        }}
        accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
        {...a11yState({ role: "button" })}
        style={({ pressed: down }) => [styles.hero, down && { opacity: 0.9 }]}
      >
        <LinearGradient
          colors={[Colors.gold, Colors.goldDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroFill}
          {...a11yHidden()}
        >
          <Ionicons name={icon} size={HERO_ICON} color={Colors.bgCard} />
          <View>
            <Text style={styles.heroLabel}>{label}</Text>
            {sublabel ? <Text style={styles.heroSublabel}>{sublabel}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={HERO_CHEVRON} color={Colors.bgCard} />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const HERO_ICON = 26;
const HERO_CHEVRON = 20;
const TILE_ICON = 24;

/** A way to play that is not the hero: icon over label, and nowhere to look next. */
function HomeModeTile({
  label,
  reason,
  icon,
  onPress,
  step,
}: {
  label: string;
  /** Why it cannot be taken — shown, and folded into the spoken name. */
  reason?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  step: number;
}) {
  const entrance = useEntrance(step);
  const { style: pressed, press } = usePressScale();
  const disabled = reason !== undefined;

  return (
    <Animated.View style={[styles.tileSlot, entrance, pressed]}>
      <Pressable
        testID="home-mode-tile"
        onPress={() => {
          press();
          hapticLight();
          onPress();
        }}
        disabled={disabled}
        accessibilityLabel={disabled ? `${label}. ${reason}` : label}
        {...a11yState({ role: "button", disabled })}
        style={({ pressed: down }) => [
          styles.tile,
          disabled && styles.tileDisabled,
          down && { opacity: 0.85 },
        ]}
      >
        <Ionicons
          name={icon}
          size={TILE_ICON}
          color={disabled ? Colors.textMuted : Colors.gold}
          {...a11yHidden()}
        />
        <Text
          {...a11yHidden()}
          style={[styles.tileLabel, disabled && { color: Colors.textMuted }]}
          numberOfLines={2}
        >
          {label}
        </Text>
        {disabled ? (
          <Text {...a11yHidden()} style={styles.tileReason}>
            {reason}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The quietest thing that is still a destination — no fill, a hairline, and
 * the chevron that says you are coming back.
 */
function HomeQuietRow({
  label,
  icon,
  onPress,
  step,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  step: number;
}) {
  const entrance = useEntrance(step);

  return (
    <Animated.View style={[styles.quietRowSlot, entrance]}>
      <Pressable
        testID="home-how-to-play"
        onPress={() => {
          hapticLight();
          onPress();
        }}
        accessibilityLabel={label}
        {...a11yState({ role: "button" })}
        style={({ pressed }) => [styles.quietRow, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name={icon} size={QUIET_ICON} color={Colors.textMuted} {...a11yHidden()} />
        <Text {...a11yHidden()} style={styles.quietLabel}>
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={QUIET_CHEVRON} color={Colors.textMuted} {...a11yHidden()} />
      </Pressable>
    </Animated.View>
  );
}

const QUIET_ICON = 16;
const QUIET_CHEVRON = 14;
const ACCOUNT_ICON = 20;
const AVATAR_SIZE = 52;

/** A place you land on rather than pass through, which is why it has no chevron. */
function HomeAccountButton({
  label,
  icon,
  badge,
  onPress,
}: {
  label: string;
  /** Drawn by the caller: an icon named through a prop is a name the subset
      builder cannot follow, and an unbuilt glyph renders as a blank box. */
  icon: React.ReactNode;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityLabel={label}
      {...a11yState({ role: "button" })}
      style={({ pressed }) => [styles.accountBtn, pressed && { opacity: 0.8 }]}
    >
      {icon}
      {badge ? (
        <View style={styles.badge} {...a11yHidden()}>
          <Text style={styles.badgeText}>{badge > BADGE_MAX ? `${BADGE_MAX}+` : String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const BADGE_MAX = 9;

/** How many friend requests are waiting, for whoever is signed in. */
function useFriendRequestCount() {
  const { user } = useAuth();
  const { data = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/friends/requests"],
    enabled: !!user,
    staleTime: FRIEND_REQUEST_STALE_MS,
    refetchOnWindowFocus: true,
  });
  return data.length;
}

const FRIEND_REQUEST_STALE_MS = 15000;

const goProfile = () => router.push("/(online)/profile");
const goFriends = () => router.push("/(online)/friends");
const goRanking = () => router.push("/(online)/leaderboard");

/** Portrait: who you are and the four places that are about you, top right. */
function HomeAccountBar({ onSettings }: { onSettings: () => void }) {
  const { user } = useAuth();
  const { t, tn } = useTranslation();
  const requests = useFriendRequestCount();
  const entrance = useEntrance(0);

  return (
    <Animated.View style={[styles.accountBar, entrance]}>
      {user ? (
        <>
          <HomeAccountButton
            label={t("home.modeProfile")}
            icon={<Ionicons name="person-circle-outline" size={ACCOUNT_ICON} color={Colors.gold} {...a11yHidden()} />}
            onPress={goProfile}
          />
          <HomeAccountButton
            label={requests > 0 ? tn("home.friendsA11yLabel", requests) : t("home.friendsLabel")}
            icon={<Ionicons name="people" size={ACCOUNT_ICON} color={Colors.gold} {...a11yHidden()} />}
            badge={requests}
            onPress={goFriends}
          />
          <HomeAccountButton
            label={t("home.leaderboard")}
            icon={<Ionicons name="podium-outline" size={ACCOUNT_ICON} color={Colors.gold} {...a11yHidden()} />}
            onPress={goRanking}
          />
        </>
      ) : (
        <HomeAccountButton
          label={t("home.signIn")}
          icon={<Ionicons name="log-in-outline" size={ACCOUNT_ICON} color={Colors.gold} {...a11yHidden()} />}
          onPress={() => router.push("/auth")}
        />
      )}
      <HomeAccountButton
        label={t("home.settingsA11yLabel")}
        icon={<Feather name="settings" size={ACCOUNT_ICON} color={Colors.gold} {...a11yHidden()} />}
        onPress={onSettings}
      />
    </Animated.View>
  );
}

/**
 * Landscape: the same entries, composed down the brand column rather than
 * along one line. Friends and Ranking are both about other people and read as
 * a pair; Settings is app configuration and is deliberately quieter.
 */
function HomePlayerUnit({ onSettings }: { onSettings: () => void }) {
  const { user } = useAuth();
  const { t, tn } = useTranslation();
  const requests = useFriendRequestCount();
  const entrance = useEntrance(1);

  if (!user) {
    return (
      <Animated.View style={[styles.playerUnit, entrance]}>
        <HomePill
          label={t("home.signIn")}
          text={t("home.signIn")}
          icon={<Ionicons name="log-in-outline" size={PILL_ICON} color={Colors.gold} {...a11yHidden()} />}
          onPress={() => router.push("/auth")}
        />
        <HomePill
          label={t("home.settingsA11yLabel")}
          icon={<Feather name="settings" size={PILL_ICON} color={Colors.textMuted} {...a11yHidden()} />}
          quiet
          testID="home-account-settings"
          onPress={onSettings}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.playerUnit, entrance]}>
      <Pressable
        onPress={() => {
          hapticLight();
          goProfile();
        }}
        accessibilityLabel={t("home.modeProfile")}
        {...a11yState({ role: "button" })}
        style={({ pressed }) => [styles.avatarBtn, pressed && { opacity: 0.85 }]}
        testID="home-account-avatar"
      >
        <View style={styles.avatar} {...a11yHidden()}>
          <Text style={styles.avatarText}>{user.username.charAt(0).toUpperCase()}</Text>
        </View>
        <Text {...a11yHidden()} style={styles.playerName} numberOfLines={1}>
          {user.username}
        </Text>
      </Pressable>

      <View style={styles.pillPair} testID="home-account-pair">
        <HomePill
          label={requests > 0 ? tn("home.friendsA11yLabel", requests) : t("home.friendsLabel")}
          text={t("home.friendsLabel")}
          icon={<Ionicons name="people" size={PILL_ICON} color={Colors.gold} {...a11yHidden()} />}
          badge={requests}
          onPress={goFriends}
        />
        <HomePill
          label={t("home.leaderboard")}
          text={t("home.leaderboard")}
          icon={<Ionicons name="podium-outline" size={PILL_ICON} color={Colors.gold} {...a11yHidden()} />}
          onPress={goRanking}
        />
      </View>

      <HomePill
          label={t("home.settingsA11yLabel")}
          icon={<Feather name="settings" size={PILL_ICON} color={Colors.textMuted} {...a11yHidden()} />}
          quiet
          testID="home-account-settings"
          onPress={onSettings}
        />
    </Animated.View>
  );
}

const PILL_ICON = 16;

function HomePill({
  label,
  text,
  icon,
  badge,
  quiet = false,
  testID,
  onPress,
}: {
  label: string;
  /** The word on the pill, when it carries one. */
  text?: string;
  icon: React.ReactNode;
  badge?: number;
  quiet?: boolean;
  testID?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        hapticLight();
        onPress();
      }}
      accessibilityLabel={label}
      {...a11yState({ role: "button" })}
      style={({ pressed }) => [styles.pill, quiet && styles.pillQuiet, pressed && { opacity: 0.8 }]}
    >
      {icon}
      {text ? (
        <Text {...a11yHidden()} style={[styles.pillText, quiet && { color: Colors.textMuted }]}>
          {text}
        </Text>
      ) : null}
      {badge ? (
        <View style={styles.pillBadge} {...a11yHidden()}>
          <Text style={styles.badgeText}>{badge > BADGE_MAX ? `${BADGE_MAX}+` : String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * An invitation, where the player already is, with the join on it.
 *
 * The join cannot happen here: `joinRoom` lives in `OnlineGameContext`, whose
 * provider is mounted inside the `(online)` group alone, and hoisting it would
 * put a socket-backed game context above every signed-out screen. So this
 * navigates into the group and the invite is read there — the invite is
 * already in `SocketContext`, above the whole app, so nothing has to be
 * carried across (#398).
 */
function HomeInviteCard({ from, step }: { from: string; step: number }) {
  const { t } = useTranslation();
  const entrance = useEntrance(step);

  return (
    <Animated.View style={[styles.inviteCard, entrance]}>
      <Ionicons name="mail-unread-outline" size={INVITE_ICON} color={Colors.gold} {...a11yHidden()} />
      <Text style={styles.inviteText} numberOfLines={1}>
        {t("home.inviteWaiting", { name: from })}
      </Text>
      <Pressable
        testID="home-invite-join"
        onPress={() => {
          hapticLight();
          router.push("/(online)");
        }}
        accessibilityLabel={t("home.inviteJoin")}
        {...a11yState({ role: "button" })}
        style={({ pressed }) => [styles.inviteJoin, pressed && { opacity: 0.85 }]}
      >
        <Text {...a11yHidden()} style={styles.inviteJoinText}>
          {t("home.inviteJoin")}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const INVITE_ICON = 18;

const TILE_ICONS: Record<HomeAction, React.ComponentProps<typeof Ionicons>["name"]> = {
  resume: "play-circle",
  offline: "game-controller",
  friends: "people",
  online: "earth-outline",
  passAndPlay: "phone-portrait-outline",
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const tutorialDecided = useRef(false);
  const { hasSavedGame, resumeGame } = useGame();
  const { gameInvites } = useSocket();
  const { t } = useTranslation();
  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const [settingsVisible, setSettingsVisible] = useState(false);

  const reduceMotion = usePrefersReducedMotion();
  const titleOpacity = useSharedValue(0);
  const titleScale = useSharedValue(TITLE_FROM);

  useEffect(() => {
    if (reduceMotion) {
      titleOpacity.value = 1;
      titleScale.value = 1;
      return;
    }
    titleOpacity.value = withTiming(1, { duration: Motion.duration.slow });
    titleScale.value = withTiming(1, {
      duration: Motion.duration.slow,
      easing: Easing.out(Easing.back(TITLE_OVERSHOOT)),
    });
  }, [reduceMotion, titleOpacity, titleScale]);

  // First-launch onboarding: offer the interactive tutorial automatically, once
  // ever. This runs on every mount of the title screen, and every
  // `router.replace("/")` in the app remounts it, so "once" has to come from
  // the stored answer alone: app/tutorial.tsx writes it when the screen opens,
  // not when it is completed. Never gates play — the player can leave by any
  // route.
  //
  // Nothing is asked until AuthProvider has answered once — the account half of
  // the answer arrives late and this screen renders before it. An unreachable
  // server answers `null`, and the device is then the whole answer. The ref
  // holds the decision to one per mount, not one per identity settled on.
  useEffect(() => {
    if (authLoading || tutorialDecided.current) return;
    tutorialDecided.current = true;
    tutorialSeen(user).then((seen) => {
      if (!seen) {
        router.push("/tutorial");
        return;
      }
      // The device knows and the account does not, so the write that should
      // have told it never landed — offline, or on a session that had expired.
      // Same call, so the account catches up on the next launch instead of
      // re-offering the tutorial on the player's next phone.
      if (user && !user.tutorialSeenAt) void markTutorialSeen(user.id);
    });
  }, [authLoading, user]);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));

  // A floor, not just the real inset: on a notchless device (most desktop
  // browsers) env(safe-area-inset-*) is genuinely 0, and content flush
  // against the browser's raw edge is not a safe area, it's a missing margin.
  const topPad = Math.max(insets.top, Spacing.roomy);
  const bottomPad = Math.max(insets.bottom, Spacing.roomy);
  const leftPad = isLandscape ? insets.left : 0;
  const rightPad = isLandscape ? insets.right : 0;

  const menu = homeMenu({ savedGame: hasSavedGame, account: !!user });
  // The most recent, because an invitation that has just arrived is the one
  // the player is looking for. `SocketContext` appends.
  const invite = gameInvites.at(-1) ?? null;

  // Resuming restores the context first; the table renders from what it finds.
  const go: Record<HomeAction, () => void> = {
    resume: () => {
      if (resumeGame()) router.push("/game");
    },
    offline: () => router.push({ pathname: "/lobby", params: { mode: "ai" } }),
    friends: () => router.push("/(online)"),
    online: () => router.push("/(online)/quickmatch"),
    passAndPlay: () => router.push({ pathname: "/lobby", params: { mode: "local" } }),
  };

  const label: Record<HomeAction, string> = {
    resume: t("home.resumeGame"),
    offline: t("home.modeOffline"),
    friends: t("home.modePlayWithFriends"),
    online: t("home.modeOnline"),
    passAndPlay: t("home.modePassAndPlay"),
  };

  // The signed-out hero says where it leads rather than redirecting silently.
  const heroLabel = menu.hero === "online" ? t("home.playOnline") : label[menu.hero];
  const hero = (
    <HomeHero
      label={heroLabel}
      sublabel={menu.heroNeedsAccount ? t("home.playOnlineSignedOut") : undefined}
      icon={TILE_ICONS[menu.hero]}
      onPress={menu.heroNeedsAccount ? () => router.push("/auth") : go[menu.hero]}
      step={STEP_HERO}
    />
  );

  const tiles = (
    <View style={styles.tileGrid}>
      {menu.tiles.map((tile, i) => (
        <HomeModeTile
          key={tile.action}
          label={label[tile.action]}
          reason={tile.disabled ? t("home.requiresAccount") : undefined}
          icon={TILE_ICONS[tile.action]}
          onPress={go[tile.action]}
          step={STEP_TILES + i}
        />
      ))}
    </View>
  );

  const howToPlay = (
    <HomeQuietRow
      label={t("home.howToPlay")}
      icon="book-outline"
      onPress={() => router.push("/rules")}
      step={STEP_TILES + menu.tiles.length}
    />
  );

  const wordmark = (
    <Animated.View style={[titleStyle, { alignItems: "center" }]}>
      <View style={styles.wordmarkRow}>
        <Text style={isLandscape ? styles.titleLandscape : styles.title}>MURLAN</Text>
        {__DEV__ && (
          <View style={styles.devBadge}>
            <Text style={styles.devBadgeText}>DEV</Text>
          </View>
        )}
      </View>
      <View style={isLandscape ? styles.titleUnderlineLandscape : styles.titleUnderline}>
        <LinearGradient
          colors={[Colors.goldDark, Colors.gold, Colors.goldDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.underlineFill}
        />
      </View>
      <Text style={isLandscape ? styles.subtitleLandscape : styles.subtitle}>{t("home.subtitle")}</Text>
    </Animated.View>
  );

  if (isLandscape) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: topPad, paddingBottom: bottomPad, paddingLeft: leftPad, paddingRight: rightPad },
        ]}
      >
        <LinearGradient
          colors={[Colors.bg, Colors.bgCard, Colors.feltDark]}
          locations={GRADIENT_STOPS}
          style={StyleSheet.absoluteFill}
        />
        <CardField cards={LANDSCAPE_CARDS} />

        <View style={styles.landscapeRow}>
          <View style={styles.brandColumn}>
            {wordmark}
            <HomePlayerUnit onSettings={() => setSettingsVisible(true)} />
          </View>

          <ScrollView
            style={styles.playColumn}
            contentContainerStyle={styles.playColumnContent}
            showsVerticalScrollIndicator={false}
          >
            {invite && <HomeInviteCard from={invite.from} step={STEP_INVITE} />}
            {hero}
            {tiles}
            {howToPlay}
          </ScrollView>
        </View>
        <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <LinearGradient
        colors={[Colors.bg, Colors.bgCard, Colors.feltDark]}
        locations={GRADIENT_STOPS}
        style={StyleSheet.absoluteFill}
      />
      <CardField cards={PORTRAIT_CARDS} />

      <HomeAccountBar onSettings={() => setSettingsVisible(true)} />

      <View style={styles.header}>{wordmark}</View>

      {invite && <HomeInviteCard from={invite.from} step={STEP_INVITE} />}

      <View style={styles.playBlock}>
        {hero}
        {tiles}
      </View>

      {howToPlay}
      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
    </View>
  );
}

const GRADIENT_STOPS = [0, 0.5, 1] as const;
const TITLE_FROM = 0.85;
const TITLE_OVERSHOOT = 1.5;
const STEP_INVITE = 1;
const STEP_HERO = 2;
const STEP_TILES = 3;

// The wordmark, above every step of the type scale on purpose — it is the one
// thing on the screen that is not text to read.
const WORDMARK_SIZE = 56;
const UNDERLINE_H = 2;
const HAIRLINE = 1;
const BADGE_SIZE = 18;
const BADGE_OFFSET = -4;
const BADGE_RING = 1.5;
const CARD_EDGE = 1.5;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  accountBar: {
    flexDirection: "row",
    alignSelf: "flex-end",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  accountBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.full,
    backgroundColor: Colors.bgSurface,
    borderWidth: HAIRLINE,
    borderColor: Colors.goldSoft,
  },

  header: { alignItems: "center", paddingTop: Spacing.lg, paddingBottom: Spacing.cosy },
  wordmarkRow: { flexDirection: "row", alignItems: "center", gap: Spacing.snug },
  title: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: WORDMARK_SIZE,
    color: Colors.text,
    letterSpacing: 12,
    textAlign: "center",
  },
  titleLandscape: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.hero,
    color: Colors.text,
    letterSpacing: 8,
    textAlign: "center",
  },
  titleUnderline: { width: 160, alignSelf: "center", marginTop: Spacing.xs },
  titleUnderlineLandscape: { width: 110, alignSelf: "center", marginTop: Spacing.xxs },
  underlineFill: { flex: 1, height: UNDERLINE_H, borderRadius: Radius.sm },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.sm,
    color: Colors.gold,
    letterSpacing: 4,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: Spacing.xs,
  },
  subtitleLandscape: {
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.xxs,
    color: Colors.gold,
    letterSpacing: 3,
    textTransform: "uppercase",
    textAlign: "center",
    marginTop: Spacing.xxs,
  },
  devBadge: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.slim,
    paddingVertical: Spacing.xxs,
    alignSelf: "center",
  },
  devBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.white,
    letterSpacing: 1,
  },

  playBlock: { flex: 1, justifyContent: "center", paddingHorizontal: Spacing.lg, gap: Spacing.cosy },

  hero: {
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.md,
    overflow: "hidden",
    borderWidth: HAIRLINE,
    borderColor: Colors.gold,
  },
  heroFill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.roomy,
    gap: Spacing.wide,
  },
  heroLabel: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xl,
    color: Colors.bgCard,
    letterSpacing: 0.5,
  },
  heroSublabel: { fontFamily: "Inter_500Medium", fontSize: FontSize.xs, color: Colors.bgCard },

  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.cosy },
  tileSlot: { flexGrow: 1, flexBasis: "45%" },
  tile: {
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.snug,
    borderWidth: HAIRLINE,
    borderColor: Colors.goldBorder,
  },
  tileDisabled: { borderColor: Colors.border, opacity: 0.6 },
  tileLabel: {
    fontFamily: "Rajdhani_600SemiBold",
    fontSize: FontSize.md,
    color: Colors.text,
    textAlign: "center",
  },
  tileReason: { ...Type.caption, textAlign: "center" },

  quietRowSlot: { marginTop: "auto", paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  quietRow: {
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.cosy,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: HAIRLINE,
    borderColor: Colors.border,
  },
  quietLabel: { ...Type.label, flex: 1 },

  inviteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.cosy,
    marginHorizontal: Spacing.lg,
    padding: Spacing.cosy,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: HAIRLINE,
    borderColor: Colors.gold,
  },
  inviteText: { ...Type.bodyStrong, flex: 1 },
  inviteJoin: {
    minHeight: TOUCH_TARGET_MIN,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.gold,
  },
  inviteJoinText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.md, color: Colors.bgCard },

  landscapeRow: { flex: 1, flexDirection: "row" },
  brandColumn: {
    width: "38%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
    borderRightWidth: HAIRLINE,
    borderRightColor: Colors.border,
  },
  playColumn: { flex: 1 },
  playColumnContent: {
    flexGrow: 1,
    padding: Spacing.md,
    gap: Spacing.cosy,
    justifyContent: "center",
  },

  playerUnit: { alignItems: "center", gap: Spacing.sm, alignSelf: "stretch" },
  avatarBtn: { alignItems: "center", gap: Spacing.xs, minHeight: TOUCH_TARGET_MIN },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    borderWidth: HAIRLINE,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.xl, color: Colors.gold },
  playerName: { ...Type.bodyStrong, maxWidth: "100%" },

  pillPair: { flexDirection: "row", gap: Spacing.sm, alignSelf: "stretch" },
  pill: {
    flex: 1,
    minHeight: TOUCH_TARGET_MIN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.slim,
    paddingHorizontal: Spacing.snug,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgSurface,
    borderWidth: HAIRLINE,
    borderColor: Colors.goldSoft,
  },
  pillQuiet: { backgroundColor: "transparent", borderColor: Colors.border, alignSelf: "stretch" },
  pillText: { ...Type.label, color: Colors.text },
  pillBadge: {
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },

  badge: {
    position: "absolute",
    top: BADGE_OFFSET,
    right: BADGE_OFFSET,
    minWidth: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: Radius.full,
    backgroundColor: Colors.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
    borderWidth: BADGE_RING,
    borderColor: Colors.bg,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: FontSize.xxs,
    color: Colors.white,
  },

  floatingCard: {
    position: "absolute",
    top: "12%",
    borderRadius: Radius.sm,
    backgroundColor: Colors.felt,
  },
  floatingCardFace: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.sm,
    overflow: "hidden",
    borderWidth: CARD_EDGE,
    borderColor: Colors.goldDark,
  },
  floatingCardPattern: {
    position: "absolute",
    top: Spacing.xs,
    left: Spacing.xs,
    right: Spacing.xs,
    bottom: Spacing.xs,
    borderRadius: Radius.sm,
    borderWidth: HAIRLINE,
    borderColor: Colors.goldBorder,
  },
});
