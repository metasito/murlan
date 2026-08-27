// tests/native/fabricIntProps.ts — Fabric converts every prop to its declared
// C++ type while mounting the host view. A JS number that is not whole,
// reaching a prop declared `int`, throws there: inside `createNode`, before the
// view exists and so before anything can catch it. The screen goes red and
// takes everything above it with it.
//
// Nothing else in this repo can see that. `react-test-renderer` never mounts a
// host view, and `react-native-web` mirrors these into DOM attributes, which
// are strings. So this reads what the renderer did produce and applies Fabric's
// own contract to it.
//
// The props an app author can set, from
// `node_modules/react-native/ReactCommon/react/renderer/`:
//
//   accessibilityValue.min/.max/.now       std::optional<int>
//     components/view/AccessibilityPrimitives.h:127
//   zIndex (style)                         std::optional<int>
//     components/view/BaseViewProps.h:97
//   numberOfLines -> maximumNumberOfLines  int
//     attributedstring/ParagraphAttributes.h:36
//   maxLength (TextInput)                  int
//     components/textinput/BaseTextInputProps.h:64
//
// Extend it from RN's own source when a prop is added, not from guesswork.
import { expect } from '@jest/globals';

const INT_PROPS = ['numberOfLines', 'maxLength'] as const;
const INT_VALUE_FIELDS = ['min', 'max', 'now'] as const;

function record(out: string[], where: string, field: string, held: unknown): void {
  if (typeof held === 'number' && !Number.isInteger(held)) {
    out.push(`<${where}> ${field} = ${held}`);
  }
}

/** `style` reaches a host node as whatever the author wrote — object or array. */
function recordStyle(out: string[], where: string, style: unknown): void {
  if (Array.isArray(style)) {
    for (const layer of style) recordStyle(out, where, layer);
    return;
  }
  if (style && typeof style === 'object') {
    record(out, where, 'style.zIndex', (style as Record<string, unknown>).zIndex);
  }
}

function walk(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const element = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown };
  const props = element.props;
  if (props) {
    const where = typeof element.type === 'string' ? element.type : 'view';
    const value = props.accessibilityValue;
    if (value && typeof value === 'object') {
      for (const field of INT_VALUE_FIELDS) {
        record(out, where, `accessibilityValue.${field}`, (value as Record<string, unknown>)[field]);
      }
    }
    for (const field of INT_PROPS) record(out, where, field, props[field]);
    recordStyle(out, where, props.style);
  }
  walk(element.children, out);
}

/**
 * Names the prop, the value and the test, so the next reader is spared a bisect.
 *
 * It reads whatever is still mounted when a test ends, so a test that unmounts
 * its own tree is checked against nothing. That is a gap in reach, not in the
 * rule: any render left standing is checked, and one test rendering a component
 * is enough to cover it for every other.
 */
export function assertWholeNumbers(tree: unknown): void {
  const offences: string[] = [];
  walk(tree, offences);
  if (offences.length === 0) return;
  throw new Error(
    [
      'Fabric declares these props as C++ int and converts them while mounting the',
      'view, so a fraction here is a red screen on device and a green run here.',
      `Rendered by: ${expect.getState().currentTestName ?? 'this test'}`,
      ...offences.map((offence) => `  ${offence}`),
    ].join('\n')
  );
}
