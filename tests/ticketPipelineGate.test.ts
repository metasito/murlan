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

  test("escalates a ticket touching package.json with no recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["components/SettingsModal.tsx", "package.json"],
      body: "Replace the volume presets with a slider.",
    });
    assert.equal(result.escalate, true);
    assert.match(result.reason, /dependenc/);
  });

  test("does not escalate a dependency change with a recorded decision", () => {
    const result = needsDesignFirstGate({
      filesTouched: ["package.json"],
      body: "Design decision: docs/BRIEF.md §2.4 chose the slider package.",
    });
    assert.equal(result.escalate, false);
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
