# Coding standards

Use this reference for TypeScript, Electron APIs, IPC, asynchronous code, errors, naming, tests, and reviews.

## Repository alignment

- Use the package manager selected by the checked-in lockfile.
- Use repository scripts instead of inventing direct tool commands when equivalent scripts exist.
- Follow checked-in formatter, lint, TypeScript, and import-order configuration. Do not reformat unrelated files.
- Preserve the repository's ESM or CommonJS choice. Do not mix module systems without a build-driven reason.
- Prefer existing utilities and dependencies. Ask before adding production dependencies.

## TypeScript

- Keep strict type checking enabled. Do not weaken compiler options to make a change pass.
- Avoid `any`, non-null assertions, broad type casts, and `@ts-ignore`. Start untrusted values as `unknown` and narrow them.
- Model state with discriminated unions when multiple outcomes exist.
- Make IPC request, result, event, and public preload types explicit and serializable.
- Prefer `Readonly`, immutable updates, and pure functions for document and canvas state where practical.
- Use exhaustive `switch` handling with a `never` check for closed unions.
- Keep functions focused; extract a helper when it gives a concept a name or isolates a side effect, not merely to reduce line count.
- Add explicit return types to exported functions and public capability methods.

Use `node:` specifiers for Node built-ins. When supported by the installed Electron version and current build setup, use process-specific type imports such as `electron/main` and `electron/renderer` to make process ownership visible.

## Naming and files

- Use the repository's established filename convention; default to `kebab-case.ts` and `PascalCase.tsx` for UI components when no convention exists.
- Name functions with verbs and booleans with `is`, `has`, `can`, or `should`.
- Name IPC transport constants by domain and action; do not scatter string literals.
- Use `Request`, `Result`, `Event`, and `Error` suffixes for public cross-process contracts.
- Avoid vague modules named `utils`, `helpers`, `common`, `manager`, or `service` when a domain-specific name is available.
- Keep one clear responsibility per file. Colocate tests with their module unless repository configuration dictates otherwise.

## Electron and IPC

- Import Electron APIs only in their owning process.
- Register IPC handlers once during application composition and remove or replace them deliberately during teardown or test reinitialization.
- Prefer `ipcMain.handle`/`ipcRenderer.invoke` for request/response operations and propagate a stable serializable result.
- Avoid sync IPC and long-running work on the main process.
- Never accept a renderer-provided filesystem path, URL, executable, command, or channel name without validation and authorization.
- Do not pass the `event` argument through preload callbacks. Pass only validated data.
- Return an unsubscribe function that removes the exact wrapped listener registered by preload.
- Bound payload sizes for binary, text, history, or drawing data. Avoid sending high-frequency pointer updates over IPC; keep interactive canvas work in the renderer.
- Treat file dialogs, file writes, clipboard, shell, notifications, and global shortcuts as privileged capabilities.

## Errors and logging

- Catch errors only where the code can add context, translate them, retry safely, or restore state.
- Preserve internal causes in main-process logs while returning a sanitized error contract to the renderer.
- Distinguish user cancellation from failure.
- Include stable error codes for renderer decisions; do not make UI logic parse messages.
- Never log document contents, secrets, access tokens, full user paths, or large drawing payloads by default.
- Use the project's logger when present. Do not leave debugging `console.log` calls in production paths.

## Async work and lifecycle

- Use `async`/`await` consistently and await promises intentionally.
- Handle app shutdown, window destruction, cancellation, and late async completion.
- Dispose event listeners, timers, watchers, shortcuts, ports, and IPC subscriptions with the owner that created them.
- Keep `BrowserWindow` references alive only as long as needed and guard operations against destroyed windows or web contents.
- Move measured CPU-bound work away from the main thread; do not confuse Promise-based code with non-blocking CPU work.

## Security review

Reject or escalate changes that:

- enable Node integration or disable context isolation, sandboxing, or web security;
- expose raw Electron or Node APIs to the renderer;
- accept arbitrary channels or commands from renderer code;
- open unvalidated external URLs or allow unrestricted navigation/new windows;
- interpolate untrusted data into HTML, commands, paths, or SQL-like storage queries;
- load remote executable content with local privileges;
- silently broaden permissions or filesystem access.

## Tests and verification

- Unit-test pure domain behavior without Electron.
- Test main application services with adapter fakes at I/O boundaries.
- Test IPC validation, authorization, success, cancellation, failure translation, and handler cleanup.
- Test preload capabilities as stable public contracts when the build setup permits it.
- Add an Electron integration or smoke test for window lifecycle, preload exposure, navigation restrictions, or packaging-sensitive behavior when risk warrants it.
- Run targeted tests first, then repository typecheck, lint, tests, and relevant build scripts.
- Do not claim packaging or platform support that was not exercised. State the tested OS and gaps.
