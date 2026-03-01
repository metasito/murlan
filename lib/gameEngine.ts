export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type JokerType = "colored" | "bw";

export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "joker_bw"
  | "joker_colored";

export interface Card {
  id: string;
  suit: Suit | null;
  rank: Rank;
  isJoker: boolean;
}

export type CombinationType = "single" | "pair" | "triple" | "straight";

export interface Combination {
  type: CombinationType;
  cards: Card[];
  strength: number;
}

export type GameMode = "free_for_all" | "teams";
export type PlayerType = "human" | "ai";
export type AIDifficulty = "easy" | "medium" | "hard";

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  type: PlayerType;
  difficulty?: AIDifficulty;
  team?: "A" | "B";
  finishPosition?: number;
}

export interface GameState {
  players: Player[];
  currentTurnIndex: number;
  lastPlayedCombination: Combination | null;
  lastPlayedBy: number;
  passCount: number;
  gameMode: GameMode;
  roundWinner: number | null;
  gameOver: boolean;
  rankings: string[];
}

const RANK_ORDER: Rank[] = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
  "joker_bw",
  "joker_colored",
];

export function getRankStrength(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

export function cardStrength(card: Card): number {
  return getRankStrength(card.rank);
}

export function createDeck(): Card[] {
  const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks: Rank[] = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];
  const cards: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      cards.push({
        id: `${rank}_${suit}`,
        suit,
        rank,
        isJoker: false,
      });
    }
  }

  cards.push({ id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true });
  cards.push({
    id: "joker_colored",
    suit: null,
    rank: "joker_colored",
    isJoker: true,
  });

  return cards;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(
  playerCount: number
): { hands: Card[][]; excluded: Card[] } {
  const deck = shuffleDeck(createDeck());
  const cardsPerPlayer: { [key: number]: number } = {
    2: 26,
    3: 17,
    4: 13,
  };

  const count = cardsPerPlayer[playerCount] ?? 13;
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);

  for (let i = 0; i < count * playerCount; i++) {
    hands[i % playerCount].push(deck[i]);
  }

  const excluded = deck.slice(count * playerCount);
  return { hands, excluded };
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const strengthDiff = cardStrength(a) - cardStrength(b);
    if (strengthDiff !== 0) return strengthDiff;
    const suitOrder: (Suit | null)[] = [
      "clubs",
      "diamonds",
      "hearts",
      "spades",
      null,
    ];
    return (
      (suitOrder.indexOf(a.suit) ?? 0) - (suitOrder.indexOf(b.suit) ?? 0)
    );
  });
}

export function findStartingPlayer(players: Player[]): number {
  for (let i = 0; i < players.length; i++) {
    const has3Hearts = players[i].hand.some(
      (c) => c.rank === "3" && c.suit === "hearts"
    );
    if (has3Hearts) return i;
  }
  return 0;
}

export function getCombinationType(
  cards: Card[]
): CombinationType | null {
  if (cards.length === 0) return null;

  if (cards.length === 1) return "single";

  const jokers = cards.filter((c) => c.isJoker);
  const nonJokers = cards.filter((c) => !c.isJoker);

  if (cards.length === 2) {
    if (jokers.length === 2) return "pair";
    if (jokers.length === 1 && nonJokers.length === 1) return "pair";
    if (nonJokers.length === 2 && nonJokers[0].rank === nonJokers[1].rank)
      return "pair";
    return null;
  }

  if (cards.length === 3) {
    if (jokers.length >= 1) {
      const nonJokerRanks = new Set(nonJokers.map((c) => c.rank));
      if (nonJokerRanks.size <= 1) return "triple";
      if (nonJokers.length === 3) {
        return isStraight(cards) ? "straight" : null;
      }
      return "straight";
    }
    if (nonJokers.every((c) => c.rank === nonJokers[0].rank)) return "triple";
    if (isStraight(cards)) return "straight";
    return null;
  }

  if (cards.length >= 3) {
    if (isStraight(cards)) return "straight";
    return null;
  }

  return null;
}

function isStraight(cards: Card[]): boolean {
  const jokers = cards.filter((c) => c.isJoker);
  const nonJokers = cards.filter((c) => !c.isJoker);

  if (nonJokers.some((c) => c.rank === "2")) return false;

  const strengths = nonJokers.map((c) => getRankStrength(c.rank)).sort((a, b) => a - b);

  if (strengths.length < 2) return jokers.length >= cards.length - 1;

  const min = strengths[0];
  const max = strengths[strengths.length - 1];
  const range = max - min;

  if (range >= cards.length) return false;

  const uniqueStrengths = new Set(strengths);
  if (uniqueStrengths.size !== strengths.length) return false;

  const gaps = range - (strengths.length - 1);
  return gaps <= jokers.length;
}

export function getCombinationStrength(combination: Combination): number {
  const cards = combination.cards;
  switch (combination.type) {
    case "single":
      return cardStrength(cards[0]);
    case "pair":
      const nonJokerPair = cards.filter((c) => !c.isJoker);
      if (nonJokerPair.length > 0)
        return cardStrength(nonJokerPair[nonJokerPair.length - 1]);
      return cardStrength(cards[0]);
    case "triple":
      const nonJokerTriple = cards.filter((c) => !c.isJoker);
      if (nonJokerTriple.length > 0)
        return cardStrength(nonJokerTriple[0]);
      return cardStrength(cards[0]);
    case "straight":
      const nonJokerStraight = cards
        .filter((c) => !c.isJoker)
        .sort((a, b) => cardStrength(b) - cardStrength(a));
      if (nonJokerStraight.length > 0)
        return cardStrength(nonJokerStraight[0]);
      return 0;
  }
}

export function buildCombination(cards: Card[]): Combination | null {
  const type = getCombinationType(cards);
  if (!type) return null;
  const combo: Combination = { type, cards, strength: 0 };
  combo.strength = getCombinationStrength(combo);
  return combo;
}

export function canPlay(
  candidate: Combination,
  lastPlayed: Combination | null
): boolean {
  if (!lastPlayed) return true;
  if (candidate.type !== lastPlayed.type) return false;
  if (candidate.cards.length !== lastPlayed.cards.length) return false;
  return candidate.strength > lastPlayed.strength;
}

export function getValidCombinations(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewRound: boolean
): Combination[] {
  const results: Combination[] = [];
  const sorted = sortHand(hand);

  for (let i = 0; i < sorted.length; i++) {
    const single = buildCombination([sorted[i]]);
    if (single && canPlay(single, isNewRound ? null : lastPlayed)) {
      results.push(single);
    }

    for (let j = i + 1; j < sorted.length; j++) {
      const pair = buildCombination([sorted[i], sorted[j]]);
      if (pair && canPlay(pair, isNewRound ? null : lastPlayed)) {
        results.push(pair);
      }

      for (let k = j + 1; k < sorted.length; k++) {
        const triple = buildCombination([sorted[i], sorted[j], sorted[k]]);
        if (triple && canPlay(triple, isNewRound ? null : lastPlayed)) {
          results.push(triple);
        }

        for (let l = k + 1; l < sorted.length; l++) {
          for (let len = 4; len <= sorted.length - i; len++) {
            const subset = sorted.slice(i, i + len);
            const straight = buildCombination(subset);
            if (
              straight &&
              straight.type === "straight" &&
              canPlay(straight, isNewRound ? null : lastPlayed)
            ) {
              results.push(straight);
            }
          }
          break;
        }
      }
    }
  }

  return results;
}

function getAllValidPlays(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewRound: boolean
): Combination[] {
  const plays: Combination[] = [];
  const n = hand.length;

  for (let mask = 1; mask < (1 << Math.min(n, 15)); mask++) {
    const selected: Card[] = [];
    for (let bit = 0; bit < Math.min(n, 15); bit++) {
      if (mask & (1 << bit)) selected.push(hand[bit]);
    }
    const combo = buildCombination(selected);
    if (combo && canPlay(combo, isNewRound ? null : lastPlayed)) {
      plays.push(combo);
    }
  }

  if (n > 15) {
    const remaining = hand.slice(15);
    for (let len = 3; len <= remaining.length; len++) {
      for (let start = 0; start <= remaining.length - len; start++) {
        const subset = remaining.slice(start, start + len);
        const combo = buildCombination(subset);
        if (combo && canPlay(combo, isNewRound ? null : lastPlayed)) {
          plays.push(combo);
        }
      }
    }
  }

  return plays;
}

export function aiChoosePlay(
  player: Player,
  lastPlayed: Combination | null,
  isNewRound: boolean,
  otherPlayersHandCount: number[]
): Combination | null {
  const plays = getAllValidPlays(player.hand, lastPlayed, isNewRound);
  if (plays.length === 0) return null;

  const diff = player.difficulty ?? "medium";

  if (diff === "easy") {
    return plays[0];
  }

  if (diff === "medium") {
    const sorted = plays.sort((a, b) => a.strength - b.strength);
    return sorted[0];
  }

  if (diff === "hard") {
    const minOpponentCards = Math.min(...otherPlayersHandCount);
    const myCards = player.hand.length;

    const jokerPlays = plays.filter((p) =>
      p.cards.some((c) => c.isJoker)
    );
    const noJokerPlays = plays.filter((p) =>
      !p.cards.some((c) => c.isJoker)
    );
    const has2Plays = plays.filter((p) =>
      p.cards.some((c) => c.rank === "2")
    );

    if (minOpponentCards <= 3 && myCards > 3) {
      if (jokerPlays.length > 0)
        return jokerPlays.sort((a, b) => b.strength - a.strength)[0];
      if (has2Plays.length > 0)
        return has2Plays.sort((a, b) => b.strength - a.strength)[0];
    }

    const conservative = noJokerPlays
      .filter((p) => !p.cards.some((c) => c.rank === "2"))
      .sort((a, b) => a.strength - b.strength);

    if (conservative.length > 0) return conservative[0];
    return plays.sort((a, b) => a.strength - b.strength)[0];
  }

  return plays[0];
}

export function processPlay(
  state: GameState,
  combination: Combination
): GameState {
  const newState = deepCloneState(state);
  const player = newState.players[newState.currentTurnIndex];

  combination.cards.forEach((playedCard) => {
    player.hand = player.hand.filter((c) => c.id !== playedCard.id);
  });

  newState.lastPlayedCombination = combination;
  newState.lastPlayedBy = newState.currentTurnIndex;
  newState.passCount = 0;

  if (player.hand.length === 0) {
    const position = newState.rankings.length + 1;
    player.finishPosition = position;
    newState.rankings.push(player.id);

    const activePlayers = newState.players.filter(
      (p) => p.hand.length > 0
    );

    if (newState.gameMode === "teams") {
      const winnerTeam = player.team;
      const teammateDone = newState.players.some(
        (p) => p.team === winnerTeam && p.finishPosition !== undefined && p.id !== player.id
      );
      if (teammateDone || newState.players.filter(p => p.hand.length > 0 && p.team !== winnerTeam).length === 0) {
        newState.gameOver = true;
        return newState;
      }
    }

    if (activePlayers.length <= 1) {
      if (activePlayers.length === 1) {
        activePlayers[0].finishPosition = newState.rankings.length + 1;
        newState.rankings.push(activePlayers[0].id);
      }
      newState.gameOver = true;
      return newState;
    }
  }

  newState.currentTurnIndex = getNextActivePlayer(newState);
  return newState;
}

export function processPass(state: GameState): GameState {
  const newState = deepCloneState(state);
  newState.passCount += 1;

  const activePlayers = newState.players.filter((p) => p.hand.length > 0);
  const activeCount = activePlayers.length;

  if (newState.passCount >= activeCount - 1) {
    newState.lastPlayedCombination = null;
    newState.passCount = 0;
    newState.roundWinner = newState.lastPlayedBy;

    const lastWinner = newState.players[newState.lastPlayedBy];
    if (lastWinner && lastWinner.hand.length > 0) {
      newState.currentTurnIndex = newState.lastPlayedBy;
    } else {
      newState.currentTurnIndex = getNextActivePlayer({
        ...newState,
        currentTurnIndex: newState.lastPlayedBy,
      });
    }
  } else {
    newState.roundWinner = null;
    newState.currentTurnIndex = getNextActivePlayer(newState);
  }

  return newState;
}

function getNextActivePlayer(state: GameState): number {
  const total = state.players.length;
  let next = (state.currentTurnIndex + 1) % total;
  let attempts = 0;
  while (state.players[next].hand.length === 0 && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  return next;
}

export function deepCloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

export function canPlayerPlay(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewRound: boolean
): boolean {
  return getAllValidPlays(hand, lastPlayed, isNewRound).length > 0;
}

export function getCardDisplayRank(rank: Rank): string {
  if (rank === "joker_colored") return "JKR";
  if (rank === "joker_bw") return "JKR";
  return rank;
}

export function getSuitSymbol(suit: Suit | null): string {
  if (!suit) return "";
  const symbols: Record<Suit, string> = {
    hearts: "♥",
    diamonds: "♦",
    clubs: "♣",
    spades: "♠",
  };
  return symbols[suit];
}

export function isRedSuit(suit: Suit | null): boolean {
  return suit === "hearts" || suit === "diamonds";
}

export function initializeGame(
  playerSetup: Array<{
    name: string;
    type: PlayerType;
    difficulty?: AIDifficulty;
    team?: "A" | "B";
  }>,
  gameMode: GameMode
): GameState {
  const { hands } = dealCards(playerSetup.length);

  const players: Player[] = playerSetup.map((setup, i) => ({
    id: `player_${i}`,
    name: setup.name,
    hand: sortHand(hands[i]),
    type: setup.type,
    difficulty: setup.difficulty,
    team: setup.team,
    finishPosition: undefined,
  }));

  const state: GameState = {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
  };

  state.currentTurnIndex = findStartingPlayer(players);
  state.lastPlayedBy = state.currentTurnIndex;

  return state;
}
