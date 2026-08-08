# Electron documentation requirements

Use this reference for version-sensitive Electron APIs, security settings, IPC, permissions, protocols, packaging, signing, updating, and framework documentation.

## Source order

1. Read the installed version from `package.json` and the lockfile. Distinguish the declared range from the resolved version.
2. Search or open Electron's official documentation at `https://www.electronjs.org/docs/latest/`.
3. Verify the API's process label, signature, defaults, platform notes, return type, lifecycle timing, security warnings, and version history.
4. Check `https://www.electronjs.org/docs/latest/breaking-changes` when the code, installed version, and current docs may differ.
5. Consult the official documentation of the repository's chosen packaging tool after Electron's own distribution guidance.
6. Use Chromium, Node.js, TypeScript, or OS-vendor primary documentation only for behavior Electron delegates to those platforms.

Do not rely on search snippets, blog posts, Stack Overflow answers, generated examples, or memory when an official source is available. Open the supporting page. Do not assume `/docs/latest/` matches the installed major version; reconcile differences explicitly.

## Required Electron pages

- Process ownership and preload: `https://www.electronjs.org/docs/latest/tutorial/process-model`
- Context isolation: `https://www.electronjs.org/docs/latest/tutorial/context-isolation`
- IPC patterns: `https://www.electronjs.org/docs/latest/tutorial/ipc`
- Security checklist: `https://www.electronjs.org/docs/latest/tutorial/security`
- Process sandboxing: `https://www.electronjs.org/docs/latest/tutorial/sandbox`
- `contextBridge`: `https://www.electronjs.org/docs/latest/api/context-bridge`
- `ipcMain`: `https://www.electronjs.org/docs/latest/api/ipc-main`
- `BrowserWindow`: `https://www.electronjs.org/docs/latest/api/browser-window`
- Session permissions: `https://www.electronjs.org/docs/latest/api/session`
- Application packaging: `https://www.electronjs.org/docs/latest/tutorial/application-distribution`
- Breaking changes: `https://www.electronjs.org/docs/latest/breaking-changes`

Open only the pages relevant to the change. For security-sensitive window or IPC changes, always open the security checklist in addition to the API page.

## Documentation-to-code workflow

Before coding:

1. Record the resolved Electron version.
2. Identify which process owns the API.
3. Confirm whether the API is available in that version and whether a default changed across versions.
4. Capture security and lifecycle prerequisites.
5. Adapt official JavaScript examples to the repository's TypeScript and module system; do not copy them mechanically.

While coding:

- Use the exact current option and event names.
- Preserve platform-specific branches where the API requires them.
- Represent nullable, cancellable, and destroyed-object states in code.
- Keep documentation links out of routine comments. Add a link only when a non-obvious workaround, version guard, or security decision would otherwise be easy to undo.

After coding:

- Recheck the final configuration against the security checklist.
- Run the repository's typecheck and relevant Electron build or test.
- Include the official pages consulted in the handoff for version-sensitive or security-sensitive decisions.
- State any mismatch between the installed version and `/docs/latest/`, plus how it was resolved.

## Framework baselines

Treat these as required unless an explicit, reviewed exception exists:

- Keep `nodeIntegration` disabled for renderer content.
- Keep context isolation and renderer sandboxing enabled.
- Expose capability-specific preload methods through `contextBridge`; do not expose the whole `ipcRenderer` object.
- Use structured-clone-compatible IPC data and runtime validation.
- Validate privileged IPC senders.
- Use a restrictive CSP and secure protocols.
- Restrict navigation, new windows, external URLs, and permission requests.
- Prefer a constrained custom protocol over `file://` for packaged privileged content when the chosen toolchain supports it.
- Evaluate Electron fuses as part of production packaging and record the security-impacting choices.
- Keep Electron and dependencies current through deliberate, reviewed upgrades.
- Prefer Electron Forge for a new packaging setup when the repository has no packaging choice, because Electron's official packaging guide recommends it. Ask before adopting it.

## Review output

For an Electron framework review, report findings in this order:

1. Security or privilege-boundary violations.
2. Incorrect process ownership or layer direction.
3. Installed-version or API-documentation mismatch.
4. Lifecycle, cleanup, and platform defects.
5. IPC contract and runtime-validation gaps.
6. Build, packaging, signing, update, and test gaps.

Attach the exact official page for each framework-specific finding. Separate a documented requirement from a project preference.
