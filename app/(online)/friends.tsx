import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  Platform,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { useOnlineGame } from "@/context/OnlineGameContext";
import { apiRequest } from "@/lib/query-client";
import { Colors } from '@/lib/theme';
import { useTranslation, translateServerPayload } from "@/lib/i18n";
import type { TranslationKey, TranslationParams } from "@/lib/i18n";

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
      <Text style={styles.sectionTitle}>{title}</Text>
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
  const insets = useSafeAreaInsets();
  const { t, tn } = useTranslation();
  const { user } = useAuth();
  const { socket, onlineIds, gameInvites, dismissGameInvite } = useSocket();
  const { joinRoom, room } = useOnlineGame();
  const qc = useQueryClient();
  const [addLoading, setAddLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);

  const { width: W, height: H } = useWindowDimensions();
  const isLandscape = W > H;
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: friends = [], isLoading: friendsLoading } = useQuery<FriendInfo[]>({
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
    Alert.alert(
      t("friends.removeConfirmTitle"),
      t("friends.removeConfirmBody", { username: friend.username }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("friends.removeConfirmConfirm"),
          style: "destructive",
          onPress: () => removeMutation.mutate(friend.id),
        },
      ]
    );
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t("friends.requestSentTitle"), t("friends.requestSentBody", { username: data.username }));
      setSearchQuery("");
      setSearchResult(null);
      setSearchDone(false);
      qc.invalidateQueries({ queryKey: ["/api/friends/sent"] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("common.error");
      const match = msg.match(/\d+: (.+)/);
      try {
        const parsed = JSON.parse(match ? match[1] : msg);
        Alert.alert(t("common.error"), translateServerPayload(parsed) ?? msg);
      } catch {
        Alert.alert(t("common.error"), match ? match[1] : msg);
      }
    } finally {
      setAddLoading(false);
    }
  }

  const renderFriendRow = useCallback(({ item }: { item: FriendInfo }) => {
    const isOnline = onlineIds.has(item.id);
    return (
      <View style={styles.row}>
        <View style={styles.avatarWrapper}>
          <Avatar name={item.username} />
          <View style={[styles.statusDot, { backgroundColor: isOnline ? "Colors.success" : Colors.textMuted }]} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={styles.rowName}>{item.username}</Text>
          <Text style={[styles.rowSub, isOnline && { color: "Colors.success" }]}>
            {isOnline ? t("friends.online") : t("friends.seenAgo", { time: relativeTime(item.lastSeen, t, tn) })}
          </Text>
        </View>
        <Pressable
          onPress={() => handleRemoveFriend(item)}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <Ionicons name="person-remove-outline" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>
    );
  }, [onlineIds]);

  const onlineCount = friends.filter(f => onlineIds.has(f.id)).length;

  useEffect(() => {
    if (room) {
      router.push("/(online)/room");
    }
  }, [room?.roomId]);

  useFocusEffect(
    useCallback(() => {
      if (socket) socket.emit("friend:get_online_list");
    }, [socket])
  );

  function handleJoinGameInvite(roomCode: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dismissGameInvite(roomCode);
    joinRoom(roomCode);
  }

  return (
    <View style={[styles.container, {
      paddingTop: topPad,
      paddingBottom: bottomPad + 16,
      paddingLeft: isLandscape ? insets.left : 0,
      paddingRight: isLandscape ? insets.right : 0,
    }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.screenTitle}>{t("friends.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── SECTION 1: Amici ── */}
        <SectionHeader
          title={t("friends.sectionFriends")}
          count={friends.length > 0 ? friends.length : undefined}
        />
        {friends.length === 0 && !friendsLoading && (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t("friends.emptyFriends")}</Text>
          </View>
        )}
        {friendsLoading && <ActivityIndicator color={Colors.gold} style={{ marginVertical: 16 }} />}
        {friends.length > 0 && (
          <View style={styles.listBlock}>
            {friends.map(item => (
              <View key={item.id} style={styles.row}>
                <View style={styles.avatarWrapper}>
                  <Avatar name={item.username} />
                  <View style={[styles.statusDot, { backgroundColor: onlineIds.has(item.id) ? "Colors.success" : Colors.textMuted }]} />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{item.username}</Text>
                  <Text style={[styles.rowSub, onlineIds.has(item.id) && { color: "Colors.success" }]}>
                    {onlineIds.has(item.id) ? t("friends.online") : t("friends.seenAgo", { time: relativeTime(item.lastSeen, t, tn) })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRemoveFriend(item)}
                  style={styles.iconBtn}
                  hitSlop={8}
                >
                  <Ionicons name="person-remove-outline" size={16} color={Colors.textMuted} />
                </Pressable>
              </View>
            ))}
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
                    <View style={[styles.statusDot, { backgroundColor: "Colors.success" }]} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{invite.from}</Text>
                    <Text style={styles.rowSub}>{t("friends.roomLabel", { code: invite.roomCode })}</Text>
                  </View>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => dismissGameInvite(invite.roomCode)}
                      style={styles.declineBtn}
                    >
                      <Ionicons name="close" size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleJoinGameInvite(invite.roomCode)}
                      style={styles.joinBtn}
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
                    >
                      <Ionicons name="close" size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => acceptMutation.mutate(r.id)}
                      style={styles.acceptBtn}
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
                    hitSlop={8}
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
              accessibilityHint={t("friends.searchA11yHint")}
            />
            <Pressable
              onPress={handleSearchUsername}
              disabled={searchLoading || !searchQuery.trim()}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }, (!searchQuery.trim()) && styles.addBtnDim]}
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { padding: 8 },
  screenTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: "Rajdhani_700Bold",
    fontSize: 20,
    color: Colors.text,
    letterSpacing: 3,
  },
  scrollContent: { padding: 16, gap: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
  },
  badge: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 11,
    color: Colors.textSecondary,
  },

  listBlock: { gap: 8 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
  },
  avatarWrapper: { position: "relative" },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
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
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.bgSurface,
  },
  avatarText: { fontFamily: "Rajdhani_700Bold", fontSize: 18, color: Colors.gold },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.text },
  rowSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },

  iconBtn: { padding: 6 },

  actionRow: { flexDirection: "row", gap: 8 },
  declineBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "Colors.success",
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtn: {
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.gold,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  joinBtnText: {
    fontFamily: "Rajdhani_700Bold",
    fontSize: 14,
    color: Colors.bgCard,
  },

  inputCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  inputCardLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 1.5,
  },
  inputRow: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  addBtn: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.gold,
    borderRadius: 10,
  },
  addBtnDim: {
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  searchResultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: 10,
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
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.textMuted,
  },

  empty: { alignItems: "center", paddingVertical: 28, gap: 10 },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
});
