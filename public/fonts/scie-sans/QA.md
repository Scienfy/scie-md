# Scie Sans QA Strings

Use these strings in ScieMD, Word, browser screenshots, and print/PDF checks.

## Scientific Strings

- I1l O0 Al2O3 OER-01 Il-10
- I1l O0 10⁻³ mol L⁻¹
- CO₂RR, OER, HER, H₂O, SO₄²⁻
- 5 mA cm⁻², 1.23 V vs RHE
- α-Fe₂O₃, RuO₂, IrOx, NiFe-LDH
- ηOER, ΔG, λmax, μm, µL, kΩ
- A ⇌ B, A → B, −0.2 V, ±5%
- ¹⁴C, ²³⁸U
- (1̅10), [001]
- 25 °C, 5.0 mA cm⁻², 100 µL
- ϕ φ, ϑ θ, ϵ ε, ϰ κ, ϱ ρ, ϖ π

## Required Checks

- `I`, `l`, and `1` must remain distinct at 12-16 px and at 6-8 pt print size.
- Plain `0` remains default; slashed zero is available through OpenType `zero`.
- `O` and plain `0` must remain distinct without enabling slashed zero.
- Compact Light, Regular, and Medium must save horizontal space without collapsing `I`, `l`, `1`, `O`, and `0`.
- U+2212 minus aligns with tabular numerals in signed numeric columns.
- U+202F narrow no-break space is visible only as value-unit spacing, not as a large word gap.
- U+2219 renders as a centered operator dot, distinct from period.
