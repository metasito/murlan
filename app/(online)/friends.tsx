import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { hapticMedium, hapticSuccess } from "@/lib/haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSocket } from "@/context/SocketContext";
import { useOnlineRoom } from "@/context/onlineGameHooks";
import { useNotification } from "@/context/NotificationContext";
import { serverErrorMessage } from "@/lib/apiError";
import { apiRequest } from "@/lib/query-client";
import { Colors, Spacing, FontSize, Radius, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { MenuButton } from "@/components/MenuButton";
import { MenuLayout, takesSlack } from "@/components/MenuLayout";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { useTranslation } from "@/lib/i18n";
import { registerForPush } from "@/lib/pushRegistration";
import type { TranslationKey, TranslationParams } from "@/lib/i18n";
import { a11yHidden, a11yState, useA11yHint } from "@/lib/a11y";

type TFn = (key: TranslationKey, params?: TranslationParams) => string;
type TnFn = (base: string, count: number, params?: TranslationParams) => string;

interface FriendInfo {
  id: string;
  username: string;
  lastSeen: string | null;
}
interface FriendRequest { id: string; username: string; createdAt: string | null }
interface SearchResult { id: string; username: string }

function relativeTime(isoString: string | null | undefined, t: TFn, tn: TnFn): string {
  if (!isoString) return t("friends.timeUnknown");
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("friends.timeJustNow");
  if (mins < 60) return t("friends.timeMinutesAgo", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tn("friends.timeHoursAgo", hours);
  const days = Math.floor(hours / 24);
  return tn("friends.timeDaysAgo", days);
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {count !== undefined && (
        <View style={styles.badge} testID="section-count">
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

/** The direction inside PENDING. Quieter than a section, and never a count. */
function GroupLabel({ text }: { text: string }) {
  return <Text style={styles.groupLabel} accessibilityRole="header">{text}</Text>;
}

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function FriendsScreen() {
  const { t, tn } = useTranslation();
  const searchHint = useA11yHint(t("friends.searchA11yHint"));
  const { socket, onlineIds, gameInvites, dismissGameInvite } = useSocket();
  const { joinRoom, room } = useOnlineRoom();
  const qc = useQueryClient();
  const [addLoading, setAddLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmRequest | null>(null);
  const { showNotification } = useNotification();
  const showError = (message: string) =>
    showNotification({ type: "game_error", title: t("common.error"), message });

  const {
    data: friends = [],
    isLoading: friendsLoading,
    isError: friendsErrored,
    refetch: refetchFriends,
  } = useQuery<FriendInfo[]>({
    queryKey: ["/api/friends"],
    refetchOnWindowFocus: true,
  });

  const { data: requests = [] } = useQuery<FriendRequest[]>({
    queryKey: ["/api/friends/requests"],
    refetchOnWindowFocus: true,
  });

  const { data: sentRequests = [] } = useQuery<FriendRequest[]>({
    queryKey: ["/api/friends/sent"],
    refetchOnWindowFocus: true,
  });

  const pendingCount = requests.length + sentRequests.length;

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/friends/accept/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["/api/friends/requests"] });
      qc.setQueryData(
        ["/api/friends/requests"],
        (old: FriendRequest[] = []) => old.filter((r) => r.id !== id)
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/friends/decline/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (requestId: string) => {
      await apiRequest("DELETE", `/api/friends/requests/${requestId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/friends/sent"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (friendId: string) => {
      await apiRequest("DELETE", `/api/friends/${friendId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
    },
  });

  function handleRemoveFriend(friend: FriendInfo) {
    setConfirming({
      title: t("friends.removeConfirmTitle"),
      body: t("friends.removeConfirmBody", { username: friend.username }),
      cancelLabel: t("common.cancel"),
      confirmLabel: t("friends.removeConfirmConfirm"),
      destructive: true,
      onConfirm: () => removeMutation.mutate(friend.id),
    });
  }

  async function handleSearchUsername() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResult(null);
    setSearchError(null);
    setSearchDone(false);
    try {
      const res = await apiRequest("GET", `/api/users/search?username=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      setSearchResult(data);
      setSearchDone(true);
    } catch (e: unknown) {
      setSearchError(serverErrorMessage(e, t("friends.userNotFound")));
      setSearchDone(true);
    }
    setSearchLoading(false);
  }

  async function handleSendRequestToFound() {
    if (!searchResult) return;
    setAddLoading(true);
    try {
      const res = await apiRequest("POST", "/api/friends/add", { username: searchResult.username });
      const data = await res.json();
      hapticSuccess();
      showNotification({
        type: "friend_request",
        title: t("friends.requestSentTitle"),
        message: t("friends.requestSentBody", { username: data.username }),
      });
      setSearchQuery("");
      setSearchResult(null);
      setSearchDone(false);
      qc.invalidateQueries({ queryKey: ["/api/friends/sent"] });
    } catch (e: unknown) {
      showError(serverErrorMessage(e, t("common.error")));
    }
    setAddLoading(false);
  }

  // The id, not the room: every field update would otherwise push the route again.
  const roomId = room?.roomId;
  useEffect(() => {
    if (roomId) {
      router.push("/(online)/room");
    }
  }, [roomId]);

  useFocusEffect(
    useCallback(() => {
      if (socket) socket.emit("friend:get_online_list");
    }, [socket])
  );

  // Asked here rather than at launch: the only notification the app sends is
  // an invite from someone on this screen, so this is where the permission
  // means something. Idempotent — it only prompts while the OS says the
  // question is still open.
  useEffect(() => {
    void registerForPush();
  }, []);

  function handleJoinGameInvite(roomCode: string) {
    hapticMedium();
    dismissGameInvite(roomCode);
    joinRoom(roomCode);
  }

  return (
    <MenuLayout scrollable centered={false}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.gold} {...a11yHidden()} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("friends.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.contentWrapper}>
        {/* ── SECTION 1: Aggiungi Amico ── */}
        <SectionHeader title={t("friends.sectionAddFriend")} />

        {/* Username search */}
        <View style={styles.inputCard}>
          <Text style={styles.inputCardLabel}>{t("friends.searchByUsername")}</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={searchQuery}
              onChangeText={(v) => {
                setSearchQuery(v);
                setSearchDone(false);
                setSearchResult(null);
                setSearchError(null);
              }}
              placeholder={t("friends.usernamePlaceholder")}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              onSubmitEditing={handleSearchUsername}
              returnKeyType="search"
              accessibilityLabel={t("friends.searchA11yLabel")}
              {...searchHint.props}
            />
            {searchHint.node}
            <Pressable
              onPress={handleSearchUsername}
              disabled={searchLoading || !searchQuery.trim()}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }, (!searchQuery.trim()) && styles.addBtnDim]}
              accessibilityLabel={t("friends.searchA11yLabel")}
              {...a11yState({ role: "button", disabled: searchLoading || !searchQuery.trim() })}
            >
              {searchLoading ? (
                <ActivityIndicator color={Colors.bgCard} size="small" />
              ) : (
                <Ionicons name="search" size={18} color={(!searchQuery.trim()) ? Colors.textMuted : Colors.bgCard} {...a11yHidden()} />
              )}
            </Pressable>
          </View>

          {searchDone && searchResult && (
            <View style={styles.searchResultCard}>
              <Avatar name={searchResult.username} />
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{searchResult.username}</Text>
              </View>
              <Pressable
                onPress={handleSendRequestToFound}
                disabled={addLoading}
                style={styles.sendBtn}
                accessibilityRole="button"
                accessibilityLabel={t("friends.sendRequestA11yLabel", { username: searchResult.username })}
              >
                {addLoading ? (
                  <ActivityIndicator color={Colors.bgCard} size="small" />
                ) : (
                  <Ionicons name="person-add" size={16} color={Colors.bgCard} {...a11yHidden()} />
                )}
              </Pressable>
            </View>
          )}

          {searchDone && searchError && (
            <View style={styles.searchErrorRow}>
              <Ionicons name="alert-circle-outline" size={14} color={Colors.textMuted} />
              <Text style={styles.searchErrorText}>{searchError}</Text>
            </View>
          )}
        </View>
        {/* ── SECTION 2: Amici ── */}
        <SectionHeader
          title={t("friends.sectionFriends")}
          count={friends.length > 0 ? friends.length : undefined}
        />
        <View style={[styles.band, styles.friendsBand]}>
        {friendsLoading && (
          <ActivityIndicator
            color={Colors.gold}
            style={{ marginVertical: Spacing.md }}
            accessibilityLabel={t("common.loading")}
          />
        )}
        {!friendsLoading && friendsErrored && (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t("friends.loadErrorTitle")}</Text>
            <MenuButton
              label={t("common.retry")}
              onPress={() => refetchFriends()}
              variant="secondary"
              size="sm"
              fullWidth={false}
              icon={<Ionicons name="refresh" size={16} color={Colors.gold} />}
            />
          </View>
        )}
        {!friendsLoading && !friendsErrored && friends.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t("friends.emptyFriends")}</Text>
          </View>
        )}
        {friends.length > 0 && (
          <View style={styles.listBlock}>
            {friends.map(item => {
              const isOnline = onlineIds.has(item.id);
              const statusText = isOnline ? t("friends.online") : t("friends.seenAgo", { time: relativeTime(item.lastSeen, t, tn) });
              // Not grouped: the row holds a control of its own, and
              // `accessible` would make it a leaf on iOS with that control
              // sealed inside.
              return (
                <View key={item.id} style={styles.row}>
                  <View style={styles.avatarWrapper} {...a11yHidden()}>
                    <Avatar name={item.username} />
                    <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.success : Colors.textMuted }]} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{item.username}</Text>
                    <Text style={[styles.rowSub, isOnline && { color: Colors.success }]}>
                      {statusText}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveFriend(item)}
                    style={styles.iconBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("friends.removeA11yLabel", { username: item.username })}
                    hitSlop={12}
                  >
                    <Ionicons name="person-remove-outline" size={16} color={Colors.textMuted} {...a11yHidden()} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        </View>

        {/* ── SECTION 3: Inviti a Giocare ── */}
        {gameInvites.length > 0 && (
          <>
            <SectionHeader title={t("friends.sectionGameInvites")} count={gameInvites.length} />
            <View style={styles.listBlock}>
              {gameInvites.map((invite) => (
                <View key={invite.roomCode} style={styles.row}>
                  <View style={styles.avatarWrapper}>
                    <Avatar name={invite.from} />
                    <View style={[styles.statusDot, { backgroundColor: Colors.success }]} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{invite.from}</Text>
                    <Text style={styles.rowSub}>{t("friends.roomLabel", { code: invite.roomCode })}</Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => dismissGameInvite(invite.roomCode)}
                      style={styles.declineBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.dismissInviteA11yLabel", { username: invite.from })}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={16} color={Colors.textMuted} {...a11yHidden()} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleJoinGameInvite(invite.roomCode)}
                      style={styles.joinBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.joinInviteA11yLabel", { username: invite.from })}
                    >
                      <Text style={styles.joinBtnText} {...a11yHidden()}>{t("friends.join")}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── SECTION 4: In Sospeso ──
            Always rendered, in both directions: a request that only has a home
            once it exists is a place nobody can find before they need it.

            The count is everything in the section, both ways, like the friends
            count above it. Only the home button's badge is a task counter, and
            that one reads incoming alone — a request you sent is not a task
            you owe. */}
        <SectionHeader
          title={t("friends.sectionPending")}
          count={pendingCount > 0 ? pendingCount : undefined}
        />
        <View style={styles.band}>
        {requests.length === 0 && sentRequests.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="hourglass-outline" size={32} color={Colors.textMuted} {...a11yHidden()} />
            <Text style={styles.emptyText}>{t("friends.emptyPending")}</Text>
          </View>
        )}
        {requests.length > 0 && (
          <>
            <GroupLabel text={t("friends.pendingIncoming")} />
            <View style={styles.listBlock}>
              {requests.map(r => (
                <View key={r.id} style={styles.row}>
                  <Avatar name={r.username} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{r.username}</Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => declineMutation.mutate(r.id)}
                      style={styles.declineBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.declineRequestA11yLabel", { username: r.username })}
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={16} color={Colors.textMuted} {...a11yHidden()} />
                    </Pressable>
                    <Pressable
                      onPress={() => acceptMutation.mutate(r.id)}
                      style={styles.acceptBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.acceptRequestA11yLabel", { username: r.username })}
                      hitSlop={8}
                    >
                      <Ionicons name="checkmark" size={16} color={Colors.bgCard} {...a11yHidden()} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {sentRequests.length > 0 && (
          <>
            <GroupLabel text={t("friends.pendingOutgoing")} />
            <View style={styles.listBlock}>
              {sentRequests.map(r => (
                <View key={r.id} style={styles.row}>
                  <Avatar name={r.username} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{r.username}</Text>
                    <Text style={styles.rowSub}>
                      {t("friends.awaitingSince", { time: relativeTime(r.createdAt, t, tn) })}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => cancelMutation.mutate(r.id)}
                    style={styles.iconBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("friends.cancelRequestA11yLabel", { username: r.username })}
                    hitSlop={12}
                  >
                    <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} {...a11yHidden()} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
        </View>

      </View>

      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
    </MenuLayout>
  );
}

const EMPTY_STATE_PADDING_V = 28;

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingBottom: Spacing.sm,
    marginBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    ...Type.heading,
    fontSize: FontSize.xl,
    letterSpacing: 3,
  },
  contentWrapper: {
    ...takesSlack,
    gap: Spacing.sm,
  },
  // The two lists are what grows with the account, so they are what takes a
  // tall window's spare height — two shares to friends, one to pending. They
  // carry the search card's own surface: a band with nothing in it has to read
  // as a region waiting to be filled, and an empty state centred on the
  // backdrop reads as a screen with a hole in it instead.
  band: {
    ...takesSlack,
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  friendsBand: { flexGrow: 2 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    ...Type.label,
    fontSize: FontSize.xs,
    letterSpacing: 2,
  },
  badge: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.slim,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  groupLabel: {
    ...Type.caption,
    letterSpacing: 1.5,
    marginTop: Spacing.xs,
  },

  listBlock: { gap: Spacing.sm },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.cosy,
    gap: Spacing.cosy,
    minHeight: TOUCH_TARGET_MIN,
  },
  avatarWrapper: { position: "relative" },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: Radius.full,
    backgroundColor: Colors.felt,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: Radius.sm,
    borderWidth: 2,
    borderColor: Colors.bgSurface,
  },
  avatarText: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.lg, color: Colors.gold },
  rowInfo: { flex: 1, gap: Spacing.xxs },
  rowName: { ...Type.bodyStrong },
  rowSub: { ...Type.caption },

  iconBtn: { width: TOUCH_TARGET_MIN, height: TOUCH_TARGET_MIN, alignItems: "center", justifyContent: "center" },

  actionRow: { flexDirection: "row", gap: Spacing.sm },
  declineBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtn: {
    minHeight: TOUCH_TARGET_MIN,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    paddingHorizontal: Spacing.wide,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.sm,
    color: Colors.bgCard,
  },

  inputCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.snug,
  },
  inputCardLabel: {
    ...Type.caption,
    letterSpacing: 1.5,
  },
  inputRow: { flexDirection: "row", gap: Spacing.snug },
  input: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    minHeight: TOUCH_TARGET_MIN,
    paddingVertical: Spacing.cosy,
    paddingHorizontal: Spacing.wide,
  },
  addBtn: {
    width: 48,
    minHeight: TOUCH_TARGET_MIN,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.gold,
    borderRadius: Radius.sm,
  },
  addBtnDim: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: TOUCH_TARGET_MIN,
    height: TOUCH_TARGET_MIN,
    borderRadius: Radius.full,
    backgroundColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  searchResultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.goldBorder,
    padding: Spacing.snug,
    gap: Spacing.snug,
  },
  searchErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.slim,
  },
  searchErrorText: {
    ...Type.caption,
  },

  empty: { alignItems: "center", paddingVertical: EMPTY_STATE_PADDING_V, gap: Spacing.snug },
  emptyText: {
    ...Type.caption,
    textAlign: "center",
    lineHeight: 20,
  },
});
