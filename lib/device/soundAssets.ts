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
  manche_won: () => require("../../assets/sounds/manche_won.mp3") as number,
  manche_lost: () => require("../../assets/sounds/manche_lost.mp3") as number,
  manche_neutral: () => require("../../assets/sounds/manche_neutral.mp3") as number,
  partita_won: () => require("../../assets/sounds/partita_won.mp3") as number,
  partita_lost: () => require("../../assets/sounds/partita_lost.mp3") as number,
  round_start: () => require("../../assets/sounds/round_start.mp3") as number,
  round_win: () => require("../../assets/sounds/round_win.mp3") as number,
  reject: () => require("../../assets/sounds/reject.mp3") as number,
  seat_fill: () => require("../../assets/sounds/seat_fill.mp3") as number,
  room_full: () => require("../../assets/sounds/room_full.mp3") as number,
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
  mancheWon: { file: "manche_won", gain: 1 },
  mancheLost: { file: "manche_lost", gain: 1 },
  mancheNeutral: { file: "manche_neutral", gain: 1 },
  partitaWon: { file: "partita_won", gain: 1 },
  partitaLost: { file: "partita_lost", gain: 1 },
  round_start: { file: "round_start", gain: 0.85 },
  round_win: { file: "round_win", gain: 1 },
  seat_fill: { file: "seat_fill", gain: 0.8 },
  room_full: { file: "room_full", gain: 0.85 },
} as const satisfies Record<string, SoundSpec>;

export type SoundId = keyof typeof SPECS;
export const SOUNDS: Record<SoundId, SoundSpec> = SPECS;
