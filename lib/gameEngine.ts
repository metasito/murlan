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

export type CombinationType =
  | "single"
  | "pair"
  | "triple"
  | "straight"
  | "bomb"
  | "royal_straight";

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

export interface ExchangePhase {
  active: boolean;
  winnerIdx: number;
  loserIdx: number;
  cardFromLoser: Card;
  bothJokersException: boolean;
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
  firstPlayMade: boolean;
  exchangePhase?: ExchangePhase;
}

const RANK_ORDER: Rank[] = [
  "3", "4", "5", "6", "7", "8", "9", "10",
  "J", "Q", "K", "A", "2", "joker_bw", "joker_colored",
];

export function getRankStrength(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

export function cardStrength(card: Card): number {
  return getRankStrength(card.rank);
}

function getStraightFaceValue(rank: Rank, aceAsHigh: boolean): number | null {
  if (rank === "joker_bw" || rank === "joker_colored") return null;
  if (rank === "A") return aceAsHigh ? 14 : 1;
  const map: Partial<Record<Rank, number>> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
    "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13,
  };
  return map[rank] ?? null;
}

function isConsecutiveSequence(
  faceValues: number[],
  jokerCount: number,
  totalLen: number
): boolean {
  if (faceValues.length === 0) return jokerCount >= totalLen;
  const sorted = [...faceValues].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  if (unique.length !== sorted.length) return false;
  const range = unique[unique.length - 1] - unique[0];
  if (range >= totalLen) return false;
  const gapsInRange = range - (unique.length - 1);
  return gapsInRange <= jokerCount;
}

function isStraight(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  // Jokers cannot be used in straights — only as single cards
  if (cards.some((c) => c.isJoker)) return false;
  const nonJokers = cards;

  for (const aceAsHigh of [false, true]) {
    const faceValues = nonJokers
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (isConsecutiveSequence(faceValues, 0, cards.length))
      return true;
  }
  return false;
}

function getStraightStrength(cards: Card[]): number {
  // No jokers allowed in straights
  if (cards.some((c) => c.isJoker)) return 0;
  const nonJokers = cards;

  for (const aceAsHigh of [true, false]) {
    const faceValues = nonJokers
      .map((c) => getStraightFaceValue(c.rank, aceAsHigh))
      .filter((v): v is number => v !== null);
    if (!isConsecutiveSequence(faceValues, 0, cards.length))
      continue;

    if (faceValues.length === 0) return 0;
    const sorted = [...faceValues].sort((a, b) => a - b);
    return sorted[sorted.length - 1];
  }
  return 0;
}

function isBomb(cards: Card[]): boolean {
  if (cards.length !== 4) return false;
  if (cards.some((c) => c.isJoker)) return false;
  const rank = cards[0].rank;
  return cards.every((c) => c.rank === rank);
}

function isRoyalStraight(cards: Card[]): boolean {
  if (cards.length < 5) return false;
  // Jokers not allowed in straights or royal straights
  if (cards.some((c) => c.isJoker)) return false;
  const suit = cards[0].suit;
  if (!suit) return false;
  return cards.every((c) => c.suit === suit) && isStraight(cards);
}

export function createDeck(): Card[] {
  const suits: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
  const ranks: Rank[] = [
    "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
  ];
  const cards: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      cards.push({ id: `${rank}_${suit}`, suit, rank, isJoker: false });
    }
  }
  cards.push({ id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true });
  cards.push({ id: "joker_colored", suit: null, rank: "joker_colored", isJoker: true });
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

export function dealCards(playerCount: number): { hands: Card[][]; excluded: Card[] } {
  const deck = shuffleDeck(createDeck());
  const cardsPerPlayer: Record<number, number> = { 2: 26, 3: 17, 4: 13 };
  const count = cardsPerPlayer[playerCount] ?? 13;
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < count * playerCount; i++) {
    hands[i % playerCount].push(deck[i]);
  }
  return { hands, excluded: deck.slice(count * playerCount) };
}

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const diff = cardStrength(a) - cardStrength(b);
    if (diff !== 0) return diff;
    const suitOrder: (Suit | null)[] = ["clubs", "diamonds", "hearts", "spades", null];
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });
}

export function findStartingPlayer(players: Player[]): number {
  for (let i = 0; i < players.length; i++) {
    if (players[i].hand.some((c) => c.rank === "3" && c.suit === "spades"))
      return i;
  }
  return 0;
}

export function getCombinationType(cards: Card[]): CombinationType | null {
  if (cards.length === 0) return null;

  if (isBomb(cards)) return "bomb";

  // Jokers can ONLY be played as single cards — never in multi-card combos
  if (cards.length === 1) return "single";

  if (cards.some((c) => c.isJoker)) return null;

  const nonJokers = cards;

  if (cards.length === 2) {
    if (nonJokers[0].rank === nonJokers[1].rank) return "pair";
    return null;
  }

  if (cards.length === 3) {
    const nonJokerRanks = new Set(nonJokers.map((c) => c.rank));
    if (nonJokerRanks.size === 1) return "triple";
    return null;
  }

  if (cards.length === 4) {
    return null;
  }

  if (isRoyalStraight(cards)) return "royal_straight";
  if (isStraight(cards)) return "straight";
  return null;
}

export function getCombinationStrength(combination: Combination): number {
  const cards = combination.cards;
  switch (combination.type) {
    case "single":
      return cardStrength(cards[0]);
    case "pair": {
      const nonJoker = cards.filter((c) => !c.isJoker);
      return nonJoker.length > 0
        ? cardStrength(nonJoker[nonJoker.length - 1])
        : cardStrength(cards[0]);
    }
    case "triple": {
      const nonJoker = cards.filter((c) => !c.isJoker);
      return nonJoker.length > 0 ? cardStrength(nonJoker[0]) : cardStrength(cards[0]);
    }
    case "straight":
    case "royal_straight":
      return getStraightStrength(cards);
    case "bomb":
      return cardStrength(cards[0]);
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

  if (candidate.type === "royal_straight") {
    if (lastPlayed.type === "royal_straight") {
      return (
        candidate.cards.length === lastPlayed.cards.length &&
        candidate.strength > lastPlayed.strength
      );
    }
    return true;
  }

  if (candidate.type === "bomb") {
    if (lastPlayed.type === "royal_straight") return false;
    if (lastPlayed.type === "bomb") return candidate.strength > lastPlayed.strength;
    return true;
  }

  if (lastPlayed.type === "bomb" || lastPlayed.type === "royal_straight") return false;

  if (candidate.type !== lastPlayed.type) return false;
  if (candidate.cards.length !== lastPlayed.cards.length) return false;
  return candidate.strength > lastPlayed.strength;
}

// ─── Complete, correct valid-play enumeration ─────────────────────────────────
// Handles any hand size by enumerating by combination structure,
// not bitmask (bitmask fails for 2-player hands of 26 cards).

function getAllValidPlays(
  hand: Card[],
  lastPlayed: Combination | null,
  isNewRound: boolean,
  requireCard?: Card
): Combination[] {
  const plays: Combination[] = [];
  const seen = new Set<string>();

  function tryAdd(selected: Card[]): void {
    if (!selected.length) return;
    if (requireCard && !selected.some((c) => c.id === requireCard.id)) return;
    const key = selected
      .map((c) => c.id)
      .sort()
      .join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const combo = buildCombination(selected);
    if (combo && canPlay(combo, isNewRound ? null : lastPlayed)) plays.push(combo);
  }

  const jokers = hand.filter((c) => c.isJoker);
  const nj = hand.filter((c) => !c.isJoker);

  const byRank = new Map<string, Card[]>();
  for (const c of nj) {
    const g = byRank.get(c.rank) ?? [];
    g.push(c);
    byRank.set(c.rank, g);
  }

  // Singles
  for (const c of hand) tryAdd([c]);

  // Pairs (natural only — no jokers in pairs)
  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        tryAdd([group[i], group[j]]);
  }

  // Triples (natural only — no jokers in triples)
  for (const group of byRank.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        for (let k = j + 1; k < group.length; k++)
          tryAdd([group[i], group[j], group[k]]);
  }

  // Bombs (4 natural same rank — no jokers)
  for (const group of byRank.values()) {
    if (group.length >= 4) tryAdd(group.slice(0, 4));
  }

  // Straights (5+ consecutive non-joker cards only)
  function enumStraights(sorted: Card[]): void {
    for (let lo = 0; lo < sorted.length; lo++) {
      for (let hi = lo + 4; hi < sorted.length && hi - lo <= 8; hi++) {
        const window = sorted.slice(lo, hi + 1);
        tryAdd(window);
      }
    }
  }

  const njSortedLow = [...nj].sort((a, b) => {
    const va = getStraightFaceValue(a.rank, false) ?? 0;
    const vb = getStraightFaceValue(b.rank, false) ?? 0;
    return va - vb;
  });
  const njSortedHigh = [...nj].sort((a, b) => {
    const va = getStraightFaceValue(a.rank, true) ?? 0;
    const vb = getStraightFaceValue(b.rank, true) ?? 0;
    return va - vb;
  });
  enumStraights(njSortedLow);
  enumStraights(njSortedHigh);

  return plays;
}

// ─── AI ────────────────────────────────────────────────────────────────────────

function scorePlayForDump(play: Combination): number {
  const cardCount = play.cards.length;
  const hasHighCards = play.cards.some((c) => c.rank === "2" || c.isJoker);
  const avgStrength = play.strength / Math.max(cardCount, 1);
  return cardCount * 3 - avgStrength * 0.3 - (hasHighCards ? 5 : 0);
}

export function aiChoosePlay(
  player: Player,
  lastPlayed: Combination | null,
  isNewRound: boolean,
  otherPlayersHandCount: number[],
  requireCard?: Card
): Combination | null {
  const plays = getAllValidPlays(player.hand, lastPlayed, isNewRound, requireCard);
  if (plays.length === 0) return null;

  const diff = player.difficulty ?? "medium";
  const myCards = player.hand.length;
  const minOpponent = Math.min(...otherPlayersHandCount);

  // Universal: if this play empties the hand, always do it
  const finishingPlays = plays.filter((p) => p.cards.length === myCards);
  if (finishingPlays.length > 0) {
    return finishingPlays.sort((a, b) => b.cards.length - a.cards.length)[0];
  }

  if (diff === "easy") {
    return plays.sort((a, b) => a.strength - b.strength)[0];
  }

  const bombs = plays.filter(
    (p) => p.type === "bomb" || p.type === "royal_straight"
  );
  const normal = plays.filter(
    (p) => p.type !== "bomb" && p.type !== "royal_straight"
  );

  if (diff === "medium") {
    // Prefer lowest normal play; save bombs
    const pool = normal.length > 0 ? normal : bombs;
    // Slightly prefer multi-card plays when hand is large
    if (isNewRound && myCards > 8 && normal.length > 0) {
      const multi = normal.filter((p) => p.cards.length >= 2);
      if (multi.length > 0)
        return multi.sort((a, b) => b.cards.length - a.cards.length || a.strength - b.strength)[0];
    }
    return pool.sort((a, b) => a.strength - b.strength)[0];
  }

  // ── Hard AI ──────────────────────────────────────────────────────────────
  const conservative = normal.filter(
    (p) => !p.cards.some((c) => c.rank === "2" || c.isJoker)
  );
  const withHighCards = normal.filter((p) =>
    p.cards.some((c) => c.rank === "2" || c.isJoker)
  );

  // Emergency: opponent about to finish — use lowest bomb immediately
  if (minOpponent <= 1 && !isNewRound && bombs.length > 0) {
    return bombs.sort((a, b) => a.strength - b.strength)[0];
  }

  if (isNewRound) {
    // We control the round: dump as many weak cards as efficiently as possible
    const near3 = plays.filter((p) => p.cards.length >= myCards - 2);
    if (near3.length > 0)
      return near3.sort((a, b) => b.cards.length - a.cards.length)[0];

    // Prefer combos that score high on dump value (many cards, low strength)
    const candidates = conservative.length > 0 ? conservative : normal.length > 0 ? normal : bombs;
    if (candidates.length > 0)
      return candidates.sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0];

    return plays.sort((a, b) => scorePlayForDump(b) - scorePlayForDump(a))[0];
  }

  // Responding to opponent's combo
  // If near finishing, be aggressive
  if (myCards <= 4 && normal.length > 0) {
    return normal.sort((a, b) => a.strength - b.strength)[0];
  }

  // Prefer beating with lowest conservative card (preserve 2s/jokers)
  if (conservative.length > 0) {
    return conservative.sort((a, b) => a.strength - b.strength)[0];
  }

  // Use high cards only if hand is small or opponent is close to winning
  if ((myCards <= 6 || minOpponent <= 3) && withHighCards.length > 0) {
    return withHighCards.sort((a, b) => a.strength - b.strength)[0];
  }

  // Use bomb when opponent is close to winning and we have no normal play
  if (minOpponent <= 3 && bombs.length > 0) {
    return bombs.sort((a, b) => a.strength - b.strength)[0];
  }

  // Pass (return null) — let the low-strength combo win this round
  return null;
}

// ─── Game state processing ────────────────────────────────────────────────────

export function processPlay(state: GameState, combination: Combination): GameState {
  const newState = deepCloneState(state);
  const player = newState.players[newState.currentTurnIndex];

  combination.cards.forEach((played) => {
    player.hand = player.hand.filter((c) => c.id !== played.id);
  });

  newState.lastPlayedCombination = combination;
  newState.lastPlayedBy = newState.currentTurnIndex;
  newState.passCount = 0;
  newState.firstPlayMade = true;

  if (player.hand.length === 0) {
    const position = newState.rankings.length + 1;
    player.finishPosition = position;
    newState.rankings.push(player.id);

    const activePlayers = newState.players.filter((p) => p.hand.length > 0);

    if (newState.gameMode === "teams") {
      const winnerTeam = player.team;
      const teammateDone = newState.players.some(
        (p) =>
          p.team === winnerTeam &&
          p.finishPosition !== undefined &&
          p.id !== player.id
      );
      if (
        teammateDone ||
        newState.players.filter(
          (p) => p.hand.length > 0 && p.team !== winnerTeam
        ).length === 0
      ) {
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
  let next = (state.currentTurnIndex - 1 + total) % total;
  let attempts = 0;
  while (state.players[next].hand.length === 0 && attempts < total) {
    next = (next - 1 + total) % total;
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

const EXCHANGE_VALID_RANKS: Rank[] = ["3","4","5","6","7","8","9","10"];

export function initializeRematch(
  playerSetup: Array<{
    name: string;
    type: PlayerType;
    difficulty?: AIDifficulty;
    team?: "A" | "B";
    id?: string;
  }>,
  gameMode: GameMode,
  prevRankings: string[]
): GameState {
  const { hands } = dealCards(playerSetup.length);

  const players: Player[] = playerSetup.map((setup, i) => ({
    id: setup.id ?? `player_${i}`,
    name: setup.name,
    hand: sortHand(hands[i]),
    type: setup.type,
    difficulty: setup.difficulty,
    team: setup.team,
    finishPosition: undefined,
  }));

  const winnerId = prevRankings[0];
  const loserId = prevRankings[prevRankings.length - 1];
  const winnerIdx = players.findIndex((p) => p.id === winnerId);
  const loserIdx = players.findIndex((p) => p.id === loserId);

  const safeWinnerIdx = winnerIdx >= 0 ? winnerIdx : 0;
  const safeLoserIdx = loserIdx >= 0 ? loserIdx : players.length - 1;

  const loserHand = players[safeLoserIdx].hand;
  const hasColoredJoker = loserHand.some((c) => c.rank === "joker_colored");
  const hasBwJoker = loserHand.some((c) => c.rank === "joker_bw");
  const bothJokersException = hasColoredJoker && hasBwJoker;

  if (bothJokersException) {
    return {
      players,
      currentTurnIndex: safeWinnerIdx,
      lastPlayedCombination: null,
      lastPlayedBy: safeWinnerIdx,
      passCount: 0,
      gameMode,
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      exchangePhase: {
        active: false,
        winnerIdx: safeWinnerIdx,
        loserIdx: safeLoserIdx,
        cardFromLoser: loserHand[0],
        bothJokersException: true,
      },
    };
  }

  const sortedLoserHand = [...loserHand].sort((a, b) => cardStrength(b) - cardStrength(a));
  const cardFromLoser = sortedLoserHand[0];

  players[safeLoserIdx].hand = players[safeLoserIdx].hand.filter((c) => c.id !== cardFromLoser.id);
  players[safeWinnerIdx].hand = sortHand([...players[safeWinnerIdx].hand, cardFromLoser]);

  return {
    players,
    currentTurnIndex: safeWinnerIdx,
    lastPlayedCombination: null,
    lastPlayedBy: safeWinnerIdx,
    passCount: 0,
    gameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: true,
    exchangePhase: {
      active: true,
      winnerIdx: safeWinnerIdx,
      loserIdx: safeLoserIdx,
      cardFromLoser,
      bothJokersException: false,
    },
  };
}

export function processExchangeChoice(state: GameState, cardId: string): GameState {
  if (!state.exchangePhase?.active) return state;
  const { winnerIdx, loserIdx } = state.exchangePhase;
  const newState = deepCloneState(state);
  const winnerHand = newState.players[winnerIdx].hand;
  const cardIdx = winnerHand.findIndex((c) => c.id === cardId);
  if (cardIdx < 0) return state;
  const card = winnerHand[cardIdx];
  if (!EXCHANGE_VALID_RANKS.includes(card.rank)) return state;

  newState.players[winnerIdx].hand = winnerHand.filter((_, i) => i !== cardIdx);
  newState.players[loserIdx].hand = sortHand([...newState.players[loserIdx].hand, card]);
  newState.currentTurnIndex = loserIdx;
  newState.lastPlayedBy = loserIdx;
  newState.exchangePhase!.active = false;
  return newState;
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

  const startIdx = findStartingPlayer(players);

  return {
    players,
    currentTurnIndex: startIdx,
    lastPlayedCombination: null,
    lastPlayedBy: startIdx,
    passCount: 0,
    gameMode,
    roundWinner: null,
    gameOver: false,
    rankings: [],
    firstPlayMade: false,
  };
}
