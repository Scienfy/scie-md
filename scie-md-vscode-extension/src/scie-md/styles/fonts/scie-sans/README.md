# Scie Sans

Scie Sans is a derivative of Inter 4.1, renamed and modified for Scienfy Inc./ScieMD use.
It is distributed under the SIL Open Font License 1.1.

Current font version: 1.320 (v0.4.2 compact scientific design pass).

This folder is the runtime font bundle shipped with ScieMD. It intentionally keeps only
the WOFF2 files loaded by the app and the license/supporting documentation. Old compact
builds, backup drafts, duplicate compact files, and TTF desktop-test artifacts are not kept
here because they increase release size without being used by the app.

## Runtime Files

Main family:

- `ScieSans-Light.woff2`
- `ScieSans-Regular.woff2`
- `ScieSans-Medium.woff2`
- `ScieSans-Bold.woff2`
- `ScieSans-LightItalic.woff2`
- `ScieSans-Italic.woff2`
- `ScieSans-MediumItalic.woff2`
- `ScieSans-BoldItalic.woff2`

Compact family:

- `compact-v1.320/ScieSansCompact-Light.woff2`
- `compact-v1.320/ScieSansCompact-Regular.woff2`
- `compact-v1.320/ScieSansCompact-Medium.woff2`

The app loads these files through CSS `@font-face` rules. Open `specimen.html` in this
folder for a quick visual check of the scientific test strings.

## Regenerating Development Artifacts

Run `npm run fonts:scie-sans` from the project root to regenerate the full font build,
including TTF files for desktop testing in apps such as Word. The TTF files are written
to ignored `artifacts/fonts/scie-sans-ttf/`; only WOFF2 runtime files are kept in `public/`.

## Design Notes

This pass makes targeted scientific/UI deltas while preserving Inter's core proportions:

- capital `I` has subtle functional bars
- lowercase `l` has a right-foot terminal
- digit `1` has a clearer base foot
- plain `0` is slightly narrower for O/0 distinction without using slashed zero by default
- compact-width Light, Regular, and Medium cuts are available as `Scie Sans Compact`
- U+2212 minus is tabular-width for numeric alignment
- U+202F narrow no-break space is standardized for value-unit spacing
- U+2219 bullet operator maps to the centered-dot drawing
