// tests/ticketPipelineGate.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { needsDesignFirstGate } from "../lib/ticketPipeline/gate.ts";

describe("the design-first gate", () => {
  test("escalates a ticket touching shared/schema.ts with no recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts", "server/db.ts"],
      body: "Add a new column to track streaks.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /shared\/schema\.ts/);
  });

  test("escalates a schema change reported as an absolute path", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["C:/Users/roton/murlan/shared/schema.ts"],
      body: "Add a new column to track streaks.",
    });
    assert.equal(result.escalate, true);
  });

  test("does not escalate a file that merely ends in schema.ts", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["server/schemaDdl.ts", "lib/otherSchema.ts"],
      body: "Reorder two statements.",
    });
    assert.equal(result.escalate, false);
  });

  test("does not escalate a schema change with a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts"],
      body: "Add streaks column. Design decision: docs/BRIEF.md §4.2 resolved the column shape.",
    });
    assert.equal(result.escalate, false);
  });

  test("escalates a ticket touching the socket protocol", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["server/socketSchemas.ts", "shared/events.ts"],
      body: "Add a new socket event for spectators.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /socket/);
  });

  test("escalates a ticket touching more than 6 files with no recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: Array.from({ length: 7 }, (_, i) => `components/File${i}.tsx`),
      body: "Rename a prop across the codebase.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /7 files/);
  });

  test("escalates a ticket touching package.json to weigh a dependency", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/SettingsModal.tsx", "package.json"],
      body: "No slider is installed, and adding that dependency is not obviously right.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /dependenc/);
  });

  // package.json also holds scripts, engines and config. #278 adds one npm script and installs
  // nothing, and the file-path trigger alone sent it to the owner for a decision it had made.
  test("does not escalate a package.json edit that installs nothing", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["tsconfig.strictIndexed.json", "package.json"],
      body: "An npm script that runs it, and a CI step invoking that script.",
    });
    assert.equal(result.escalate, false, result.reason);
  });

  // Dependency talk with no manifest in sight is somebody naming a package they already have.
  test("does not escalate dependency language without package.json", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/Slider.tsx"],
      body: "Built on the already-installed dependency, so nothing new is added.",
    });
    assert.equal(result.escalate, false, result.reason);
  });

  test("does not escalate a dependency change with a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["package.json"],
      body: "Design decision: docs/BRIEF.md §2.4 chose the slider package.",
    });
    assert.equal(result.escalate, false);
  });

  // Every user-facing string is keyed in all three locales, and `it.ts`/`sq.ts` are
  // `Record<keyof typeof en, string>`, so a gap is a compile error rather than a decision. Counted
  // separately they spend three of the six the threshold allows, and #349 — a chip label, four
  // real files — escalated at seven.
  test("the three locale files count as the one edit the compiler forces", () => {
    const result = needsDesignFirstGate({
      filesTouched: [
        "components/GameTable.tsx",
        "components/table/pile.tsx",
        "components/gameTableModel.ts",
        "lib/gameEngine.ts",
        "locales/en.ts",
        "locales/it.ts",
        "locales/sq.ts",
      ],
      body: "Name the player who made the play now on the felt.",
    });
    assert.equal(result.escalate, false, result.reason);
  });

  test("collapsing the locales does not hide a genuinely broad change", () => {
    const result = needsDesignFirstGate({
      filesTouched: [
        ...Array.from({ length: 6 }, (_, i) => `components/File${i}.tsx`),
        "locales/en.ts",
        "locales/it.ts",
        "locales/sq.ts",
      ],
      body: "Rename a prop across the codebase.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /7 files/);
  });

  // `ready-for-agent` is a promise that the decisions are made; unchecked boxes under "What to
  // settle" say they are not. An agent that meets both picks one reading and builds on a guess,
  // or spends a claim discovering the contradiction — which is what #349 cost.
  test("escalates a ticket still carrying unsettled decisions", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/GameTable.tsx"],
      body: [
        "## What to settle",
        "",
        "- [ ] Does the name replace the label or join it?",
        "- [ ] What it reads when the viewer made the play.",
        "",
        "## Constraints",
        "- [ ] not a decision, a different section",
      ].join("\n"),
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /2 unsettled/);
  });

  test("a settled section is not an escalation", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/GameTable.tsx"],
      body: ["## What to settle", "", "- [x] Replace the label.", "- [x] Own name."].join("\n"),
    });
    assert.equal(result.escalate, false);
  });

  // The early return for a recorded decision must not reach past these: an ADR about one part of
  // a ticket says nothing about the boxes still open in another.
  test("a recorded decision elsewhere does not settle open boxes", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts"],
      body: ["Design decision: docs/BRIEF.md §4.2.", "", "## What to settle", "", "- [ ] The column name."].join(
        "\n"
      ),
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /unsettled/);
  });

  test("does not escalate a small, ordinary ticket", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/SettingsModal.tsx", "locales/en.ts"],
      body: "Fix a mistranslated string.",
    });
    assert.equal(result.escalate, false);
  });

  test("an ADR reference also counts as a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["shared/schema.ts"],
      body: "Per docs/adr/0002-streaks.md, add the column.",
    });
    assert.equal(result.escalate, false);
  });
});
