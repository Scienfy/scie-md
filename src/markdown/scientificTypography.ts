import { fencedCodeRanges, inlineCodeRanges, mergeRanges, scieMdCommentRanges } from './markdownRanges';

const NARROW_NO_BREAK_SPACE = '\u202f';
const MINUS_SIGN = '\u2212';
const MICRO_SIGN = '\u00b5';

const SCIENTIFIC_UNITS = [
  'mmol',
  'µmol',
  'nmol',
  'pmol',
  'mol',
  'mM',
  'µM',
  'nM',
  'pM',
  'M',
  'mL',
  'µL',
  'nL',
  'L',
  'mA',
  'µA',
  'nA',
  'A',
  'mV',
  'µV',
  'nV',
  'V',
  'mW',
  'µW',
  'nW',
  'W',
  'MΩ',
  'kΩ',
  'Ω',
  'cm',
  'mm',
  'µm',
  'nm',
  'pm',
  'm',
  'ms',
  'µs',
  'ns',
  's',
  'min',
  'h',
  'GHz',
  'MHz',
  'kHz',
  'Hz',
  'MPa',
  'kPa',
  'Pa',
  'bar',
  'kg',
  'mg',
  'µg',
  'ng',
  'g',
  '°C',
  'K',
].sort((left, right) => right.length - left.length);

const UNIT_PATTERN = `(?:${SCIENTIFIC_UNITS.map(escapeRegExp).join('|')})`;
const NUMBER_PATTERN = String.raw`(?:[+\u2212-]?\d+[\u2070\u00b9\u00b2\u00b3\u2074-\u2079\u207b]+|[+\u2212-]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:[eE][+\u2212-]?\d+)?)`;

const MICRO_PREFIX_PATTERN = /(^|[^A-Za-z0-9_])(?:u|μ)(?=(?:A|V|W|F|H|S|m|mol|M|g|L|l|s)\b)/g;
const UNARY_MINUS_PATTERN = /(^|[\s([{:;,=<>])-(?=\d|\.\d)/g;
const CARET_EXPONENT_MINUS_PATTERN = /\^\s*-\s*(?=\d)/g;
const VALUE_UNIT_SPACE_PATTERN = new RegExp(
  `(${NUMBER_PATTERN})(?:[ \\t\\u00a0\\u202f]+)(${UNIT_PATTERN})(?=$|[\\s,;:).\\]\\}])`,
  'g',
);
const UNIT_POWER_MINUS_PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_])(${UNIT_PATTERN})-(?=\\d)`,
  'g',
);
const UNIT_TO_UNIT_SPACE_PATTERN = new RegExp(
  `(${UNIT_PATTERN})(?:[ \\t\\u00a0\\u202f]+)(${UNIT_PATTERN})(?=(?:[\\u2212-]?\\d|[\\u2070\\u00b9\\u00b2\\u00b3\\u2074-\\u2079\\u207b])|$|[\\s,;:).\\]\\}])`,
  'g',
);

export function normalizeScientificTypography(markdown: string): string {
  const protectedRanges = mergeRanges([
    ...fencedCodeRanges(markdown),
    ...inlineCodeRanges(markdown),
    ...scieMdCommentRanges(markdown),
  ]);
  let normalized = '';
  let cursor = 0;
  for (const range of protectedRanges) {
    normalized += normalizeScientificTypographySegment(markdown.slice(cursor, range.start));
    normalized += markdown.slice(range.start, range.end);
    cursor = range.end;
  }
  normalized += normalizeScientificTypographySegment(markdown.slice(cursor));
  return normalized;
}

function normalizeScientificTypographySegment(segment: string): string {
  return normalizeCompoundUnitSpaces(
    normalizeValueUnitSpaces(
      normalizeUnitPowers(
        normalizeMinusSigns(
          normalizeMicroPrefixes(segment),
        ),
      ),
    ),
  );
}

function normalizeMicroPrefixes(text: string): string {
  return text.replace(MICRO_PREFIX_PATTERN, (_match, prefix: string) => `${prefix}${MICRO_SIGN}`);
}

function normalizeMinusSigns(text: string): string {
  return text
    .replace(CARET_EXPONENT_MINUS_PATTERN, `^${MINUS_SIGN}`)
    .replace(UNARY_MINUS_PATTERN, (_match, prefix: string) => `${prefix}${MINUS_SIGN}`);
}

function normalizeUnitPowers(text: string): string {
  return text.replace(UNIT_POWER_MINUS_PATTERN, (_match, prefix: string, unit: string) => `${prefix}${unit}${MINUS_SIGN}`);
}

function normalizeValueUnitSpaces(text: string): string {
  return text.replace(VALUE_UNIT_SPACE_PATTERN, (_match, value: string, unit: string) => `${value}${NARROW_NO_BREAK_SPACE}${unit}`);
}

function normalizeCompoundUnitSpaces(text: string): string {
  let current = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = current.replace(UNIT_TO_UNIT_SPACE_PATTERN, (_match, leftUnit: string, rightUnit: string) => (
      `${leftUnit}${NARROW_NO_BREAK_SPACE}${rightUnit}`
    ));
    if (next === current) return next;
    current = next;
  }
  return current;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
