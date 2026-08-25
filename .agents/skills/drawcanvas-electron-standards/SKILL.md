---
name: drawcanvas-electron-standards
description: Enforce the drawCanvas repository's Electron architecture, TypeScript coding style, process and layer boundaries, IPC contracts, dependency and runtime version security, official-documentation checks, and verification workflow. Use only inside this repository when implementing, reviewing, debugging, refactoring, testing, or documenting main-process, preload, renderer UI, shared contract, native integration, persistence, packaging, or update code. Also use when adding files or dependencies, selecting or changing library and runtime versions, choosing a layer, defining IPC, configuring BrowserWindow/webPreferences, or adopting an Electron API. Do not use outside drawCanvas or for non-code tasks unrelated to its engineering standards.
---

# drawCanvas Electron Standards

Apply repository-specific engineering rules to every Electron change. Preserve established project choices while enforcing secure process isolation and explicit dependency direction.

## Establish repository truth

1. Confirm that the working directory belongs to the repository containing this skill under `.agents/skills`. Stop applying the skill outside that repository.
2. Read applicable `AGENTS.md` files before changing code.
3. Inspect `package.json`, the lockfile, TypeScript, lint and formatter configs, Electron build or Forge config, test config, and the relevant source tree.
4. Infer the package manager, module format, renderer framework, path aliases, Electron version, build system, and existing naming conventions from repository evidence. Do not invent a parallel toolchain.
5. Apply this precedence order: explicit user instruction, applicable `AGENTS.md`, repository configuration and scripts, established local pattern, then this skill's defaults.
6. Keep the security requirements in this skill as hard gates. Do not weaken them merely to match legacy code; explain the conflict and request direction if a task truly requires an exception.
7. If the repository is still empty, use the defaults in the references as the proposed baseline, but do not scaffold an application unless the user asks.

## Select the relevant guidance

- Read [project-architecture.md](references/project-architecture.md) before adding or moving modules, introducing a feature, choosing a layer, changing process ownership, or designing IPC.
- Read [coding-standards.md](references/coding-standards.md) before writing or reviewing TypeScript, Electron APIs, IPC, asynchronous work, errors, tests, or naming.
- Read [electron-docs.md](references/electron-docs.md) before adopting or changing an Electron API, `BrowserWindow` preferences, permissions, navigation, protocols, packaging, signing, updating, or version-sensitive behavior.
- Read only the references needed for the current change. Read all three for cross-process features or architecture reviews.

## Classify every change

Assign each responsibility before editing:

- Put application lifecycle, windows, menus, OS capabilities, file access, persistence adapters, and privileged orchestration in the main process.
- Put the smallest capability-specific bridge in preload.
- Put DOM, canvas rendering, interaction, view state, and presentation logic in the renderer.
- Put serializable IPC contracts and framework-independent domain types in shared code.
- Put CPU-heavy, crash-prone, or isolated background work in an Electron utility process when justified by measured workload or fault-isolation needs.

Follow this dependency direction:

`renderer UI -> preload capability -> IPC contract -> main application/domain -> infrastructure`

Do not let shared or domain code import Electron, Node, DOM, or a renderer framework. Do not let renderer code import `electron`, Node built-ins, main-process modules, or infrastructure adapters.

## Choose secure implementations and versions

- Treat secure code patterns and dependency, toolchain, and runtime versions as hard acceptance criteria, not optional cleanup.
- Before adding, upgrading, downgrading, or replacing a package or runtime, identify the exact lockfile-resolved version and current support status. Check current official release or security notes and relevant reputable vulnerability advisories; do not rely on memory, a version range, or package metadata alone.
- Prefer maintained, supported stable releases that are compatible with the repository and are not affected by relevant known vulnerabilities. Avoid end-of-life, deprecated, abandoned, malicious, or pre-release packages and versions unless the user explicitly accepts a documented necessity and risk.
- Inspect changed transitive dependencies and lockfile entries as well as the direct package. Follow repository version-range conventions, but verify the resolved artifact; never assume that newest means secure or that older means stable.
- Prefer secure platform APIs, existing maintained dependencies, or small local implementations when they reasonably avoid adding an unnecessary third-party package. Do not adopt deprecated or insecure APIs or disable security controls merely to make a library work.
- Run the package manager's applicable audit or vulnerability check for dependency or runtime changes and triage findings for actual applicability. Treat a clean scan as evidence, not proof of safety.
- If no safe compatible version exists, or remediation requires a breaking migration outside the task's scope, stop before introducing the risk. Report affected versions, available options, and residual risk, then request explicit direction for any exception.

## Enforce Electron security gates

- Keep `contextIsolation: true`, `nodeIntegration: false`, and renderer sandboxing enabled.
- Expose narrow named capabilities through `contextBridge`; never expose `ipcRenderer`, generic `send(channel, ...)`, Node globals, filesystem primitives, or unrestricted shell access.
- Validate every IPC payload at the main-process boundary and validate or constrain the sender for privileged channels.
- Prefer `ipcRenderer.invoke` with `ipcMain.handle` for request/response work. Use one-way events only when the domain interaction is genuinely one-way. Avoid synchronous IPC.
- Define a restrictive Content Security Policy. Do not disable `webSecurity`, enable insecure content, or load executable remote content with privileged access.
- Restrict navigation and new-window creation. Validate external URLs against an explicit scheme and host allowlist before calling `shell.openExternal`.
- Grant permissions explicitly and minimally. Add a session permission handler when any remote content is loaded.
- Keep Electron current through a deliberate dependency change; never silently upgrade it as part of an unrelated task.

## Implement within the selected layer

1. Reuse existing contracts and public module boundaries before adding new ones.
2. Define or update shared request, response, event, and error types before implementing both sides of IPC.
3. Validate untrusted input at the privileged boundary even when TypeScript types already exist.
4. Keep the main-process handler thin: validate, authorize, call an application service or use case, and translate the result.
5. Keep preload declarative: map a typed capability to a fixed IPC channel and remove listeners with an explicit unsubscribe function.
6. Keep renderer code dependent on the typed preload API, never on transport details.
7. Keep OS and storage details behind adapters so domain and application logic remain testable.
8. Preserve public behavior unless the request explicitly changes it.

## Verify the change

1. Run the narrowest relevant repository scripts using the package manager selected by the lockfile.
2. Run type checking, linting, targeted tests, and the relevant build when those scripts exist. Do not install or replace tooling merely to satisfy this checklist.
3. Exercise both success and failure paths for IPC and privileged operations.
4. Re-read the diff for layer violations, leaked capabilities, missing validation, listener leaks, unsafe URLs, and packaging-only failures.
5. For dependency, toolchain, or runtime changes, report the resolved versions, security and support sources checked, vulnerability-check results, and unresolved findings or verification gaps.
6. For framework-sensitive changes, report the installed Electron version, the official documentation pages checked, the commands run, and any verification gap.

## Handle conflicts and missing evidence

- Ask before introducing a new renderer framework, state library, validation library, persistence engine, packaging tool, native module, or broad architectural migration.
- Prefer a small local type guard when no validation library already exists; do not add a dependency for a trivial schema.
- Mark assumptions clearly when repository evidence is absent.
- Keep changes minimal and scoped. Do not create speculative abstractions or layers that have only one accidental caller.
