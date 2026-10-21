import React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Colors } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";
import { modeLabel } from "@/lib/modeLabel";
import { firstTargetFor, type GameMode, type MatchLength } from "@/lib/game/gameEngine";

const SEAT_COUNTS = [2, 3, 4] as const;
const MODES: readonly GameMode[] = ["free_for_all", "teams"];
/** Full match first: it is the canonical Murlan match (docs/GAME-RULES.md §12). */
const MATCH_LENGTHS: readonly MatchLength[] = ["match", "single"];
const MODE_ICON = 16;
const MODE_ICON_COMPACT = 14;

export function ModeIcon({ mode, size, color }: { mode: GameMode; size: number; color: string }) {
  return <Ionicons name={mode === "teams" ? "people" : "person"} size={size} color={color} {...a11yHidden()} />;
}

export function SeatCountPicker({
  value,
  onChange,
  compact = false,
}: {
  value: number;
  onChange: (count: number) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceChips
      choices={SEAT_COUNTS.map((n) => ({
        value: n,
        label: String(n),
        a11yLabel: t("lobby.playerCountOptionA11yLabel", { n }),
      }))}
      value={value}
      onChange={onChange}
      weight="digit"
      compact={compact}
    />
  );
}

export function ModePicker({
  value,
  onChange,
  compact = false,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceChips
      choices={MODES.map((mode) => ({
        value: mode,
        label: modeLabel(mode, t, compact ? "short" : "full"),
        icon: (active: boolean) => (
          <ModeIcon
            mode={mode}
            size={compact ? MODE_ICON_COMPACT : MODE_ICON}
            color={active ? Colors.gold : Colors.textSecondary}
          />
        ),
      }))}
      value={value}
      onChange={onChange}
      weight={compact ? "caption" : "label"}
      compact={compact}
    />
  );
}

export function MatchLengthPicker({
  value,
  onChange,
  seats,
}: {
  value: MatchLength;
  onChange: (length: MatchLength) => void;
  seats: number;
}) {
  const { t } = useTranslation();
  const copy = (length: MatchLength) =>
    length === "match"
      ? { title: t("lobby.formatMatch"), detail: t("lobby.formatMatchSub", { target: firstTargetFor(seats) }) }
      : { title: t("lobby.formatSingle"), detail: t("lobby.formatSingleSub") };
  return (
    <ChoiceChips
      choices={MATCH_LENGTHS.map((length) => {
        const { title, detail } = copy(length);
        return {
          value: length,
          label: title,
          detail,
          a11yLabel: t("lobby.formatA11yLabel", { format: title, detail }),
        };
      })}
      value={value}
      onChange={onChange}
      weight="title"
    />
  );
}
