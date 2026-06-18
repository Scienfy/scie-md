# Bundled Font Licenses

ScieMD only references redistributable fonts in production UI, document styles, SVG samples, and export templates.

| Font | Where used | License | Source |
| --- | --- | --- | --- |
| Scie Sans / Scie Sans Compact | App UI, Amin style, Scienfy styles, SVG examples | SIL Open Font License 1.1 | `public/fonts/scie-sans/OFL.txt` |
| Source Serif 4 | Scientific manuscript, journal, Nature-style long-form document surfaces | SIL Open Font License 1.1 | `public/fonts/vendor/source-serif-4/` |
| Lora | Science-style prose surface | SIL Open Font License 1.1 | `public/fonts/vendor/lora/` |
| IBM Plex Sans | Lab notebook, technical/code-flavored document surfaces, scientific labels | SIL Open Font License 1.1 | `public/fonts/vendor/ibm-plex-sans/` |
| JetBrains Mono | Source editor, code blocks, SVG source labels | SIL Open Font License 1.1 | `public/fonts/vendor/jetbrains-mono/` |
| KaTeX math fonts/assets | Math rendering | MIT license via KaTeX package | `public/fonts/vendor/katex/LICENSE.txt` |

Do not add Microsoft, Apple, Monotype, or platform-only font names to production CSS/TS/Markdown assets. Generic CSS families such as `serif`, `sans-serif`, and `monospace` are acceptable final fallbacks, but named fallbacks should be fonts we bundle or can redistribute.

See `THIRD_PARTY_LICENSES.md` for the broader dependency and bundled-font license summary.
