import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBeats,
  evaluateExchange,
  evaluatePlay,
  playEnabled,
  stagedLine,
  type ExchangeBeat,
  type PlayBeat,
} from "../../lib/tutorial/beats.ts";
import { resumeIndex } from "../../lib/tutorial/progress.ts";
import { getAllValidPlays } from "../../lib/game/gameEngine.ts";
import type { TFn } from "../../lib/i18n.ts";

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as TFn;

const beats = buildBeats(t);
const playBeat = (id: string) => beats.find((b): b is PlayBeat => b.kind === "play" && b.id === id)!;
const pick = (beat: PlayBeat, ...ids: string[]) => {
  for (const id of ids) assert.ok(beat.handCards.some((c) => c.id === id), `${id} is in the hand`);
  return new Set(ids);
};

const answers: { id: string; accepted: string[]; refused: string[]; message: string }[] = [
  { id: "open", accepted: ["3_spades"], refused: ["4_diamonds"], message: "tutorial.errMustIncludeCard" },
  { id: "respond", accepted: ["9_clubs"], refused: ["5_hearts"], message: "tutorial.errTooWeak" },
  { id: "pair", accepted: ["8_hearts", "8_diamonds"], refused: ["5_clubs", "4_clubs"], message: "tutorial.errNotAValidCombo" },
  { id: "stage", accepted: ["9_diamonds", "9_spades"], refused: ["6_hearts", "6_clubs"], message: "tutorial.errTooWeak" },
  { id: "triple", accepted: ["J_clubs", "J_diamonds", "J_hearts"], refused: ["J_clubs", "J_diamonds"], message: "tutorial.errWrongExpectedType" },
  { id: "straight", accepted: ["5_spades", "6_diamonds", "7_clubs", "8_clubs", "9_diamonds"], refused: ["2_clubs"], message: "tutorial.errWrongExpectedType" },
  { id: "bomb", accepted: ["K_spades", "K_hearts", "K_diamonds", "K_clubs"], refused: ["A_clubs"], message: "tutorial.errSameType" },
  { id: "royal", accepted: ["8_spades", "9_spades", "10_spades", "J_spades", "Q_spades"], refused: ["Q_spades", "Q_hearts"], message: "tutorial.errOnlyHigherBomb" },
];

describe("tutorial play beats", () => {
  for (const { id, accepted, refused, message } of answers) {
    const beat = playBeat(id);
    it(`${id} accepts its answer`, () => {
      const result = evaluatePlay(pick(beat, ...accepted), beat, t);
      assert.deepEqual(result, { ok: true, message: beat.successNarrative });
    });
    it(`${id} refuses a wrong answer`, () => {
      const result = evaluatePlay(pick(beat, ...refused), beat, t);
      assert.equal(result.ok, false);
      assert.equal(result.message.replace(/ \{.*$/, ""), message);
    });
  }

  it("every play beat but pass is covered above", () => {
    const covered = new Set([...answers.map((a) => a.id), "pass"]);
    for (const b of beats) if (b.kind === "play") assert.ok(covered.has(b.id), b.id);
  });

  it("pass has no play to make, and refuses each card", () => {
    const beat = playBeat("pass");
    assert.equal(beat.passes, true);
    assert.equal(getAllValidPlays(beat.handCards, beat.demand).length, 0);
    for (const card of beat.handCards) {
      assert.equal(evaluatePlay(new Set([card.id]), beat, t).ok, false);
    }
  });

  it("a start card with a card that makes no combination is refused as such", () => {
    const beat = playBeat("open");
    assert.equal(evaluatePlay(pick(beat, "3_spades", "4_diamonds"), beat, t).message, "tutorial.errNotAValidCombo");
  });

  it("an empty selection is refused", () => {
    assert.deepEqual(evaluatePlay(new Set(), playBeat("open"), t), { ok: false, message: "tutorial.errSelectAtLeastOne" });
  });

  it("only the opening beat demands a card", () => {
    const demands = beats.filter((b): b is PlayBeat => b.kind === "play").filter((b) => b.demand.mustInclude);
    assert.deepEqual(demands.map((b) => b.id), ["open"]);
  });
});

describe("tutorial exchange beat", () => {
  const beat = beats.find((b): b is ExchangeBeat => b.kind === "exchange")!;

  it("accepts a card the winner may give back", () => {
    assert.deepEqual(evaluateExchange(new Set(["5_diamonds"]), beat, t), { ok: true, message: beat.successNarrative });
  });

  it("refuses the card just received", () => {
    assert.deepEqual(evaluateExchange(new Set(["joker_colored"]), beat, t), { ok: false, message: "tutorial.errJustReceived" });
  });

  it("refuses a card above the giveback range", () => {
    assert.deepEqual(evaluateExchange(new Set(["K_clubs"]), beat, t), { ok: false, message: "tutorial.errExchangeRange" });
  });

  it("asks for a card when none is picked", () => {
    assert.deepEqual(evaluateExchange(new Set(), beat, t), { ok: false, message: "tutorial.errSelectCardToReturn" });
  });

  it("falls back to the generic refusal when the engine refuses a card the range allows", () => {
    const stuck: ExchangeBeat = { ...beat, state: { ...beat.state, roundOver: true } };
    assert.deepEqual(evaluateExchange(new Set(["5_diamonds"]), stuck, t), { ok: false, message: "tutorial.errExchangeGeneric" });
  });
});

describe("tutorial staging line and play button", () => {
  const stage = playBeat("stage");
  const line = (ids: string[], done = false, beat = stage) => stagedLine(beat, new Set(ids), done, t);

  it("is silent with nothing picked, once the beat is done, and on a beat that does not stage", () => {
    assert.equal(line([]), null);
    assert.equal(line(["9_diamonds", "9_spades"], true), null);
    assert.equal(stagedLine(playBeat("pair"), new Set(["8_hearts", "8_diamonds"]), false, t), null);
  });

  it("says a legal pick would go", () => {
    assert.equal(line(["9_diamonds", "9_spades"]), "tutorial.stagedReady");
  });

  it("says why an illegal pick would not", () => {
    const text = line(["6_hearts", "6_clubs"])!;
    assert.ok(text.startsWith("tutorial.stagedBlocked"), text);
    assert.ok(text.includes("gameTable.playA11ySpokenTooLow"), text);
  });

  it("enables the play button for a pick, and on a staged beat only for a playable one", () => {
    assert.equal(playEnabled(stage, new Set()), false);
    assert.equal(playEnabled(stage, new Set(["6_hearts", "6_clubs"])), false);
    assert.equal(playEnabled(stage, new Set(["9_diamonds", "9_spades"])), true);
    assert.equal(playEnabled(playBeat("pair"), new Set(["5_clubs"])), true);
  });
});

describe("tutorial resume", () => {
  const ids = ["welcome", "open", "respond"];
  it("resumes at the saved beat", () => assert.equal(resumeIndex(ids, "respond"), 2));
  it("starts at the top without a saved beat", () => assert.equal(resumeIndex(ids, null), 0));
  it("starts at the top on an unknown beat", () => assert.equal(resumeIndex(ids, "gone"), 0));
});
