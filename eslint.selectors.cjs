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
  'Colors|Spacing|Radius|FontSize|Type|Motion|Scrim|Highlight|Shadow|FeltGradient|FeltGradients|CardBacks';

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
  TOKEN_AS_STRING,
  TOKEN_AS_TEMPLATE,
  STRING_TOKEN_MESSAGE,
  SCALED_LITERAL_MESSAGE,
};
