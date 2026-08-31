/**
 * PreToolUse hint for Write/Edit. Never blocks — it prints the traps that apply to the file
 * about to be written, at the moment it is written.
 *
 * `docs/agents/loops.md` already documented every trap that cost this project a run in the
 * last month. It is read at the start of a session and forgotten by the time a test is being
 * written, which is the only moment it matters. A hint costs nothing and arrives in time.
 *
 * Exit 0 always. stdout carries the hook's additionalContext, or nothing.
 */
import { readFileSync } from "node:fs";

const HINTS = [
  {
    when: (p) => /tests[\\/]native[\\/].*\.test\.tsx?$/.test(p),
    text:
      "loops.md — the native harness is async. `render` and every `fireEvent` return promises; " +
      "a bare `fireEvent` leaves its act scope open and corrupts EVERY LATER render in the file, " +
      "so an unconditionally present control reads as `Unable to find an element with testID`. " +
      "Await the fireEvent, and end each case with `await view.unmount()`. " +
      "A value from `useAnimatedStyle` is frozen at the mounting render and cannot be read back " +
      "from `props.style` — keep anything a test must assert a plain number.",
  },
  {
    when: (p) => /tests[\\/]e2e[\\/].*\.spec\.ts$/.test(p),
    text:
      "loops.md — only the browser suite sees layout: react-test-renderer never runs flexbox. " +
      "Seed every state the spec asserts on, not just the viewer's, and assert on real device " +
      "viewports rather than arbitrary sizes.",
  },
  {
    when: (p) => /locales[\\/]en\.ts$/.test(p),
    text:
      "CLAUDE.md — every key in `en.ts` must exist in `it.ts` and `sq.ts`; both are typed " +
      "`Record<keyof typeof en, string>`, so a gap is a compile error, not a runtime gap.",
  },
];

let path = "";
try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  path = (payload.tool_input ?? payload).file_path ?? "";
} catch {
  process.exit(0); // an unreadable payload must never disturb a tool call
}

const text = HINTS.filter((h) => h.when(path))
  .map((h) => h.text)
  .join("\n");

if (text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
    })
  );
}
