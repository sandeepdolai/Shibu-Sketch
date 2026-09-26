# ACAN3D

**AI-Controllable Web-Based 3D Software**

ACAN3D is a browser-based 3D creation and animation environment. It is *the 3D software* —
an external AI agent (Z.AI / GLM workspace) is the operator that drives it through a
structured, validated command API. The app itself contains **no AI chat, no prompt box, no
text-to-3D API** — everything is built with real modeling, procedural and animation tools.

```
Z.AI / GLM Agent
      ↓  (POST /api/agent/command)
ACAN3D Agent Control Interface  ── agent-broker (socket.io, :3030)
      ↓
ACAN3D 3D Editor (Next.js + React UI)
      ↓  (CommandRouter — same path the UI uses)
3D Scene (three.js)
      ↓
WebGL Renderer
```

## Highlights

- **Real 3D editor** — orbit/pan/zoom, perspective + orthographic cameras, object & face
  selection, transform gizmos (move/rotate/scale, snapping), grid + axes, solid / material /
  wireframe shading, undo/redo.
- **Real modeling tools** — create custom meshes; extrude faces, inset faces, subdivide,
  merge vertices, delete faces, flip/recompute normals, move vertices; **CSG booleans**
  (union / subtract / intersect) via `three-bvh-csg`.
- **Procedural systems** — `create_book` (hardcover book generator: cover pivots, spine,
  individual bendable pages), `create_paper_stack`, 10 parametric primitives.
- **Materials & textures** — PBR (`MeshPhysicalMaterial`) with 9 presets (paper, cardboard,
  leather, plastic, wood, metal, glass, rubber, fabric), 11 procedural canvas textures,
  image textures, per-slot assignment (map / normalMap / roughnessMap) with repeat.
- **Lighting & cameras** — ambient / hemisphere / directional / point / spot lights with
  shadows; scene cameras (perspective + orthographic); viewport camera presets.
- **Animation** — keyframe tracks (position / rotation / scale with easing), a **procedural
  page-turn track** (physics-inspired paper deformation: trail lag + curl), a book-open
  track, timeline with scrubbing, loop, auto-key, fps control.
- **Projects** — serializable JSON project format, server-side save/load (SQLite via
  Prisma), autosave to localStorage, **GLTF / GLB / OBJ export**, GLTF/GLB import.
- **Agent control** — every UI action is a command; the external agent executes the exact
  same commands over HTTP (`POST /api/agent/command`), can inspect the full scene state and
  request PNG previews (`render_preview`) for a build → preview → inspect → fix loop.
- **Mobile-first UI** — responsive layout, touch gestures, bottom-sheet panels, 44px touch
  targets; desktop gets docked panels and a timeline.

## Quick start

```bash
bun install
bun run db:push          # SQLite (projects)
bun run dev              # Next.js on :3000 (dev server)

# agent broker (separate terminal)
cd mini-services/agent-broker && bun install && bun run dev   # :3030
```

Open the app, then drive it from a terminal:

```bash
curl -X POST http://localhost:3000/api/agent/command \
  -H "Content-Type: application/json" \
  -d '{"command":"create_book","params":{"pageCount":54,"coverColor":"#7a3b2e"}}'
```

## The 54-page notebook test

```bash
# 1. generate the book (54 pages, leather cover, paper texture)
{"command":"create_book","params":{"pageCount":54,"pageThickness":0.0004,"coverMaterialPreset":"leather","paperTexture":"paper"}}

# 2. animate: open the cover, then turn pages
{"command":"create_book_open","params":{"objectId":"<groupId>","startFrame":0,"endFrame":60,"angleDeg":178}}
{"command":"create_page_turn","params":{"objectId":"<pageId>","startFrame":70,"endFrame":86,"curvature":0.65}}
{"command":"play_animation"}

# 3. look at it
{"command":"render_preview","params":{"width":1024,"height":768}}
# → fetch /api/agent/preview/<id> for the PNG
```

## Documentation

- [`docs/AGENT_API.md`](docs/AGENT_API.md) — full command reference (the agent contract)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map and data flow
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what works, what is planned (honest status)

## Repository

https://github.com/sandeepdolai/acan3d
