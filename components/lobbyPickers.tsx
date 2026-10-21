import React from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Colors } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { a11yHidden } from "@/lib/a11y";
import { modeLabel } from "@/lib/modeLabel";
import { TEAMS_PLAYER_COUNT, firstTargetFor, modeFits, type GameMode, type MatchLength } from "@/lib/game/gameEngine";

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
  mode,
  compact = false,
}: {
  value: number;
  onChange: (count: number) => void;
  mode: GameMode;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceChips
      choices={SEAT_COUNTS.map((n) => {
        const seats = t("lobby.playerCountOptionA11yLabel", { n });
        const fits = modeFits(mode, n);
        return {
          value: n,
          label: String(n),
          a11yLabel: fits
            ? seats
            : t("lobby.seatsNeedModeA11yLabel", { seats, mode: modeLabel(mode, t), n: TEAMS_PLAYER_COUNT }),
          disabled: !fits,
        };
      })}
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
  seats,
  form = "full",
  compact = false,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
  seats: number;
  form?: "full" | "short";
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceChips
      choices={MODES.map((mode) => {
        const label = modeLabel(mode, t, form);
        const fits = modeFits(mode, seats);
        return {
          value: mode,
          label,
          a11yLabel: fits ? label : t("lobby.modeNeedsSeatsA11yLabel", { mode: label, n: TEAMS_PLAYER_COUNT }),
          disabled: !fits,
          icon: (active: boolean) => (
            <ModeIcon
              mode={mode}
              size={compact ? MODE_ICON_COMPACT : MODE_ICON}
              color={active ? Colors.gold : Colors.textSecondary}
            />
          ),
        };
      })}
      value={value}
      onChange={onChange}
      weight={compact ? "caption" : "label"}
      compact={compact}
      lines={form === "full" ? 2 : 1}
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
