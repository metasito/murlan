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
import { useOnlineGame } from "@/context/OnlineGameContext";
import { useNotification } from "@/context/NotificationContext";
import { apiRequest } from "@/lib/query-client";
import { Colors, Spacing, FontSize, Radius, TOUCH_TARGET_MIN, Type } from '@/lib/theme';
import { MenuButton } from "@/components/MenuButton";
import { MenuLayout } from "@/components/MenuLayout";
import { ConfirmDialog, type ConfirmRequest } from "@/components/ConfirmDialog";
import { useTranslation, translateServerPayload } from "@/lib/i18n";
import { registerForPush } from "@/lib/pushRegistration";
import type { TranslationKey, TranslationParams } from "@/lib/i18n";
import { a11yState, useA11yHint } from "@/lib/a11y";

type TFn = (key: TranslationKey, params?: TranslationParams) => string;
type TnFn = (base: string, count: number, params?: TranslationParams) => string;

interface FriendInfo {
  id: string;
  username: string;
  lastSeen: string | null;
}
interface FriendRequest { id: string; username: string }
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
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </View>
  );
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
  const { joinRoom, room } = useOnlineGame();
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
      const msg = e instanceof Error ? e.message : t("common.error");
      const match = msg.match(/\d+: (.+)/);
      try {
        const parsed = JSON.parse(match ? match[1] : msg);
        setSearchError(translateServerPayload(parsed) ?? t("friends.userNotFound"));
      } catch {
        setSearchError(t("friends.userNotFound"));
      }
      setSearchDone(true);
    } finally {
      setSearchLoading(false);
    }
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
      const msg = e instanceof Error ? e.message : t("common.error");
      const match = msg.match(/\d+: (.+)/);
      try {
        const parsed = JSON.parse(match ? match[1] : msg);
        showError(translateServerPayload(parsed) ?? msg);
      } catch {
        showError(match ? match[1] : msg);
      }
    } finally {
      setAddLoading(false);
    }
  }

  useEffect(() => {
    if (room) {
      router.push("/(online)/room");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate once per room id, not on every room field update
  }, [room?.roomId]);

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
          <Ionicons name="chevron-back" size={22} color={Colors.gold} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("friends.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.contentWrapper}>
        {/* ── SECTION 1: Amici ── */}
        <SectionHeader
          title={t("friends.sectionFriends")}
          count={friends.length > 0 ? friends.length : undefined}
        />
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
              return (
                <View key={item.id} style={styles.row} accessible accessibilityLabel={`${item.username}. ${statusText}`}>
                  <View style={styles.avatarWrapper}>
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
                    <Ionicons name="person-remove-outline" size={16} color={Colors.textMuted} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* ── SECTION 2: Inviti a Giocare ── */}
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
                      <Ionicons name="close" size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleJoinGameInvite(invite.roomCode)}
                      style={styles.joinBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.joinInviteA11yLabel", { username: invite.from })}
                    >
                      <Text style={styles.joinBtnText}>{t("friends.join")}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── SECTION 3: Richieste Ricevute ── */}
        {requests.length > 0 && (
          <>
            <SectionHeader title={t("friends.sectionReceivedRequests")} count={requests.length} />
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
                      <Ionicons name="close" size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => acceptMutation.mutate(r.id)}
                      style={styles.acceptBtn}
                      accessibilityRole="button"
                      accessibilityLabel={t("friends.acceptRequestA11yLabel", { username: r.username })}
                      hitSlop={8}
                    >
                      <Ionicons name="checkmark" size={16} color={Colors.bgCard} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── SECTION 3: Richieste Inviate ── */}
        {sentRequests.length > 0 && (
          <>
            <SectionHeader title={t("friends.sectionSentRequests")} count={sentRequests.length} />
            <View style={styles.listBlock}>
              {sentRequests.map(r => (
                <View key={r.id} style={styles.row}>
                  <Avatar name={r.username} />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{r.username}</Text>
                    <Text style={styles.rowSub}>{t("friends.awaitingResponse")}</Text>
                  </View>
                  <Pressable
                    onPress={() => cancelMutation.mutate(r.id)}
                    style={styles.iconBtn}
                    accessibilityRole="button"
                    accessibilityLabel={t("friends.cancelRequestA11yLabel", { username: r.username })}
                    hitSlop={12}
                  >
                    <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── SECTION 4: Aggiungi Amico ── */}
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
                <Ionicons name="search" size={18} color={(!searchQuery.trim()) ? Colors.textMuted : Colors.bgCard} />
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
                  <Ionicons name="person-add" size={16} color={Colors.bgCard} />
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
      </View>

      <ConfirmDialog request={confirming} onClose={() => setConfirming(null)} />
    </MenuLayout>
  );
}

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
    width: 44,
    height: 44,
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
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    ...Type.label,
    fontSize: FontSize.xs,
    letterSpacing: 2,
  },
  badge: {
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },

  listBlock: { gap: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
    minHeight: 44,
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
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...Type.bodyStrong },
  rowSub: { ...Type.caption },

  iconBtn: { width: TOUCH_TARGET_MIN, height: TOUCH_TARGET_MIN, alignItems: "center", justifyContent: "center" },

  actionRow: { flexDirection: "row", gap: 8 },
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
    minHeight: 44,
    borderRadius: Radius.sm,
    backgroundColor: Colors.gold,
    paddingHorizontal: 14,
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
    padding: 16,
    gap: 10,
  },
  inputCardLabel: {
    ...Type.caption,
    letterSpacing: 1.5,
  },
  inputRow: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: FontSize.md,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  addBtn: {
    width: 48,
    minHeight: 44,
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
    width: 36,
    height: 36,
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
    padding: 10,
    gap: 10,
  },
  searchErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchErrorText: {
    ...Type.caption,
  },

  empty: { alignItems: "center", paddingVertical: 28, gap: 10 },
  emptyText: {
    ...Type.caption,
    textAlign: "center",
    lineHeight: 20,
  },
});
