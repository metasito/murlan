import { cueFor, type CueSound, type HapticHelper, type Moment } from "./cues.ts";
import * as haptics from "./haptics.ts";
import * as sounds from "./sounds.ts";

const SOUNDS: Record<CueSound, () => unknown> = {
  select: () => sounds.playCardSelect(),
  deselect: () => sounds.playCardDeselect(),
  play: () => sounds.playCardPlay(),
  combo: () => sounds.playCombo(),
  pass: () => sounds.playCardPass(),
  bomb: () => sounds.playBomb(),
  deal: () => sounds.playDeal(),
  exchange: () => sounds.playExchange(),
  turn: () => sounds.playTurn(),
  clockRunningOut: () => sounds.playClockRunningOut(),
  mancheWon: () => sounds.playMancheWon(),
  mancheLost: () => sounds.playMancheLost(),
  partitaWon: () => sounds.playPartitaWon(),
  partitaLost: () => sounds.playPartitaLost(),
  reconnected: () => sounds.playReconnected(),
  reject: () => sounds.playReject(),
};

const HAPTICS: Record<HapticHelper, () => unknown> = {
  hapticSelection: () => haptics.hapticSelection(),
  hapticLight: () => haptics.hapticLight(),
  hapticMedium: () => haptics.hapticMedium(),
  hapticHeavy: () => haptics.hapticHeavy(),
  hapticRigid: () => haptics.hapticRigid(),
  hapticSuccess: () => haptics.hapticSuccess(),
  hapticWarn: () => haptics.hapticWarn(),
};

/**
 * Fires a moment's sound and haptics, and returns what cancels the ones still
 * pending. A haptic scheduled before the sound's onset delays the sound by that
 * lead, so the sound starts late rather than the haptic early.
 */
export function playCue(moment: Moment): () => void {
  const { sound, haptics: pulses } = cueFor(moment);
  const lead = Math.max(0, ...pulses.map((p) => -p.atMs));
  const timers: ReturnType<typeof setTimeout>[] = [];
  const at = (ms: number, fire: () => unknown) => {
    if (ms <= 0) fire();
    else timers.push(setTimeout(fire, ms));
  };
  at(lead, SOUNDS[sound]);
  for (const p of pulses) at(lead + p.atMs, HAPTICS[p.helper]);
  return () => timers.forEach(clearTimeout);
}
