// components/table/textMetrics.generated.ts measures what the notices draw: every run a notice
// renders is a measured key, or runtime words under the bound noticeBox gives its role, in the face
// and case the run was measured in — and every measured entry is drawn.
import { describe, expect, it, jest } from '@jest/globals';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, render } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import type { TFn } from '@/lib/i18n';
import { TEXT_METRICS } from '@/components/table/textMetrics.generated';
import { NOTICES, NOTICE_FACES, type NoticeKind, type NoticeRole } from '@/components/table/noticeModel';
import { NOTICE_GALLERY, type NoticeFixture } from '@/components/table/notices/gallery';
import { HudComboPill, PileNote, TurnChip } from '@/components/table/notices/hud';
import { WhoStartsCard } from '@/components/table/notices/panels';
import { PassFloat } from '@/components/table/notices/floats';
import { EndMatchVote, RoundVote } from '@/components/table/notices/netNotes';
import { TableNotice } from '@/components/table/TableNotice';
import { BoardButton } from '@/components/table/matchBoard';
import { GameTable } from '@/components/GameTable';
import { linkNote, RECONNECT_CODES, tableConnection, type ConnectionNote } from '@/components/table/connectionNote';
import { exchangeNotes, type ExchangeView } from '@/components/table/exchangeModel';
import { comboLabel, playerLabel } from '@/components/table/noticeModel';
import { floatLabels, nextFloat } from '@/components/table/floatModel';
import { turnPresentation } from '@/components/turnTimerUi';
import { LINK_PILLS } from '@/lib/ownLink';
import { COMBO_NAME_KEYS } from '@/lib/comboName';
import {
  START_CARD,
  TURN_TIMEOUT_MS,
  createDeck,
  type Card,
  type Combination,
  type CombinationType,
  type GameState,
  type Player,
  type StartReason,
} from '@/lib/game/gameEngine';
import { CLOCK_DEMO_SECONDS } from '@/lib/tutorial/beats';
import { CLOCK_CEILING_MS } from '@/shared/clock';
import { SEATS_MAX } from '@/shared/seats';
import { Motion } from '@/lib/theme';
import { bootFeedback } from './helpers/feedback';
import { setMotion } from './harness/env';
import { aThreePlayed } from '../support/game';
import type { ExchangeAnnounceData } from '@/lib/game/sharedGameFlow';
import type { LegStage } from '@/lib/timeline/exchangeTimeline';

// whoStartsWords passes a NUL as the name and splits its sentence on it, so it is left bare.
function mockTag(key: string, params?: Record<string, string | number>): string {
  const args = Object.values(params ?? {}).map((v) => (String(v).includes('\u0000') ? String(v) : `⟨${v}⟩`));
  return `⟦${key}⟧${args.join('')}`;
}

jest.mock('@/lib/i18n', () => {
  const actual = jest.requireActual<typeof import('@/lib/i18n')>('@/lib/i18n');
  return {
    ...actual,
    useTranslation: () => ({
      ...actual.useTranslation(),
      t: mockTag,
      tn: (base: string, count: number, params?: Record<string, string | number>) => mockTag(`${base}#`, { count, ...params }),
      translateServerPayload: (p: { code?: string; params?: Record<string, string | number> }) => mockTag(`server.${p.code}`, p.params),
    }),
  };
});

// The renderer keeps only host elements, so each role component is wrapped in a host mark naming it.
jest.mock('@/components/table/TableNotice', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<Record<string, (props: Record<string, unknown>) => unknown>>('@/components/table/TableNotice');
  const mark = (name: string, mockMark: (p: Record<string, unknown>) => Record<string, unknown>) => {
    const Actual = actual[name] as never;
    return (props: Record<string, unknown>) => createElement('mock-mark', mockMark(props), createElement(Actual, props));
  };
  return {
    ...actual,
    TableNotice: mark('TableNotice', (p) => ({ notice: p.kind })),
    NoticeIcon: mark('NoticeIcon', () => ({ icon: true })),
    NoticeGlyph: mark('NoticeGlyph', () => ({ icon: true })),
    NoticeText: mark('NoticeText', (p) => ({ noticeRole: p.strong ? 'strong' : 'text' })),
    NoticeKey: mark('NoticeKey', () => ({ noticeRole: 'key' })),
    NoticeDisc: mark('NoticeDisc', (p) => ({ noticeRole: p.initial === undefined ? 'disc' : 'initial' })),
    NoticeName: mark('NoticeName', () => ({ noticeRole: 'name' })),
    NoticeTile: mark('NoticeTile', () => ({ noticeRole: 'tile' })),
    NoticeBadge: mark('NoticeBadge', () => ({ noticeRole: 'badge' })),
    NoticeLine: mark('NoticeLine', (p) => ({ noticeRole: p.line })),
  };
});

// A live region is spoken, never drawn.
jest.mock('@/lib/a11y', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('@/lib/a11y')>('@/lib/a11y');
  return { ...actual, A11yStatus: (props: never) => createElement('mock-mark', { spoken: true }, createElement(actual.A11yStatus, props)) };
});

// The board's own buttons, which a notice stands beside and which are not a notice's words.
jest.mock('@/components/table/matchBoard', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const actual = jest.requireActual<typeof import('@/components/table/matchBoard')>('@/components/table/matchBoard');
  return { ...actual, BoardButton: (props: never) => createElement('mock-mark', { control: true }, createElement(actual.BoardButton, props)) };
});

const t = mockTag as unknown as TFn;

type Measured = { face: string; upper: boolean; tabular: boolean };
type Bound = { chars: number } | { maxWidth: number; lines: number; on: 'run' | 'plate' };
const RUNS = TEXT_METRICS.runs.en as unknown as Record<string, Record<string, Measured>>;
const DYNAMIC = TEXT_METRICS.dynamic as unknown as Record<string, Record<string, Measured & { bound: Bound }>>;

const SPEC = new Set([
  ...Object.entries(RUNS).flatMap(([kind, runs]) => Object.keys(runs).map((rk) => `${kind}|${rk.replace(':', '|')}`)),
  ...Object.entries(DYNAMIC).flatMap(([kind, roles]) => Object.keys(roles).map((role) => `${kind}|${role}|*`)),
]);

const STYLE = new Map<string, Measured>();
for (const [kind, runs] of Object.entries(RUNS)) for (const [rk, run] of Object.entries(runs)) STYLE.set(`${kind}|${rk.split(':')[0]}`, run);
for (const [kind, roles] of Object.entries(DYNAMIC)) for (const [role, run] of Object.entries(roles)) STYLE.set(`${kind}|${role}`, run);

const ROLES = ['text', 'strong', 'key', 'disc', 'initial', 'name', 'tile', 'badge', 'main', 'sub', 'hint'] as const satisfies readonly NoticeRole[];
const everyRole: [Exclude<NoticeRole, (typeof ROLES)[number]>] extends [never] ? true : never = true;

const FACE_OF = new Map(Object.entries(NOTICE_FACES).map(([face, f]) => [f.fontFamily as string, face]));

const seen = () => ({ drawn: new Set<string>(), kindsSeen: new Set<string>(), rolesSeen: new Set<string>(), failures: [] as string[] });
const SEEN = seen();
const { drawn, kindsSeen, rolesSeen, failures } = SEEN;

type Style = { fontFamily?: string; textTransform?: string; fontVariant?: string[]; maxWidth?: number };
const flat = (node: TestInstance) => (StyleSheet.flatten(node.props.style) ?? {}) as Style;

/**
 * `words` false for a fixture whose words are placeholders the gallery passes in: only its faces count then.
 * `strict` false for a whole table, where most Text is not a notice's.
 */
async function collect(where: string, element: ReactElement, words = true) {
  const view = await render(element);
  scan(where, view.container, words, true);
  await view.unmount();
}

/** `spoken` and `control` mark words beside a notice, so they exempt only a Text no notice holds. */
function scan(where: string, container: TestInstance, words: boolean, strict: boolean, into = SEEN) {
  const { drawn, kindsSeen, rolesSeen, failures } = into;
  for (const host of container.queryAll((n) => n.type === 'Text')) {
    let role: NoticeRole | null = null;
    let notice: TestInstance | null = null;
    let icon = false;
    let beside = false;
    const style = { ...flat(host) };
    for (let up = host.parent; up && !notice; up = up.parent) {
      if (up.props.icon) icon = true;
      if (up.props.spoken || up.props.control) beside = true;
      if (role === null && up.props.noticeRole) role = up.props.noticeRole as NoticeRole;
      if (up.type === 'Text') for (const [k, v] of Object.entries(flat(up))) if (k !== 'maxWidth') style[k as keyof Style] ??= v as never;
      if (up.props.notice) notice = up;
    }
    if (icon) continue;
    if (!notice) {
      if (strict && !beside) failures.push(`${where}: draws a Text outside any TableNotice`);
      continue;
    }
    const kind = notice.props.notice as NoticeKind;
    const at = `${where} (${kind})`;
    kindsSeen.add(kind);
    if (role === null) {
      failures.push(`${at}: a Text sits under no role component`);
      continue;
    }
    rolesSeen.add(role);
    const want = STYLE.get(`${kind}|${role}`);
    const got = { face: FACE_OF.get(style.fontFamily ?? ''), upper: style.textTransform === 'uppercase', tabular: !!style.fontVariant?.includes('tabular-nums') };
    if (!want) failures.push(`${at}: draws a ${role} run the metrics never measured`);
    else if (got.face !== want.face || got.upper !== want.upper || got.tabular !== want.tabular)
      failures.push(`${at}: ${role} draws ${JSON.stringify(got)}, measured as ${JSON.stringify({ face: want.face, upper: want.upper, tabular: want.tabular })}`);
    if (!words) continue;
    const text = host.children.filter((c): c is string => typeof c === 'string').join('');
    for (const [, key] of text.matchAll(/⟦([^⟧]+)⟧/g)) {
      drawn.add(`${kind}|${role}|${key}`);
      if (!RUNS[kind]?.[`${role}:${key}`]) failures.push(`${at}: draws ${key} as ${role}, which is not measured there`);
    }
    const residue = text.replace(/⟦[^⟧]*⟧/g, '').replace(/⟨[^⟩]*⟩/g, '');
    if (residue === '') continue;
    if (want && !want.upper && /\p{L}.*\p{L}/u.test(residue) && !/\p{Ll}/u.test(residue))
      failures.push(`${at}: ${JSON.stringify(residue)} is cased in the string, for a ${role} run measured as drawn in its own case`);
    drawn.add(`${kind}|${role}|*`);
    const bound = DYNAMIC[kind]?.[role]?.bound;
    if (!bound) {
      failures.push(`${at}: draws runtime words ${JSON.stringify(residue)} as ${role}, with no bound`);
      continue;
    }
    const lines = host.props.numberOfLines as number | undefined;
    if ('chars' in bound) {
      if ([...residue].length > bound.chars) failures.push(`${at}: ${JSON.stringify(residue)} is over ${bound.chars} chars`);
    } else {
      const plate = notice.queryAll((n) => n.type === 'View' && flat(n).maxWidth !== undefined)[0];
      const width = bound.on === 'run' ? flat(host).maxWidth : plate && flat(plate).maxWidth;
      if (width !== bound.maxWidth || lines !== bound.lines)
        failures.push(`${at}: ${role} is clipped at ${width}×${lines} lines, bounded at ${bound.maxWidth}×${bound.lines}`);
    }
  }
}

const PLACEHOLDER_WORDS = new Set<NoticeKind>(['hudCombo', 'pileNote', 'turn', 'passFloat']);

const card = (rank: Card['rank'], suit: Card['suit']) => ({ id: `${rank}_${suit}`, rank, suit, isJoker: false }) as Card;
const player = (name: string) => ({ id: name, name, hand: [], type: 'human' }) as Player;
const PLAYERS = [player('Ana'), player('Besnik'), player('Gent')];

function exchanges() {
  const out: ReturnType<typeof exchangeNotes>[] = [];
  const stages: { receive: LegStage; give: LegStage; ready: boolean }[] = [
    { receive: 'rest', give: 'waiting', ready: false },
    { receive: 'landed', give: 'rest', ready: false },
    { receive: 'landed', give: 'landed', ready: true },
  ];
  for (const viewerSeat of [0, 1, 2])
    for (const shape of [{}, { oneWay: true }, { twoJokers: true }])
      for (const stage of stages) {
        const shown: ExchangeAnnounceData = {
          winnerName: 'Besnik',
          loserName: 'Ana',
          winnerIdx: 1,
          loserIdx: 0,
          twoJokers: false,
          oneWay: false,
          cardGiven: card('7', 'hearts'),
          cardReceived: card('2', 'spades'),
          ...shape,
        };
        const live: ExchangeView = {
          open: true,
          viewerIsWinner: viewerSeat === 1,
          viewerIsLoser: viewerSeat === 0,
          winner: PLAYERS[1]!,
          winnerSeat: 1,
          loser: PLAYERS[0]!,
          cardFromLoser: card('2', 'spades'),
        };
        out.push(exchangeNotes({ shown, stages: { key: 'k', ...stage }, live, players: PLAYERS, viewerSeat, spectating: false, t }));
      }
  return out;
}

const presented = (o: Partial<Parameters<typeof turnPresentation>[0]>) =>
  turnPresentation({
    roundOver: false,
    matchOver: false,
    dealing: false,
    shownTurnIsMine: false,
    onMoveName: 'Besnik',
    exchange: { chip: null, choiceOpen: false, viewerIsWinner: false, open: false, winnerSeat: null },
    shownTurnSeat: 1,
    isBot: () => false,
    isMyTurn: false,
    isFinished: false,
    isNewTrick: false,
    holdingForStart: false,
    held: false,
    turnToken: 'turn',
    t,
    ...o,
  }).chip.text;

const chip = (chipText: string, connection: ConnectionNote | null = null, active = false, seconds = 30) => (
  <TurnChip scale={1} lit={false} chipText={chipText} spokenSeat="" seconds={seconds} resetKey="r" frozen active={active} connection={connection} />
);

const START: StartReason = { type: 'start_card', card: card('7', 'hearts'), playerIdx: 1 };
const who = (reason: StartReason, starterIsViewer: boolean, gated: boolean, nothingBack?: { name: string; isViewer: boolean }) => (
  <WhoStartsCard gated={gated} scale={1} starterName="Besnik" starterIsViewer={starterIsViewer} reason={reason} nothingBack={nothingBack} />
);

async function renderEverything() {
  for (const [kind, fixtures] of Object.entries(NOTICE_GALLERY) as [NoticeKind, NoticeFixture[]][])
    for (const fixture of fixtures) await collect(`gallery ${kind}: ${fixture.name}`, fixture.render(1), !PLACEHOLDER_WORDS.has(kind));

  await collect('an empty table', <HudComboPill scale={1} play={null} />);
  for (const type of Object.keys(COMBO_NAME_KEYS) as CombinationType[])
    for (const [viewers, cards] of [[true, 1], [false, 3]] as const) {
      const combo = comboLabel({ type, cards: Array.from({ length: cards }, () => START_CARD) } as never, t)!;
      await collect(`a ${type} on the pile`, <HudComboPill scale={1} play={{ name: playerLabel(viewers, 'Besnik', t), combo }} />);
    }
  for (const [i, notes] of exchanges().entries()) {
    if (notes.pillNote) await collect(`exchange ${i}'s pill note`, <PileNote scale={1} note={notes.pillNote} />);
    if (notes.chip) await collect(`exchange ${i}'s chip`, chip(presented({ exchange: { chip: notes.chip, choiceOpen: true, viewerIsWinner: false, open: true, winnerSeat: 1 } })));
  }

  for (const [name, o] of [
    ['match over', { roundOver: true, matchOver: true }],
    ['round over', { roundOver: true }],
    ['dealing', { dealing: true }],
    ['your turn', { shownTurnIsMine: true, isMyTurn: true }],
    ['their turn', {}],
  ] as const)
    await collect(`the chip, ${name}`, chip(presented(o)));
  for (const [name, ms] of [
    ['the ceiling', CLOCK_CEILING_MS],
    ['an offline turn', TURN_TIMEOUT_MS],
    ["the tutorial's", CLOCK_DEMO_SECONDS * 1000],
  ] as const)
    await collect(`the clock at ${name}`, chip(presented({ shownTurnIsMine: true }), null, true, Math.ceil(ms / 1000)));
  const reconnects = RECONNECT_CODES.map((code) => ({ code, params: { username: 'Besnik' } }));
  for (const pill of LINK_PILLS)
    for (const reconnect of reconnects) {
      const note = tableConnection(linkNote(pill, reconnect, { t, translateServerPayload: (p) => mockTag(`server.${p.code}`, p.params), retry: () => {} }), false, t);
      await collect(`the link ${pill}`, chip('', note));
    }
  await collect('the device offline', chip('', tableConnection(null, true, t)));

  const passed = nextFloat(null, { viewerPassed: true, withdrawn: false }, floatLabels(t))!;
  const auto = nextFloat(passed, { autoPassed: true, withdrawn: false }, floatLabels(t))!;
  for (const float of [passed, auto]) await collect(`the ${float.kind} float`, <PassFloat scale={1} text={float.text} />);

  for (const rank of new Set(createDeck().filter((c) => c.suit !== null).map((c) => c.rank)))
    await collect(`a seat holds the ${rank}`, who({ type: 'start_card', card: card(rank, 'clubs'), playerIdx: 1 }, false, false));
  const full = { votes: SEATS_MAX, total: SEATS_MAX, onPress: () => {} };
  await collect('every seat voted to end', <EndMatchVote scale={1} voted={false} {...full} />);
  await collect('every seat is ready', <RoundVote scale={1} voted={false} {...full} />);

  for (const gated of [true, false]) {
    await collect('a seat holds a card', who(START, false, gated));
    await collect('you hold a card', who(START, true, gated));
    await collect('you hold the 3 of spades', who({ type: 'start_card', card: START_CARD, playerIdx: 0 }, true, gated));
    await collect('a seat lost the round', who({ type: 'lost_round', playerIdx: 1 }, false, gated));
    await collect('you lost the round', who({ type: 'lost_round', playerIdx: 0 }, true, gated));
    for (const isViewer of [true, false])
      await collect('a seat won with nothing back', who({ type: 'won_no_exchange', playerIdx: 1 }, isViewer, gated, { name: 'Besnik', isViewer }));
  }
}

const TABLE_METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 34, bottom: 0 } };
const KING: Card = card('K', 'hearts');
const LED: Combination = { type: 'single', cards: [KING], strength: 13 };
const tableAt = (over: Partial<GameState>): GameState => ({
  players: [player('Ana'), player('Besnik')],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: 1,
  passCount: 0,
  gameMode: 'free_for_all',
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: 'deal' },
  ...over,
});

/** The table names who played and who took the trick itself, so its own words are held to the metrics too. */
async function renderTables() {
  await setMotion('on');
  jest.useFakeTimers();
  await bootFeedback();
  for (const [name, gameState] of [
    ['you took the trick', tableAt({ lastPlayedBy: 0, currentTurnIndex: 0, lastMove: { seq: 2, kind: 'pass', seat: 1, closedTrick: true } })],
    ['another seat took the trick', tableAt({ lastPlayedBy: 1, lastMove: { seq: 2, kind: 'pass', seat: 0, closedTrick: true } })],
    ['your play on the pile', tableAt({ lastPlayedCombination: LED, lastPlayedBy: 0, currentTurnIndex: 1, lastMove: { seq: 1, kind: 'play', seat: 0 } })],
    ["another seat's play on the pile", tableAt({ lastPlayedCombination: LED, lastPlayedBy: 1, lastMove: { seq: 1, kind: 'play', seat: 1 } })],
  ] as const) {
    const view = await render(
      <SafeAreaProvider initialMetrics={TABLE_METRICS}>
        <GameTable gameState={gameState} viewerSeat={0} onPlay={() => {}} onPass={() => {}} onQuit={() => {}} onExchangeGive={() => {}} scrubbed />
      </SafeAreaProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(Motion.mark.enter + 16);
    });
    scan(`the table, ${name}`, view.container, true, false);
    await view.unmount();
  }
  jest.useRealTimers();
}

describe('the text metrics are what the notices draw', () => {
  it('every Text a notice draws is measured, in its face and case, and every measured entry is drawn', async () => {
    expect(everyRole).toBe(true);
    await renderEverything();
    await renderTables();
    expect(failures).toEqual([]);
    expect([...SPEC].filter((entry) => !drawn.has(entry)).sort()).toEqual([]);
    expect([...drawn].filter((entry) => !SPEC.has(entry)).sort()).toEqual([]);
    expect(Object.keys(NOTICES).filter((kind) => !kindsSeen.has(kind))).toEqual([]);
    expect(ROLES.filter((role) => !rolesSeen.has(role))).toEqual([]);
  });

  it('a control inside a notice is held to the notice', async () => {
    const caught = seen();
    const view = await render(
      <TableNotice kind="roundVote" tone="neutral" scale={1}>
        <BoardButton label="Unmeasured plate words" testID="planted" onPress={() => {}} live unit={1} />
      </TableNotice>,
    );
    scan('a board button on the vote plate', view.container, true, true, caught);
    await view.unmount();
    expect(caught.failures).toContain('a board button on the vote plate (roundVote): a Text sits under no role component');
  });
});
