# Contributing to ScieMD

ScieMD is intended for scientific writing workflows. Contributions should preserve the
local-first model, readable Markdown source, and transparent export behavior.

## Development Setup

```bash
npm ci
npm run dev
```

For desktop work, install the Tauri prerequisites for your operating system and run:

```bash
npm run tauri -- dev
```

Font rebuild and verification scripts require Python 3 and `fonttools`:

```bash
python -m pip install fonttools
```

## Validation

Before opening a pull request, run the checks that match the files you changed:

```bash
npm run build
npm run test
npm run test:all
npm run validate:release
```

For Rust changes:

```bash
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

For the VS Code extension:

```bash
cd scie-md-vscode-extension
npm ci
npm run build
npm run test
```

## Pull Requests

- Keep changes focused and include tests for user-visible behavior.
- Do not commit generated release artifacts, installers, autosave backups, local secrets,
  `node_modules`, or build output.
- Preserve third-party license notices when adding dependencies or bundled assets.
- By contributing, you agree to the contributor terms in
  `CONTRIBUTOR_LICENSE_AGREEMENT.md`. This lets Scienfy Inc. keep ScieMD available under the
  AGPL while also offering commercial licenses for AGPL-incompatible use.
