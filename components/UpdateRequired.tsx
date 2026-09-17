import React from "react";
import { StyleSheet, View } from "react-native";
import { reloadAppAsync } from "expo";
import { AppModal } from "@/components/AppModal";
import { ErrorBlock } from "@/components/StateBlock";
import { Colors } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { useUpdateRequired } from "@/lib/updateRequired";

export function UpdateRequired() {
  const required = useUpdateRequired();
  const { t } = useTranslation();
  if (!required) return null;
  return (
    <AppModal onRequestClose={() => {}} accessibilityLabel={t("updateRequired.title")}>
      <View style={styles.backdrop}>
        <ErrorBlock
          title={t("updateRequired.title")}
          body={t("updateRequired.body")}
          retry={{
            label: t("updateRequired.reload"),
            a11yLabel: t("updateRequired.reload"),
            onPress: () => void reloadAppAsync().catch(() => {}),
          }}
        />
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", backgroundColor: Colors.bg },
});
