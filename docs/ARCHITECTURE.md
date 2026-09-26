# ACAN3D — Architecture

## Principles

1. **One mutation path.** Every change to the 3D scene — from a UI button or from the
   external agent — goes through the same validated `CommandRouter`. This guarantees the
   agent can do anything the UI can do, and vice versa, with identical semantics.
2. **Imperative engine, reactive UI.** three.js is owned by an imperative `Engine` class.
   React never touches three.js objects; the engine pushes a serializable mirror of its
   state into a zustand store that the UI reads.
3. **Serializable everything.** Objects, materials, textures, animation tracks and the
   environment serialize to a stable JSON project format (see `src/lib/engine/types.ts`).
4. **No fake UI.** Buttons either execute a real command or are marked planned
   (`NOT_IMPLEMENTED`), e.g. `bevel_edges`.

## Module map

```
src/
├── app/
│   ├── page.tsx                        # mounts the editor (client-only)
│   └── api/
│       ├── agent/command/route.ts      # POST → broker → live browser session
│       ├── agent/status/route.ts       # broker status + sessions
│       ├── agent/preview/[id]/route.ts # fetch PNGs produced by render_preview
│       ├── agent/export/[id]/route.ts  # fetch GLTF/GLB/OBJ exports
│       └── projects/…                  # saved projects (Prisma + SQLite)
├── components/editor/                  # UI layer (reads store, calls runCommand)
│   ├── EditorShell.tsx                 # layout root (topbar/viewport/panel/timeline)
│   ├── ViewportCanvas.tsx              # mounts the engine into a div
│   ├── TopBar.tsx  Outliner.tsx  PropertiesPanel.tsx  Timeline.tsx
│   ├── MaterialsTab.tsx  MobilePanel.tsx  StatusBar.tsx  Toasts.tsx
│   └── shared.tsx                      # shared fields, dialogs, helpers
└── lib/engine/
    ├── types.ts                        # contract types (shared with agent docs)
    ├── store.ts                        # zustand UI mirror + runCommand()
    ├── engineAPI.ts                    # engine singleton facade
    ├── Engine.ts                       # renderer, cameras, controls, selection,
    │                                   # gizmos, shading, edit overlays, playback,
    │                                   # preview capture, undo/redo, registries
    ├── commands/router.ts              # CommandRouter (zod-validated, ~60 commands)
    ├── geometry/editable.ts            # extrude / inset / subdivide / merge / delete
    ├── procedural/
    │   ├── shapes.ts                   # 10 parametric primitives
    │   ├── pageGeom.ts                 # bendable page slab geometry (rounded fore-edge)
    │   ├── book.ts                     # hardcover book generator (cover pivots + pages)
    │   └── paperStack.ts               # jittered paper stack generator
    ├── materials/
    │   ├── library.ts                  # presets + MaterialDef → MeshPhysicalMaterial
    │   └── textures.ts                 # 11 procedural canvas textures (seeded PRNG)
    ├── animation/
    │   ├── pageTurn.ts                 # page deformation math (trail lag + curl)
    │   └── evaluator.ts                # track evaluation (transform/pageTurn/bookOpen)
    ├── project/serialize.ts            # ProjectData ⇄ engine
    ├── export/exporters.ts             # GLTF / GLB / OBJ
    ├── io/gltfImport.ts                # GLTF/GLB import
    └── bridge/AgentBridge.ts           # socket.io client for the broker
mini-services/agent-broker/index.ts     # HTTP ⇄ socket.io broker (:3030)
docs/                                   # AGENT_API.md, ARCHITECTURE.md, ROADMAP.md
```

## Data flow

### UI action
```
Button click → runCommand(name, params) → engineAPI.execute()
  → CommandRouter (zod validate → handler) → Engine mutation → store sync → React re-render
```

### External agent
```
POST /api/agent/command {command, params, sessionId?}
  → Next route → agent-broker (:3030) → socket.io 'agent:command'
  → live browser session (AgentBridge) → CommandRouter → Engine
  → 'studio:result' back through the broker → HTTP response (JSON)
```

If several browser sessions are open, the broker routes to the most recently active one;
pass an explicit `sessionId` (see `GET /api/agent/status`) to pin a target.

### render_preview
The engine re-renders offscreen at the requested size with helpers hidden, captures the
WebGL canvas as a PNG data URL, uploads it to the broker (`studio:preview`) and returns
both the inline dataUrl and a stable `previewUrl` (`/api/agent/preview/{id}`).

## Engine conventions

- Every registered `THREE.Object3D` carries `userData.acan = {id, type, name, kind, …}`.
  The `objectMap: Map<id, Object3D>` is the source of truth for inspection and picking.
- Lights and cameras are scene objects too (inspectable, transformable, animatable).
- Procedural meshes carry metadata: pages have `userData.acan.pageMeta`; book groups have
  `generator: 'book'`; cover pivots have `kind: 'coverFrontPivot' | 'coverBackPivot'`.
- Page geometry caches its rest pose in `geometry.userData.restPositions`; the page-turn
  deformation is non-destructive and always recomputed from rest.
- Undo/redo snapshots are serialized project JSON (capped at 25).
- Autosave: every 45 s and on unload → `localStorage['acan3d.autosave']`.

## Animation model

- `SceneAnim {fps, start, end, current, playing, loop, tracks[]}`.
- `TransformTrack` — eased key interpolation per channel; per-key easing
  (`linear | easeIn | easeOut | easeInOut | step`).
- `PageTurnTrack` — procedural: maps frame → θ∈[0,π] (rotation about the spine axis) with
  easing, then deforms every vertex: per-vertex angle φ(u) = θ − dir·c·sin θ·u^1.6 with a
  small radius relaxation, recomputed from the rest pose. Gives trail lag + curl + settle.
- `BookOpenTrack` — rotates the book's front-cover pivot about the spine (z axis).

## Broker protocol (mini-services/agent-broker)

| Event | Direction | Payload |
|---|---|---|
| `studio:register` | browser→broker | `{sessionId, info}` |
| `agent:command` | broker→browser | `{commandId, command, params}` |
| `studio:result` | browser→broker | `{commandId, ok, result?|error, code?}` |
| `studio:preview` | browser→broker | `{previewId, dataUrl}` |
| `studio:export` | browser→broker | `{exportId, name, mime, base64}` |
| `agent:heartbeat` / `studio:heartbeat` | both | keep-alive / lastSeen |

Previews and exports are kept in a bounded in-memory ring (24 entries each).
