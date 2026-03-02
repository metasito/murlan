import React, { useState, useEffect, useCallback } from "react";
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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/query-client";
import { getSocket } from "@/lib/socket";
import Colors from "@/constants/colors";

interface FriendInfo {
  id: string;
  username: string;
  friendCode: string;
  lastSeen: string | null;
}
interface FriendRequest { id: string; username: string; friendCode: string }

function italianRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return "Tempo fa";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Poco fa";
  if (mins < 60) return `${mins} min fa`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} or${hours === 1 ? "a" : "e"} fa`;
  const days = Math.floor(hours / 24);
  return `${days} giorn${days === 1 ? "o" : "i"} fa`;
}

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [addCode, setAddCode] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string>>({});

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: friends = [], isLoading: friendsLoading } = useQuery<FriendInfo[]>({
    queryKey: ["/api/friends"],
  });

  const { data: requests = [] } = useQuery<FriendRequest[]>({
    queryKey: ["/api/friends/requests"],
  });

  // Seed lastSeenMap from API response
  useEffect(() => {
    if (friends.length === 0) return;
    setLastSeenMap((prev) => {
      const next = { ...prev };
      friends.forEach((f) => {
        if (f.lastSeen && !next[f.id]) {
          next[f.id] = f.lastSeen;
        }
      });
      return next;
    });
  }, [friends]);

  // Socket listeners for real-time status
  useEffect(() => {
    if (!user) return;
    const socket = getSocket(user.id);

    const handleOnlineList = ({ onlineIds: ids }: { onlineIds: string[] }) => {
      setOnlineIds(new Set(ids));
    };

    const handleStatus = ({ userId, online, lastSeen }: { userId: string; online: boolean; lastSeen?: string }) => {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) {
          next.add(userId);
        } else {
          next.delete(userId);
          if (lastSeen) {
            setLastSeenMap((m) => ({ ...m, [userId]: lastSeen }));
          }
        }
        return next;
      });
    };

    const handleRequestIncoming = () => {
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    };

    const handleRequestAccepted = () => {
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    };

    socket.on("friend:online_list", handleOnlineList);
    socket.on("friend:status", handleStatus);
    socket.on("friend:request_incoming", handleRequestIncoming);
    socket.on("friend:request_accepted", handleRequestAccepted);

    // Request fresh online list when screen mounts
    socket.emit("friend:get_online_list");

    return () => {
      socket.off("friend:online_list", handleOnlineList);
      socket.off("friend:status", handleStatus);
      socket.off("friend:request_incoming", handleRequestIncoming);
      socket.off("friend:request_accepted", handleRequestAccepted);
    };
  }, [user?.id]);

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/friends/accept/${id}`);
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
      "Rimuovi amico",
      `Vuoi rimuovere ${friend.username} dagli amici?`,
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Rimuovi",
          style: "destructive",
          onPress: () => removeMutation.mutate(friend.id),
        },
      ]
    );
  }

  async function handleCopyCode() {
    if (!user?.friendCode) return;
    await Clipboard.setStringAsync(user.friendCode);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Copiato!", "Il tuo codice amico è stato copiato");
  }

  async function handleAddFriend() {
    if (!addCode.trim()) return;
    setAddLoading(true);
    try {
      const res = await apiRequest("POST", "/api/friends/add", { friendCode: addCode.trim().toUpperCase() });
      const data = await res.json();
      Alert.alert("Richiesta inviata", `Richiesta di amicizia inviata a ${data.username}`);
      setAddCode("");
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore";
      const match = msg.match(/\d+: (.+)/);
      try {
        const parsed = JSON.parse(match ? match[1] : msg);
        Alert.alert("Errore", parsed.message ?? msg);
      } catch {
        Alert.alert("Errore", match ? match[1] : msg);
      }
    } finally {
      setAddLoading(false);
    }
  }

  const renderFriendRow = useCallback(({ item }: { item: FriendInfo }) => {
    const isOnline = onlineIds.has(item.id);
    const seenAt = lastSeenMap[item.id] ?? item.lastSeen;
    return (
      <View style={styles.friendRow}>
        <View style={styles.avatarWrapper}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.username.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? "#4CAF50" : Colors.textMuted }]} />
        </View>
        <View style={styles.friendInfo}>
          <Text style={styles.friendName}>{item.username}</Text>
          <Text style={styles.friendStatus}>
            {isOnline ? "Online" : `Visto ${italianRelativeTime(seenAt)}`}
          </Text>
        </View>
        <Pressable
          onPress={() => handleRemoveFriend(item)}
          style={styles.removeBtn}
          hitSlop={8}
        >
          <Ionicons name="person-remove-outline" size={16} color={Colors.textMuted} />
        </Pressable>
      </View>
    );
  }, [onlineIds, lastSeenMap]);

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad + 16 }]}>
      <LinearGradient colors={[Colors.bg, Colors.bgCard]} style={StyleSheet.absoluteFill} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.screenTitle}>Amici</Text>
        <View style={{ width: 38 }} />
      </View>

      <FlatList
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad + 20 }]}
        ListHeaderComponent={
          <>
            <View style={styles.myCodeCard}>
              <Text style={styles.myCodeLabel}>IL TUO CODICE AMICO</Text>
              <Text style={styles.myCodeText}>{user?.friendCode ?? "—"}</Text>
              <Pressable onPress={handleCopyCode} style={styles.copyBtn}>
                <Ionicons name="copy-outline" size={15} color="#0A1F18" />
                <Text style={styles.copyBtnText}>Copia</Text>
              </Pressable>
            </View>

            <View style={styles.addSection}>
              <Text style={styles.addTitle}>AGGIUNGI AMICO</Text>
              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={addCode}
                  onChangeText={(v) => setAddCode(v.toUpperCase())}
                  placeholder="Codice amico"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="characters"
                  maxLength={8}
                />
                <Pressable
                  onPress={handleAddFriend}
                  disabled={addLoading || !addCode.trim()}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                >
                  {addLoading ? (
                    <ActivityIndicator color="#0A1F18" size="small" />
                  ) : (
                    <Ionicons name="person-add" size={18} color="#0A1F18" />
                  )}
                </Pressable>
              </View>
            </View>

            {requests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>RICHIESTE IN ATTESA ({requests.length})</Text>
                {requests.map((r) => (
                  <View key={r.id} style={styles.requestRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{r.username.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.friendName} numberOfLines={1}>{r.username}</Text>
                    <View style={styles.requestActions}>
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
                        <Ionicons name="checkmark" size={16} color="#0A1F18" />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>AMICI ({friends.length})</Text>
          </>
        }
        data={friends}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          friendsLoading ? (
            <ActivityIndicator color={Colors.gold} style={{ marginTop: 20 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.emptyText}>Nessun amico ancora.{"\n"}Condividi il tuo codice!</Text>
            </View>
          )
        }
        renderItem={renderFriendRow}
      />
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
  listContent: { padding: 20, gap: 16 },
  myCodeCard: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.goldDark,
    padding: 20,
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  myCodeLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, letterSpacing: 2 },
  myCodeText: { fontFamily: "Rajdhani_700Bold", fontSize: 32, color: Colors.gold, letterSpacing: 6 },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.gold,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  copyBtnText: { fontFamily: "Rajdhani_700Bold", fontSize: 14, color: "#0A1F18" },
  addSection: {
    backgroundColor: Colors.bgSurface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
    marginBottom: 8,
  },
  addTitle: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, letterSpacing: 2 },
  addRow: { flexDirection: "row", gap: 10 },
  addInput: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontFamily: "Rajdhani_700Bold",
    fontSize: 18,
    letterSpacing: 3,
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
  section: { gap: 8, marginBottom: 4 },
  sectionTitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 2,
    marginBottom: 4,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
  },
  requestActions: { flexDirection: "row", gap: 8 },
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
    backgroundColor: "#4CAF50",
    alignItems: "center",
    justifyContent: "center",
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
    marginBottom: 8,
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
  friendInfo: { flex: 1, gap: 2 },
  friendName: { fontFamily: "Inter_500Medium", fontSize: 14, color: Colors.text },
  friendStatus: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textMuted },
  removeBtn: {
    padding: 6,
  },
  empty: { alignItems: "center", paddingTop: 40, gap: 12 },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 22,
  },
});
