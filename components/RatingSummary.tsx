import React from "react";
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Colors, FontSize, Spacing, Type } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yGroup, a11yHidden } from "@/lib/a11y";
import { formatSeason, provisionalLeft } from "@/lib/game/rating";
import type { RatingDto } from "@/shared/http";

export function RatingSummary({ rating, style }: { rating: RatingDto; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const season = t("ladder.seasonLabel", { season: formatSeason(rating.season, t) });
  const left = provisionalLeft(rating);
  const rounds =
    left === undefined ? t("ladder.roundsLabel", { n: rating.rounds }) : t("ladder.provisional", { n: left });
  return (
    <View
      style={[styles.block, style]}
      {...a11yGroup(`${t("ladder.ratingLabel")}: ${rating.rating}. ${season}. ${rounds}`)}
    >
      <Text style={styles.value} {...a11yHidden()}>{rating.rating}</Text>
      <Text style={styles.season} {...a11yHidden()}>{season}</Text>
      <Text style={styles.rounds} {...a11yHidden()}>{rounds}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", gap: Spacing.xxs, paddingBottom: Spacing.md },
  value: { fontFamily: "Rajdhani_700Bold", fontSize: FontSize.hero, color: Colors.gold },
  season: { ...Type.label },
  rounds: { ...Type.caption, textAlign: "center" },
});
