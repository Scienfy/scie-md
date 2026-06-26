# ScieMD Renderer Out-of-Memory Risk Audit v1

Date: 2026-06-25

## Scope

This audit investigates the intermittent WebView screen:

> This page is having a problem
> Error code: Out of Memory

The screen is emitted by the Chromium/WebView2 renderer, not by React. That explains why a refresh often restores the app: refresh creates a new renderer process and reloads the app state. It also means normal React error boundaries, toasts, DOM rescue exports, and console logs are not enough. If the renderer is dead, those systems are already unavailable.

The audit used a main code pass plus three parallel explorer agents covering:

- Idle/background work: timers, polling, file watchers, Tauri listeners.
- Visual rendering and parsing: Milkdown/ProseMirror, math, metadata atoms, export capture.
- Crash diagnostics/recovery: Error boundaries, rescue persistence, native Tauri behavior.

No source fixes are made in this document. It records likely risk areas, gaps, and a recommended remediation path.

## Executive Summary

The current app has several plausible renderer-memory pressure sources. None alone is proven to be the full cause of the reported idle OOM, but together they create a credible failure mode:

- Background polling can continue while native file watchers are also active.
- Linked bibliography/variable file effects can re-run and re-parse during idle through unstable dependencies and repeated equal-content state updates.
- Visual mode can duplicate large Markdown payloads across React state, session storage snapshots, parsed document objects, ProseMirror state/history, and metadata node attrs.
- Some visual render caches and async render paths are bounded only partially.
- The app has no native OOM witness, no durable local memory breadcrumbs, and no recovery UI outside the failed renderer.

The highest value path is to first add local diagnostics and native recovery visibility, then reduce idle churn, then cap visual-render memory, then validate with stress/soak tests.

## P0 Findings

### 1. Renderer OOM Has No Native Witness Or Recovery Surface

Evidence:

- Tauri starts a single WebView app and registers standard plugins/commands in `src-tauri/src/lib.rs`.
- The React root is wrapped by `AppErrorBoundary`, but that only runs while the renderer is alive.
- The app window is undecorated in `src-tauri/tauri.conf.json`, so when the renderer dies the in-app close/minimize controls disappear too.

Impact:

- The Chromium OOM page bypasses the app UI.
- There is no durable record of the final operation, active document size, editor mode, memory pressure, or pending background work.
- The user has to refresh manually, losing the opportunity to capture the failing state.

Recommended path:

- Add a Rust-side renderer heartbeat and last-seen state marker.
- Add a local append-only diagnostics log in app data, privacy-preserving and never uploaded automatically.
- Add a native recovery path independent of the renderer, such as a native dialog or minimal recovery window after a heartbeat gap or process failure signal.
- Record previous-session crash markers on startup and surface them in Tools/Help.

### 2. Raw Rescue Depends On The Failed Renderer

Evidence:

- `src/services/rawDocumentRescue.ts` keeps the latest Markdown in memory and `sessionStorage`.
- Export uses a DOM Blob and anchor click, which requires a working renderer.
- `src/app/App.tsx` updates this snapshot from React state.

Impact:

- The current rescue export is useful for React/render exceptions, but it is not reliable after renderer OOM.
- `sessionStorage` also duplicates the full Markdown string inside the renderer process, adding memory pressure for large documents.

Recommended path:

- Move primary rescue snapshots to Rust-managed storage, using throttled atomic writes to app data or a sidecar recovery file.
- Keep in-renderer rescue as a fast convenience only.
- Expose a native "recover latest draft" flow after renderer restart.
- Bound how often and how much full-document content is mirrored into browser storage.

### 3. Draft Durability Is Best-Effort Under Sudden OOM

Evidence:

- `src/app/hooks/useDocumentSession.ts` debounces draft persistence.
- `src/services/draftRecoveryService.ts` can queue async IndexedDB writes and falls back to in-memory storage.
- Last-chance `visibilitychange`, `pagehide`, and `beforeunload` hooks exist, but renderer OOM may not dispatch them.

Impact:

- A crash during the debounce or IndexedDB write window can lose the newest unsaved state.
- The in-memory fallback does not survive renderer death.

Recommended path:

- Add a Rust-backed recovery snapshot API with bounded, atomic writes.
- Track durable write completion explicitly.
- Show recovery status from native/app startup, not only from React.
- Test renderer reload/crash during active typing, during IndexedDB quota failure, and during very large document edits.

## P1 Findings

### 4. Native Watchers And Fallback Polling Are Often Both Active

Evidence:

- `src/app/hooks/useExternalChangeDetection.ts` starts a 30 second polling interval before knowing whether native watching succeeds.
- `src/app/hooks/useFileExplorer.ts` polls the selected folder every 30 seconds even when Tauri file watching is registered.
- `src/app/hooks/useLayerTwoDocument.ts` can poll bibliography files every 10 seconds and variable files every 5 seconds when watcher setup is unavailable.

Impact:

- Idle windows still wake up to stat, hash, read, parse, and refresh state.
- Slow cloud files or large folders can cause overlapping async operations.
- Each operation can retain closures and full document strings until it resolves.

Recommended path:

- Make polling a fallback only after native watch activation fails.
- Stop fallback polling when native watching succeeds.
- Add one in-flight guard per background job class.
- Add exponential backoff for cloud placeholder or unavailable paths.
- Pause file explorer refresh when the file panel is not visible.
- Diff file explorer entries before replacing state.

### 5. Layer II Linked-File Effects Can Churn While Idle

Evidence:

- `src/app/hooks/useLayerTwoDocument.ts` builds parse options from bibliography/variable state.
- The bibliography and variable effects depend on both stable keys and unstable arrays from the parsed document.
- Some reset paths call `setState([])` or replace diagnostics/definitions with new arrays even when content is equivalent.

Impact:

- Documents with linked `.bib`, JSON, or CSV files can re-register watchers, restart timers, update state, and reparse without meaningful content change.
- This can amplify memory churn when the app is idle.

Recommended path:

- Depend on stable keys only, not raw arrays.
- Shallow-compare diagnostics, definitions, and bibliography text before setting state.
- Keep linked-file signatures in refs that survive effect restarts.
- Add tests for "no idle churn" with unchanged linked files.

### 6. Watcher Update Queue And Backend Watcher Replacement Need Hardening

Evidence:

- `src/services/fileWatchService.ts` serializes every update through a global promise queue and does not coalesce to the latest path union.
- `src-tauri/src/commands/file_watcher.rs` clears the active watcher only when the normalized target list is empty. Failed non-empty replacement can leave the previous watcher active.

Impact:

- Rapid scope changes can queue stale watcher updates.
- Failed replacement can leave stale native watching plus fallback polling.

Recommended path:

- Coalesce watcher updates to the latest desired path set.
- No-op unchanged watcher path unions.
- Add a generation token so stale update results are ignored.
- Clear or explicitly replace the backend watcher on failed non-empty updates before entering fallback mode.

### 7. Failed Math Renders Can Grow The Global Cache Without Eviction

Evidence:

- `src/components/mathPreviewPlugin.ts` evicts successful KaTeX render results after `MAX_MATH_RENDER_CACHE_SIZE`.
- The failed-render path also writes to `mathRenderCache`, but does not apply the same eviction.

Impact:

- A document or edit sequence with many unique malformed equations can retain equation strings and error messages indefinitely for the session.

Recommended path:

- Use one cache insertion helper for success and failure paths.
- Enforce `MAX_MATH_RENDER_CACHE_SIZE` for both.
- Add a unit test with more than 500 unique invalid equations.

### 8. Visual Metadata Atoms Duplicate Large Payloads

Evidence:

- `src/components/milkdown/scieMetadataNodes.ts` stores large atom data in attrs, often both `raw` and derived `body`.
- Directive, Mermaid, SVG, comment, instruction, and variant structures all retain raw source strings.
- SVG sanitizer caps protect some rendering paths, but attr construction can happen before those caps protect the editor model.

Impact:

- Large SVG, Mermaid, directive, or variant blocks can be duplicated across Markdown text, parser outputs, ProseMirror attrs, node views, history, and rendered HTML.
- This is especially risky in visual mode and during repeated render/update cycles.

Recommended path:

- Add explicit max atom size thresholds before storing heavy attrs.
- Render oversized atoms as raw source placeholders in visual mode.
- Avoid storing both `raw` and `body` when body can be derived safely or when the block is above threshold.
- Add round-trip tests for oversized SVG/Mermaid/directive blocks.

### 9. Async Visual Rendering Is Guarded Against Stale DOM Writes, But Not Abortable

Evidence:

- Metadata node views use render generation IDs to avoid stale writes.
- Old async render promises still retain Markdown, generated HTML, and container references until completion.
- Document parsing uses a worker queue with caps/timeouts, but in-flight parses are not abortable.

Impact:

- Rapid edits, mode switches, or repeated external-file refreshes can leave expensive work running after it is no longer needed.
- Large visual blocks amplify retained memory until those promises complete or timeout.

Recommended path:

- Add abort/generation checks inside long-running render helpers, not only at final DOM write.
- Skip or degrade rendering for blocks above thresholds.
- Add request supersession for document parser work, especially for large documents.
- Terminate/recreate the parser worker when a newer large parse supersedes older pending work.

## P2 Findings

### 10. Export Capture Can Spike Memory

Evidence:

- `src/export/renderCapture.ts` clones the visual editor DOM for export.
- Image inlining uses concurrent work over all images.

Impact:

- Styled export can transiently hold the original DOM, clone DOM, image blobs/arrays, base64 strings, and final HTML at the same time.
- This is probably not the idle OOM trigger, but it is a separate renderer-memory risk.

Recommended path:

- Limit image inlining concurrency.
- Add byte caps and clear export clones as early as possible.
- Add a stress test with many large local images.

### 11. Async Tauri Listener Cleanup Race

Evidence:

- Some hooks assign `unlisten` only after async listener registration resolves.
- If cleanup runs first, the returned disposer may not be called.

Impact:

- Low probability, but can leave stale event listeners across rapid mount/unmount cycles.

Recommended path:

- Use the `disposed` pattern already used in other hooks: if registration resolves after cleanup, call `dispose()` immediately.

### 12. Error UI Can Loop And Lacks Durable Context

Evidence:

- `AppErrorBoundary` tracks repeated error count, but the UI does not use it to switch strategy.
- Component stack and durable log IDs are not persisted.
- Unhandled promise rejections are logged and prevented from replacing the editor, which is good for background failures but weak for diagnostics.

Impact:

- Repeated visual crashes can return the user to the same failing state.
- Support/debugging relies on the user seeing console output.

Recommended path:

- Persist component stack and error signatures to the local diagnostics log.
- Use repeated error count to default to source/raw mode after repeated visual failures.
- Add "Export diagnostics bundle" under Tools/Help.

## Recommended Remediation Plan

### Phase 0: Instrument Before Guessing

Goal: make the next OOM diagnosable.

Tasks:

- Add `diagnosticsService` on the renderer side with redacted breadcrumbs.
- Add Rust commands to append diagnostics to app-data log files.
- Record document metrics, not document content: byte length, line count, image count, math count, metadata atom count, large atom sizes, editor mode, active background jobs.
- Add renderer heartbeat to Rust every 5-10 seconds with the latest safe metrics.
- On startup, detect missing/old heartbeat and mark previous session as suspected renderer crash/OOM.
- Add Tools -> Export Diagnostics Bundle.

Acceptance:

- After a forced reload or killed renderer, next startup shows a local crash marker and offers a diagnostics export.
- Diagnostics contain enough breadcrumbs to identify the last active background job and document complexity.

### Phase 1: Remove Idle Churn

Goal: make an idle document actually quiet.

Tasks:

- Convert external-change, file-explorer, bibliography, and variable polling to watcher-fallback-only behavior.
- Add in-flight guards to all background polling jobs.
- Add equality checks before setting arrays/state for unchanged linked-file results.
- Stabilize `useLayerTwoDocument` dependencies so unchanged parsed arrays do not restart effects.
- Coalesce file watcher updates and harden failed replacement behavior.
- Fix async listener cleanup races.

Acceptance:

- A visible idle app with a stable document performs no repeated full document reads/parses when native watchers are active.
- A watcher failure enters one fallback loop per resource type, with backoff and no overlap.
- A two-hour idle soak shows no monotonic heap growth beyond a small steady-state band.

### Phase 2: Cap Visual-Mode Memory

Goal: make visual mode degrade instead of exhausting the renderer.

Tasks:

- Bound math render cache on both success and failure paths.
- Add max-size guardrails for visual metadata atoms.
- Render oversized SVG/Mermaid/directive/variant blocks as raw placeholders.
- Add abort/supersession to visual block rendering and parser work.
- Add document-complexity thresholds for large-document mode: disable expensive previews, cap decorations, and prefer raw placeholders.

Acceptance:

- A document with oversized SVG/Mermaid/directive blocks still opens in visual mode.
- Visual mode never stores unbounded duplicate raw/body payloads for oversized blocks.
- Malformed math stress tests keep cache size bounded.

### Phase 3: Durable Recovery Outside The Renderer

Goal: no refresh-only recovery path.

Tasks:

- Move primary rescue snapshots to Rust atomic files.
- Unify `rawDocumentRescue` and draft recovery around durable write status.
- Add native recovery dialog/window after suspected renderer crash.
- Add startup flow to reopen the last document with the latest durable rescue snapshot.
- Add repeated-error fallback to source/raw mode.

Acceptance:

- Killing the renderer after edits still leaves a recoverable snapshot.
- The user can recover without relying on the failed DOM.
- Repeated visual crashes stop reopening into the same failing visual path.

### Phase 4: Stress And Soak Gates

Goal: prevent regression.

Tests:

- Idle soak: representative document, linked bibliography, linked variables, file explorer folder open, 2 hours.
- Large visual doc: many headings, images, citations, variables, math, SVG, Mermaid, directive blocks.
- Malformed math cache: more than 500 unique invalid formulas.
- Oversized atom fallback: huge SVG/Mermaid/directive/variant blocks.
- Watcher failure: invalid, unavailable, cloud-placeholder, and rapidly changing paths.
- Parser supersession: rapid edits on large documents.
- Renderer restart simulation: crash/reload while draft writes are pending.
- Export stress: many large local images.

Metrics:

- Renderer heap should plateau during idle.
- Pending parse/render/watch queues should return to zero.
- Background job counts should be visible in diagnostics.
- No stress case should show the Chromium OOM page.

## Priority Implementation Checklist

1. Add local diagnostics log and heartbeat.
2. Move rescue snapshots to Rust atomic storage.
3. Make polling watcher-fallback-only and add in-flight guards.
4. Stabilize `useLayerTwoDocument` effects and state equality.
5. Bound failed math cache.
6. Coalesce file watcher updates and clear stale native watchers on failure.
7. Add visual atom size caps and raw placeholder fallback.
8. Add abort/supersession for visual render and parser work.
9. Add repeated-error source/raw fallback.
10. Add soak/stress tests as release gates.

## Open Questions

- Does the OOM happen only in visual mode, or also in source mode after long idle?
- Does it correlate with linked `.bib`, JSON, CSV, or OneDrive/cloud-placeholder files?
- Does it correlate with documents containing large SVG, Mermaid, math, or many image references?
- Is the file explorer left open on a large folder when the app idles?
- Does memory grow steadily in a long run, or spike shortly before the OOM page?

The instrumentation in Phase 0 is the quickest way to answer these without relying on screenshots after the renderer has already died.
