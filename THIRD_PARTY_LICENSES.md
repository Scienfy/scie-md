# Third-Party Licenses

ScieMD is distributed under AGPLv3-or-later, with commercial licensing available for
AGPL-incompatible use. This file summarizes the third-party open-source components and
bundled font assets used by the app. The full transitive dependency graph is recorded in
`package-lock.json`, `src-tauri/Cargo.lock`, and
`scie-md-vscode-extension/package-lock.json`.

## Bundled Fonts

The app bundles these fonts under `public/fonts/` so document styles do not depend on
proprietary system fonts.

| Asset | Use | License | Bundled license text |
| --- | --- | --- | --- |
| Scie Sans | App UI, Scienfy Inc./Amin styles, SVG examples | SIL Open Font License 1.1 | `public/fonts/scie-sans/OFL.txt` |
| Scie Sans Compact | Compact scientific prose and dense UI text | SIL Open Font License 1.1 | `public/fonts/scie-sans/OFL.txt` |
| Source Serif 4 | Manuscript, journal, and Nature-style prose | SIL Open Font License 1.1 | `public/fonts/vendor/source-serif-4/OFL.txt` |
| Lora | Science-style long-form reading surface | SIL Open Font License 1.1 | `public/fonts/vendor/lora/OFL.txt` |
| IBM Plex Sans | Lab-note, technical, and label typography | SIL Open Font License 1.1 | `public/fonts/vendor/ibm-plex-sans/OFL.txt` |
| JetBrains Mono | Source mode, code blocks, and SVG source labels | SIL Open Font License 1.1 | `public/fonts/vendor/jetbrains-mono/OFL.txt` |
| KaTeX math fonts/assets | Equation rendering | MIT license via KaTeX package | `public/fonts/vendor/katex/LICENSE.txt` |

## Frontend Runtime Dependencies

| Dependency | Purpose | License |
| --- | --- | --- |
| React / React DOM | UI rendering | MIT |
| Tauri JavaScript API and dialog plugin | Desktop bridge and native dialogs | Apache-2.0 / MIT |
| CodeMirror packages | Source editor, search, autocomplete, and editor state | MIT |
| Milkdown packages | Markdown visual editor and ProseMirror integration | MIT |
| markdown-it and plugins | Markdown preview/export parsing | MIT |
| KaTeX | Math rendering | MIT |
| Mermaid | Diagram rendering | MIT |
| lucide-react | UI icons | ISC |
| yaml | YAML front matter parsing | ISC |
| @fontsource packages | Redistributable webfont packaging | MIT package wrapper; bundled fonts retain their listed font licenses |

## Frontend Development Dependencies

| Dependency | Purpose | License |
| --- | --- | --- |
| TypeScript | Type checking | Apache-2.0 |
| Vite and React plugin | Development and production web build | MIT |
| Vitest and jsdom | Unit tests and DOM test environment | MIT |
| @types packages | TypeScript type declarations | MIT |
| Tauri CLI | Desktop build tooling | Apache-2.0 / MIT |

## Rust Runtime Dependencies

| Crate | Purpose | License |
| --- | --- | --- |
| tauri / tauri-plugin-dialog / tauri-plugin-single-instance | Desktop runtime and plugins | Apache-2.0 / MIT |
| serde / serde_json | Serialization | MIT / Apache-2.0 |
| windows-sys | Windows platform APIs | MIT / Apache-2.0 |
| base64 | Image and binary data encoding | MIT / Apache-2.0 |
| blake3 / sha2 | Stable hashing for export/cache flows | CC0-1.0 / Apache-2.0 and MIT / Apache-2.0 |
| libc | Platform FFI support | MIT / Apache-2.0 |
| notify | File watching | CC0-1.0 |
| parking_lot | Synchronization primitives | Apache-2.0 / MIT |
| regex | Pattern matching | MIT / Apache-2.0 |
| zip | DOCX and archive handling | MIT |

Dependency license evidence is tracked through `package-lock.json`,
`src-tauri/Cargo.lock`, and `scie-md-vscode-extension/package-lock.json`. Refresh this
summary whenever dependencies or bundled assets change.

## Font Distribution Notes

- The app does not bundle Microsoft, Apple, Monotype, or platform-only proprietary fonts.
- Named CSS font fallbacks should remain limited to fonts bundled in `public/fonts/` or
  other redistributable font assets.
- Generic CSS families such as `serif`, `sans-serif`, and `monospace` may be used only as
  final fallbacks.
