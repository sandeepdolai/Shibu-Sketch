# ACAN3D — Status & Roadmap

Honest status: every command listed in `docs/AGENT_API.md` either works or returns
`NOT_IMPLEMENTED` (currently: `bevel_edges`).

## Working now (v0.1.0)

- Viewport: orbit/pan/zoom (mouse + touch), perspective/orthographic toggle, camera
  presets, frame-selected, grid/axes toggles, three shading modes, anti-aliased
  shadowed rendering, ACES tone mapping, environment lighting.
- Selection: click, shift-multi, outliner multi, box highlights, transform gizmos with
  world/local space + snapping (translate/rotate/scale), auto-key on gizmo release.
- Objects: 10 primitives (parametric), groups, parenting, duplicate, rename, visibility,
  lock, cascade delete.
- Mesh editing: create custom meshes, get/set vertices, face selection in edit mode,
  extrude, inset (individual), subdivide (1–4 iterations), merge vertices, delete faces,
  flip/recompute normals.
- Booleans: union / subtract / intersect (three-bvh-csg), optional input deletion.
- Materials: PBR presets ×9, custom properties, per-slot textures (map/normalMap/
  roughnessMap) with repeat; textures: 11 procedural generators + image import.
- Lights: ambient/hemisphere/directional/point/spot, shadows, editable color/intensity/
  position.
- Cameras: perspective + orthographic scene cameras, `render_preview` through any camera.
- Animation: keyframes (position/rotation/scale, eased), timeline scrubbing, playback with
  loop, auto-key, procedural page-turn (curl + trail lag), book-open track.
- Procedural: `create_book` (hardcover, cover pivots, spine, per-page bendable geometry,
  rounded fore-edge, page striations), `create_paper_stack`.
- Projects: JSON format, server save/load/list (Prisma + SQLite), localStorage autosave,
  GLTF/GLB/OBJ export, GLTF/GLB import.
- Agent: 60+ validated commands, HTTP transport, session broker, PNG previews,
  downloadable exports, full scene/object/animation inspection.

## Planned (next milestones, in priority order)

1. `bevel_edges` — vertex/edge chamfer on indexed meshes.
2. Edge + vertex selection modes in edit UI (currently face-focused).
3. Loop cut / knife-style edge insertion.
4. Material slots per face group (multi-material meshes).
5. Texture painting / UV editing tools.
6. Animation: quaternion rotation keys, nested procedural tracks (page curls driven by
   curves), audio-free video export (WebM via MediaRecorder or frame sequence).
7. Environment: HDRI loading, soft contact shadows, ground plane material options.
8. Performance: instanced page rendering for 500+ page books, LOD for edit overlays.
9. Collaboration: project sharing URLs, read-only embeds.
10. WebGPU renderer backend (three.js WebGPURenderer) behind a flag.
