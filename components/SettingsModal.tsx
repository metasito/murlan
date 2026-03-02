import React from "react";
import {
  Modal,
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { queryClient } from "@/lib/query-client";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function SettingsModal({ visible, onClose }: Props) {
  const { soundsEnabled, hapticsEnabled, setSoundsEnabled, setHapticsEnabled } =
    useSettings();
  const { logout } = useAuth();
  const router = useRouter();

  async function handleDeleteAccount() {
    try {
      const url = new URL("/api/users/me", getApiUrl());
      await fetch(url.toString(), { method: "DELETE", credentials: "include" });
      queryClient.clear();
      onClose();
      logout();
      router.replace("/auth");
    } catch {
      Alert.alert("Errore", "Eliminazione fallita. Riprova.");
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Elimina account",
      "Tutti i dati, amici e partite verranno eliminati. Irreversibile.",
      [
        { text: "Annulla", style: "cancel" },
        { text: "Elimina", style: "destructive", onPress: handleDeleteAccount },
      ]
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card}>
          <Text style={styles.title}>Impostazioni</Text>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.icon}>🔊</Text>
              <View>
                <Text style={styles.label}>Suoni</Text>
                <Text style={styles.sublabel}>Effetti sonori di gioco</Text>
              </View>
            </View>
            <Switch
              value={soundsEnabled}
              onValueChange={setSoundsEnabled}
              trackColor={{ false: "#333", true: "#C9A84C" }}
              thumbColor={soundsEnabled ? "#fff" : "#888"}
              accessibilityLabel="Attiva o disattiva i suoni"
            />
          </View>

          {Platform.OS !== "web" && (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.icon}>📳</Text>
                <View>
                  <Text style={styles.label}>Vibrazione</Text>
                  <Text style={styles.sublabel}>Feedback aptico</Text>
                </View>
              </View>
              <Switch
                value={hapticsEnabled}
                onValueChange={setHapticsEnabled}
                trackColor={{ false: "#333", true: "#C9A84C" }}
                thumbColor={hapticsEnabled ? "#fff" : "#888"}
                accessibilityLabel="Attiva o disattiva la vibrazione"
              />
            </View>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Chiudi</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteBtnText}>Elimina account</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    backgroundColor: "#0B3B25",
    borderRadius: 20,
    padding: 24,
    width: 300,
    borderWidth: 1,
    borderColor: "#C9A84C44",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" } as any)
      : {
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 20,
        }),
  },
  title: {
    color: "#C9A84C",
    fontFamily: "Rajdhani_700Bold",
    fontSize: 22,
    marginBottom: 20,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#ffffff11",
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { fontSize: 22, width: 32, textAlign: "center" },
  label: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  sublabel: { color: "#aaa", fontFamily: "Inter_400Regular", fontSize: 12 },
  closeBtn: {
    marginTop: 20,
    backgroundColor: "#C9A84C",
    borderRadius: 24,
    paddingVertical: 10,
    alignItems: "center",
  },
  closeBtnText: {
    color: "#031008",
    fontFamily: "Rajdhani_700Bold",
    fontSize: 16,
  },
  deleteBtn: { marginTop: 8, alignItems: "center", paddingVertical: 8 },
  deleteBtnText: {
    color: "#ff4444",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
});
