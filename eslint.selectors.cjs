// The esquery selectors eslint.config.js enforces, declared once.
//
// They live here rather than inline in the config so that tests/spacingLint
// can assert against the string the linter actually runs. A test that restates
// a selector is a copy, and a copy drifts — which is the same silent hole this
// rule exists to close, in a new place.
//
// React Native renders an invalid colour as nothing at all — no warning, no
// fallback, just an invisible element. Every selector here targets a way to
// produce one that neither TypeScript nor a render test catches.

const TOKEN_OBJECTS =
  'Colors|Spacing|Radius|FontSize|Type|Motion|Reading|Scrim|Highlight|Shadow|FeltGradient|FeltGradients|CardBacks';

// Every edge shorthand React Native accepts, built from the two prefixes and
// the edge suffixes rather than enumerated.
const SPACING_PROPS =
  '(padding|margin)(Top|Bottom|Left|Right|Start|End|Vertical|Horizontal|(Block|Inline)(Start|End)?)?|gap|rowGap|columnGap';
const SCALED_PROPS = `fontSize|borderRadius|${SPACING_PROPS}`;

// `raw`, not `value`: esquery only regex-matches an attribute that is already a
// string, so a numeric `value` matches nothing at all and the rule reports
// green. `-8` parses as a UnaryExpression over the literal, hence the second
// selector — one alone leaves half the scale unguarded.
const BARE_NUMBER = 'Literal[raw=/^[1-9][0-9.]*$/]';
const SCALED_LITERAL =
  `Property[key.name=/^(${SCALED_PROPS})$/] > ${BARE_NUMBER}, ` +
  `Property[key.name=/^(${SCALED_PROPS})$/] > UnaryExpression > ${BARE_NUMBER}`;

// The single value, not the whole scale: banning bare numbers on these properties
// outright would flag `minWidth: 0` (the flex truncation idiom), a 28pt badge and
// a 120pt text area, none of which belong on a scale. A decorative box that is 44
// for its own reasons takes the named-module-constant escape the design system
// already allows.
const SIZE_PROPS = 'minHeight|minWidth|height|width';
const TOUCH_TARGET_LITERAL = `Property[key.name=/^(${SIZE_PROPS})$/] > Literal[raw="44"]`;
const TOUCH_TARGET_LITERAL_MESSAGE =
  'This is TOUCH_TARGET_MIN written as a bare number, and tests/touchTargets.test.ts reads the token. Import it from @/lib/theme, or — if this box is not a touch target — give it a named module constant that says so.';

// Timing, on the same footing as the other scales. `duration` and `delay` are
// deliberately their own selector rather than another entry in SCALED_PROPS:
// they carry a different message, because the scale they belong to is `Motion`
// and the escape for a value that is not motion at all — a reading budget, a
// deliberately unsynchronised scatter — is a named constant rather than a step.
// Reanimated spells a timing two ways — `withTiming(v, { duration })` and the
// layout-animation builder's `FadeIn.duration(n)` — and a rule that knows only
// the first leaves the second free to drift, which is where `FadeIn.duration(280)`
// survived the migration that swept every object property in the same file.
const TIMING_PROPS = 'duration|delay';
const TIMING_LITERAL =
  `Property[key.name=/^(${TIMING_PROPS})$/] > ${BARE_NUMBER}, ` +
  `CallExpression[callee.property.name=/^(${TIMING_PROPS})$/] > ${BARE_NUMBER}`;
const TIMING_LITERAL_MESSAGE =
  'Use a Motion step from @/lib/theme, picked by the role it plays (flash, tap, shift, travel, reveal, dwell). A duration that is not motion — how long something stays readable, a scatter that must not synchronise — takes a named module constant that says so, never a bare number.';

const TOKEN_AS_STRING = `Literal[value=/^(${TOKEN_OBJECTS})\\.[A-Za-z0-9_]+$/]`;
const TOKEN_AS_TEMPLATE = `TemplateElement[value.raw=/^(${TOKEN_OBJECTS})\\.[A-Za-z0-9_]+$/]`;

const STRING_TOKEN_MESSAGE =
  'This is a design token written as a string, so it resolves to no colour at all. Drop the quotes and reference the token directly.';
const SCALED_LITERAL_MESSAGE =
  'Use a FontSize, Radius or Spacing token. A one-off that fits no step may be a named module constant, but not a bare number in a style object.';

module.exports = {
  TOKEN_OBJECTS,
  SPACING_PROPS,
  SCALED_PROPS,
  BARE_NUMBER,
  SCALED_LITERAL,
  TIMING_PROPS,
  TIMING_LITERAL,
  TIMING_LITERAL_MESSAGE,
  TOUCH_TARGET_LITERAL,
  TOUCH_TARGET_LITERAL_MESSAGE,
  TOKEN_AS_STRING,
  TOKEN_AS_TEMPLATE,
  STRING_TOKEN_MESSAGE,
  SCALED_LITERAL_MESSAGE,
};
