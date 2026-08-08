# Project architecture

Use this reference for file placement, dependency direction, new features, cross-process work, and architecture reviews.

## Default source layout

Adopt this layout only when the repository has not established another coherent layout:

```text
src/
  main/
    bootstrap/          # app lifecycle and composition root
    windows/            # BrowserWindow factories and window policy
    ipc/                # channel registration and boundary adapters
    application/        # privileged use cases and orchestration
    domain/             # desktop-domain rules without Electron imports
    infrastructure/     # filesystem, persistence, OS and network adapters
  preload/
    index.ts             # contextBridge composition only
    capabilities/       # narrow renderer-facing APIs
  renderer/
    app/                 # renderer composition, routes and global providers
    features/            # feature-first UI modules such as canvas or documents
    shared/              # renderer-only components, hooks and utilities
  shared/
    contracts/           # serializable IPC request/result/event contracts
    domain/              # truly process-neutral value objects and rules
```

Keep build output outside `src/`. Keep main, preload, and renderer entry points explicit in build configuration.

## Dependency rules

| Area | May depend on | Must not depend on |
| --- | --- | --- |
| `shared/domain` | process-neutral TypeScript | Electron, Node, DOM, renderer frameworks |
| `shared/contracts` | shared domain and serializable types | Electron events, functions, classes, DOM objects |
| `main/domain` | shared domain | Electron, concrete storage or UI |
| `main/application` | main domain, contracts, adapter interfaces | renderer implementation |
| `main/infrastructure` | Electron/Node APIs and adapter interfaces | renderer implementation |
| `main/ipc` | contracts, validation, application use cases | renderer components or direct business rules |
| `preload` | fixed contracts and `electron/renderer` | business logic, storage, generic channel forwarding |
| `renderer/features` | typed preload API, renderer shared code, contracts | Node, Electron, main or infrastructure modules |

Import through a layer's public entry point when one exists. Do not deep-import another feature's internals. Extract shared code only after a stable shared responsibility appears.

## Process ownership

### Main process

Own application lifecycle, window creation, native menus, trays, dialogs, shortcuts, OS integration, filesystem access, secure storage, app-level persistence, updater coordination, and privileged network operations.

Keep the bootstrap layer as a composition root. Construct dependencies there instead of importing global singletons throughout the application. Make window factories responsible for secure `webPreferences`, navigation policy, and cleanup.

### Preload

Treat preload as a public security boundary, not a utility layer. Expose a small stable API organized by user-facing capabilities, for example `window.desktop.documents.open()` rather than `window.electron.invoke(channel, payload)`.

Keep channel strings private to preload and main IPC adapters. Return an unsubscribe function for every renderer subscription. Never pass the Electron event object into renderer callbacks.

### Renderer

Own presentation, canvas drawing, pointer and keyboard interactions, local view state, and web-compatible computation. Organize renderer code feature-first. Inside a larger feature, separate UI components, view-model or state logic, and pure domain operations only when the separation pays for itself.

Do not treat the renderer store as authoritative for persisted or privileged state. Request those operations through the preload API and handle pending, success, cancellation, and failure explicitly.

### Utility process

Use a utility process for measured CPU-heavy drawing exports, parsing, encoding, untrusted services, or crash-prone work that would block or destabilize the main process. Define lifecycle, cancellation, timeout, failure recovery, and message types before adding it. Do not introduce a utility process for ordinary asynchronous I/O.

## IPC contract design

Define channels by domain and action, such as `document:open` or `export:png`. Keep the identifier stable and private to the transport layer.

For each request/response operation, define:

```ts
type OpenDocumentRequest = Readonly<{ path: string }>

type OpenDocumentResult =
  | Readonly<{ ok: true; document: SerializedDocument }>
  | Readonly<{ ok: false; error: DesktopError }>
```

Use plain structured-clone-compatible data. Do not send functions, Electron objects, DOM nodes, class instances with behavior, raw `Error` objects, or large mutable graphs. Prefer identifiers or bounded byte arrays for large resources; use `MessagePort` or streaming only after measuring a need.

Validate the runtime payload before calling the use case. Authorize the sender for privileged actions. Translate infrastructure errors into a small stable error vocabulary without leaking absolute paths, tokens, stack traces, or OS internals to the renderer.

## Feature workflow

For a cross-process feature:

1. Define the user-visible capability and process owner.
2. Define shared serializable contracts.
3. Implement and unit-test domain/application behavior.
4. Implement the infrastructure adapter.
5. Register a thin validated main IPC adapter.
6. Expose a narrow typed preload method.
7. Consume it from the renderer feature with explicit UI states.
8. Add integration coverage for the bridge and cleanup behavior.

Avoid creating repository, service, manager, controller, and facade layers for a single trivial operation. Add a boundary when it protects process isolation, external I/O, domain rules, or testability.
