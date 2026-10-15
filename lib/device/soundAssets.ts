export const SOUND_FILES = {
  select: () => require("../../assets/sounds/select.mp3") as number,
  play: () => require("../../assets/sounds/play.mp3") as number,
  combo: () => require("../../assets/sounds/combo.mp3") as number,
  pass: () => require("../../assets/sounds/pass.mp3") as number,
  bomb: () => require("../../assets/sounds/bomb.mp3") as number,
  deal: () => require("../../assets/sounds/deal.mp3") as number,
  exchange: () => require("../../assets/sounds/exchange.mp3") as number,
  turn: () => require("../../assets/sounds/turn.mp3") as number,
  clock_running_out: () => require("../../assets/sounds/clock_running_out.mp3") as number,
  round_won: () => require("../../assets/sounds/round_won.mp3") as number,
  round_lost: () => require("../../assets/sounds/round_lost.mp3") as number,
  round_neutral: () => require("../../assets/sounds/round_neutral.mp3") as number,
  match_won: () => require("../../assets/sounds/match_won.mp3") as number,
  match_lost: () => require("../../assets/sounds/match_lost.mp3") as number,
  trick_start: () => require("../../assets/sounds/trick_start.mp3") as number,
  trick_win: () => require("../../assets/sounds/trick_win.mp3") as number,
  reject: () => require("../../assets/sounds/reject.mp3") as number,
  seat_fill: () => require("../../assets/sounds/seat_fill.mp3") as number,
  room_full: () => require("../../assets/sounds/room_full.mp3") as number,
  reconnected: () => require("../../assets/sounds/reconnected.mp3") as number,
} as const;

export type SoundFile = keyof typeof SOUND_FILES;

export interface SoundSpec {
  file: SoundFile;
  gain: number;
  rate?: number;
  vary?: true;
}

const SPECS = {
  select: { file: "select", gain: 1, vary: true },
  deselect: { file: "select", gain: 0.75, rate: 0.9 },
  play: { file: "play", gain: 1, vary: true },
  combo: { file: "combo", gain: 1, vary: true },
  pass: { file: "pass", gain: 1, vary: true },
  deal: { file: "deal", gain: 1, vary: true },
  reject: { file: "reject", gain: 0.7, vary: true },
  bomb: { file: "bomb", gain: 1 },
  exchange: { file: "exchange", gain: 1 },
  turn: { file: "turn", gain: 1 },
  clockRunningOut: { file: "clock_running_out", gain: 1 },
  roundWon: { file: "round_won", gain: 1 },
  roundLost: { file: "round_lost", gain: 1 },
  roundNeutral: { file: "round_neutral", gain: 1 },
  matchWon: { file: "match_won", gain: 1 },
  matchLost: { file: "match_lost", gain: 1 },
  trick_start: { file: "trick_start", gain: 0.85 },
  trick_win: { file: "trick_win", gain: 1 },
  seat_fill: { file: "seat_fill", gain: 0.8 },
  room_full: { file: "room_full", gain: 0.85 },
  reconnected: { file: "reconnected", gain: 1 },
} as const satisfies Record<string, SoundSpec>;

export type SoundId = keyof typeof SPECS;
export const SOUNDS: Record<SoundId, SoundSpec> = SPECS;
