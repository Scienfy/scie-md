# Release Package Budgets

Round 12 added explicit local budgets for structured-format growth. These thresholds are deliberately generous enough for the current preview release, but low enough to catch accidental parser, schema, font, or webview bloat before packaging.

The source of truth is `scripts/release-budgets.mjs`.

## Current Thresholds

- Desktop `dist/` total: 32 MiB
- Desktop JavaScript total: 10 MiB
- Desktop largest JavaScript bundle: 4 MiB
- Desktop CSS total: 2 MiB
- Desktop worker JavaScript total: 2 MiB
- VS Code extension `dist/` total: 32 MiB
- VS Code extension-host JavaScript: 8 MiB
- VS Code webview JavaScript: 32 MiB
- VSIX package: 64 MiB
- Windows NSIS installer: 128 MiB
- Windows MSI installer: 128 MiB
- Windows desktop bundle total: 256 MiB

## Validation Commands

- `npm run validate:package-budgets` checks built desktop and VS Code extension output.
- `npm run validate:package-budgets -- --vsix --desktop-bundles` also requires and checks the local VSIX plus Tauri Windows installers.
- `npm run validate:vscode-package` uses the same VSIX, extension-host, and webview JavaScript budgets while also checking package contents.
- `npm run validate:release` runs the budget guard after frontend and extension builds.
- `npm run validate:merge` runs the package budget guard again after desktop packaging and VSIX packaging.

## Budget Policy

- Raise a threshold only with a concrete reason: new required runtime, unavoidable bundled asset, or deliberate distribution policy change.
- Prefer lazy-loading or source-only fallback before increasing the largest JavaScript bundle budget.
- Keep generated packages local. Passing a budget check does not imply the artifact should be committed or published.
