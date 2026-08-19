// tests/animatedStyle.test.ts — nothing animates a property the compositor
// cannot animate.
//
// On web there is no UI thread: reanimated takes the SHOULD_BE_USE_WEB branch
// and writes inline styles from the main JS thread on every frame. A transform
// or an opacity written that way is still handed to the compositor. A
// `box-shadow` string, a shadow radius or a border colour is not — each one
// invalidates paint, every frame, for as long as the loop runs. The turn pulse
// runs continuously for the whole of the player's turn, on the container
// holding all 14-27 cards of the hand, which is where that costs the most.
//
// The technique that keeps them off the animation is a textless, childless
// sibling carrying the glow as a static token, with only its opacity animated
// (`handStyles.cardGlow`, `avatarRing`, `handGlow`, `playBtnGlow`).
//
// Structural, like tests/reducedMotion.test.ts: the property is about how the
// source is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** Properties a browser repaints for rather than compositing. */
const UNCOMPOSITABLE = /\b(boxShadow|shadowRadius|shadowOpacity|shadowColor|elevation|border[A-Za-z]*Color)\b/;

/**
 * The bodies of every `useAnimatedStyle(` call in `source`, found by matching
 * the call's parentheses. Regex cannot do this: the bodies contain both
 * parentheses and braces.
 */
function animatedStyleBodies(source: string): { body: string; line: number }[] {
  const found: { body: string; line: number }[] = [];
  const needle = "useAnimatedStyle(";
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return found;
    let depth = 0;
    let i = start + needle.length - 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push({
      body: source.slice(start, i + 1),
      line: source.slice(0, start).split("\n").length,
    });
    from = i + 1;
  }
}

test("no animated style drives a property the compositor cannot animate", () => {
  const offenders: string[] = [];
  for (const rel of [...sourcesUnder("app"), ...sourcesUnder("components")]) {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const { body, line } of animatedStyleBodies(source)) {
      const hit = UNCOMPOSITABLE.exec(body);
      if (hit) offenders.push(`${rel}:${line} animates ${hit[1]}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these repaint on every animation frame: ${offenders.join(", ")}. Put the glow on a ` +
      `pointerEvents="none" childless sibling with a static Shadow token and animate its ` +
      `opacity instead — components/table/hand.tsx's cardGlow is the pattern.`
  );
});

// The scanner has to be able to see one, or the test above passes for the
// wrong reason.
test("the scanner matches an uncompositable property inside an animated style", () => {
  const sample = `
    const s = useAnimatedStyle(() => {
      const v = glow.value;
      if (Platform.OS === "web") {
        return { boxShadow: \`0 0 \${v}px gold\` } as any;
      }
      return { shadowRadius: 18 * v };
    });
  `;
  const bodies = animatedStyleBodies(sample);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].body, UNCOMPOSITABLE);
});

// …and it must not swallow the whole file when it sees one.
test("the scanner ends each animated style at its own closing paren", () => {
  const sample = `
    const a = useAnimatedStyle(() => ({ opacity: v.value }));
    const b = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  `;
  const bodies = animatedStyleBodies(sample);
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].body.endsWith(")"));
  assert.doesNotMatch(bodies[0].body, /transform/);
});
