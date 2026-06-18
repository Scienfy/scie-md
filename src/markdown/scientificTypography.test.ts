import { describe, expect, it } from 'vitest';
import { normalizeScientificTypography } from './scientificTypography';

describe('normalizeScientificTypography', () => {
  it('normalizes scientific minus signs, micro units, and value-unit spacing', () => {
    expect(normalizeScientificTypography('A -> B, -0.2 V, 5 mA cm-2, 100 uL, 25 °C')).toBe(
      'A -> B, −0.2 V, 5 mA cm−2, 100 µL, 25 °C',
    );
  });

  it('normalizes unit chains and exponent notation without changing scientific names', () => {
    expect(normalizeScientificTypography('OER-01, Il-10, α-Fe2O3, NiFe-LDH; 10^-3 mol L-1')).toBe(
      'OER-01, Il-10, α-Fe2O3, NiFe-LDH; 10^−3 mol L−1',
    );
  });

  it('keeps code spans, fenced code, and ScieMD comments unchanged', () => {
    const source = [
      '100 uL and -0.2 V',
      '`100 uL and -0.2 V`',
      '```txt',
      '100 uL and -0.2 V',
      '```',
      '<!-- scie_md:comment text="100 uL and -0.2 V" -->',
    ].join('\n');

    expect(normalizeScientificTypography(source)).toBe([
      '100 µL and −0.2 V',
      '`100 uL and -0.2 V`',
      '```txt',
      '100 uL and -0.2 V',
      '```',
      '<!-- scie_md:comment text="100 uL and -0.2 V" -->',
    ].join('\n'));
  });
});
