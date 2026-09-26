# ACAN3D — Agent Control API

ACAN3D is a web-based 3D creation environment that is **controlled by an external AI agent**
(Z.AI / GLM workspace). The app itself contains **no AI chat** — it is the 3D software. The
agent is the operator.

The agent performs structured, deterministic operations through a validated command router.
Both the in-app UI and the external agent use **the exact same command set** — every button in
the UI is a command call.

---

## 1. Transport

### HTTP (recommended for agents)

```
POST /api/agent/command
Content-Type: application/json

{ "command": "create_object", "params": { "type": "box", "name": "Cube" } }
```

Response (HTTP 200 even on logical errors — inspect body):

```json
{ "ok": true, "result": { "objectId": "obj_abc123", "...": "..." }, "meta": { "durationMs": 34 } }
```

```json
{ "ok": false, "error": "object not found: obj_x", "code": "NOT_FOUND" }
```

Error codes: `VALIDATION`, `NOT_FOUND`, `NOT_IMPLEMENTED`, `EXEC_ERROR`, `NO_CLIENT`, `TIMEOUT`.

`NO_CLIENT` means no ACAN3D browser session is connected to the broker. Open the ACAN3D
website first — commands execute inside that live session.

### Supporting endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/agent/command` | POST | Execute a command in the live ACAN3D session |
| `/api/agent/status` | GET | Broker status + connected sessions |
| `/api/agent/preview/{id}` | GET | Fetch a PNG preview produced by `render_preview` |

Notes:
- Commands execute in the live browser session, so results reflect the real viewport.
- All commands are validated (zod). Malformed params → `VALIDATION` error with details.
- Default per-command timeout: 30 s (`timeoutMs` param supported, max 120000).

---

## 2. Command reference

Every mutating command returns the affected ids so the agent can chain calls.

### Discovery

| Command | Params | Returns |
|---|---|---|
| `list_commands` | – | `{ commands: [{ name, description }] }` |
| `inspect_scene` | `includeGeometry?` | Full scene: objects, hierarchy, transforms, materials, lights, cameras, animation summary, stats |
| `inspect_object` | `objectId` | Detailed object record (transform, material, mesh counts, page meta, keyframes…) |
| `get_stats` | – | fps / triangles / objects |
| `help` | `command?` | Same as list_commands / one command doc |

### Objects

| Command | Params | Returns |
|---|---|---|
| `create_object` | `type`: box\|roundedBox\|sphere\|cylinder\|cone\|torus\|plane\|capsule\|tetrahedron\|octahedron, `name?`, `params?` (per-primitive), `position?`, `rotation?` (rad), `rotationDeg?`, `scale?`, `materialPreset?`, `parentId?` | `{ objectId }` |
| `create_group` | `name?`, `objectIds?` | `{ objectId }` |
| `group_objects` | `objectIds[]`, `name?` | `{ objectId }` (group containing them) |
| `delete_object` | `objectId` or `objectIds[]` | `{ deleted: n }` |
| `duplicate_object` | `objectId`, `count?=1`, `offset?=[x,y,z]` | `{ objectIds }` |
| `select_object` | `objectId` or `objectIds[]`, `additive?` | `{ selection }` |
| `set_transform` | `objectId`, `position?`, `rotation?`, `rotationDeg?`, `scale?`, `space?` | `{ transform }` |
| `rename_object` | `objectId`, `name` | `{}` |
| `set_visibility` | `objectId`, `visible` | `{}` |
| `parent` | `objectId`, `parentId` (null = root) | `{}` |

Units: meters. Y is up. Default camera looks at origin from (6, 5, 7).

### Mesh editing (edit-mode ops on editable meshes)

| Command | Params | Returns |
|---|---|---|
| `create_mesh` | `vertices` [[x,y,z]…], `faces` [[a,b,c]…], `name?`, `position?` | `{ objectId }` |
| `get_mesh` | `objectId` | `{ vertices, faces, uvs }` |
| `set_vertices` | `objectId`, `positions`: [[x,y,z]…] or `{ "i": [x,y,z] }` | `{ updated }` |
| `extrude_faces` | `objectId`, `faceIndices[]`, `distance`, `direction?` | `{}` |
| `inset_faces` | `objectId`, `faceIndices[]`, `amount` (0..1) | `{}` |
| `subdivide` | `objectId`, `iterations?=1` | `{ vertices, faces }` |
| `merge_vertices` | `objectId`, `tolerance?=1e-4` | `{ merged }` |
| `delete_faces` | `objectId`, `faceIndices[]` | `{}` |
| `flip_normals` | `objectId` | `{}` |
| `compute_normals` | `objectId` | `{}` |
| `set_edit_mode` | `objectId` or `null` to exit | `{ active, objectId }` |
| `select_faces` | `objectId`, `faceIndices[]` | `{ faces }` |
| `bevel_edges` | – | **NOT_IMPLEMENTED** (planned) |
| `boolean` | `operation`: union\|subtract\|intersect, `objectIdA`, `objectIdB`, `deleteInputs?` | `{ objectId }` |

Face indices are triangle indices (same order as `faces` in `get_mesh`).

### Materials & textures

| Command | Params | Returns |
|---|---|---|
| `list_material_presets` | – | preset keys + properties |
| `create_material` | `name?`, `preset?`, `props?` { color, roughness, metalness, opacity, emissive, emissiveIntensity, transparent, side } | `{ materialId }` |
| `assign_material` | `objectId` or `objectIds[]`, `materialId` | `{}` |
| `set_material` | `objectId` or `objectIds[]`, `preset?` or `props?` | `{ materialId }` (creates + assigns) |
| `update_material` | `materialId`, `props` | `{}` |
| `create_texture` | `procType`: paper\|ruled_paper\|cardboard\|leather\|wood\|plastic\|brushed_metal\|checker\|grid\|noise\|marble, `name?`, `params?`, `size?` | `{ textureId }` |
| `create_texture_from_image` | `name`, `dataUrl` or `url` | `{ textureId }` |
| `assign_texture` | `textureId`, `materialId` or `objectId`, `slot`: map\|normalMap\|roughnessMap, `repeat?: [x,y]` | `{}` |

Presets: `paper`, `cardboard`, `leather`, `plastic`, `wood`, `metal`, `glass`, `rubber`, `fabric`.

### Lights / cameras / environment

| Command | Params | Returns |
|---|---|---|
| `create_light` | `lightType`: ambient\|hemisphere\|directional\|point\|spot, `name?`, `color?`, `intensity?`, `position?`, `castShadow?`, `angle?`, `penumbra?`, `distance?` | `{ objectId }` |
| `update_light` | `objectId`, `color?`, `intensity?`, `castShadow?`, `position?`, `angle?`, `penumbra?` | `{}` |
| `create_camera` | `cameraType`: perspective\|orthographic, `name?`, `position?`, `lookAt?`, `fov?` | `{ objectId }` |
| `update_camera` | `objectId`, `fov?`, `zoom?`, `position?`, `lookAt?` | `{}` |
| `set_active_camera` | `objectId` or `null` (viewport default) | `{}` |
| `set_viewport_camera` | `preset`: front\|back\|left\|right\|top\|bottom\|iso, `fitObject?` | `{}` |
| `set_environment` | `background?`, `backgroundColor?`, `ground?`, `groundColor?`, `envIntensity?` | `{}` |

### Animation

| Command | Params | Returns |
|---|---|---|
| `set_animation_settings` | `fps?`, `start?`, `end?`, `loop?` | `{}` |
| `set_keyframe` | `objectId`, `channel`: position\|rotation\|scale, `frame?` (default current), `easing?` | `{ trackId }` |
| `add_keyframe` | `objectId`, `channel`, `frame`, `value`, `easing?` | `{ trackId }` |
| `update_keyframe` | `trackId`, `index`, `frame?`, `value?`, `easing?` | `{}` |
| `delete_keyframe` | `trackId`, `index` or `frame` | `{}` |
| `remove_track` | `trackId` | `{}` |
| `clear_animation` | `objectId?` | `{}` |
| `create_page_turn` | `objectId` (page mesh), `startFrame?`, `endFrame?`, `direction?` 1\|-1, `curvature?`, `easing?` | `{ trackId }` |
| `create_book_open` | `objectId` (book group), `startFrame?`, `endFrame?`, `angleDeg?` (default 180), `easing?` | `{ trackId }` |
| `play_animation` | `from?`, `to?` | `{}` |
| `pause_animation` | – | `{}` |
| `stop_animation` | – | `{}` (pause + frame 0) |
| `set_frame` | `frame` | `{}` |
| `inspect_animation` | – | tracks detail |

Easing: `linear`, `easeIn`, `easeOut`, `easeInOut`, `step`.

### Procedural generators

| Command | Params | Returns |
|---|---|---|
| `create_book` | `name?`, `pageCount?=200`, `pageWidth?=0.15`, `pageHeight?=0.21`, `pageThickness?=0.0004`, `pageGap?=0.0002`, `coverThickness?=0.003`, `coverOverhang?=0.004`, `corner?=0.002`, `coverColor?`, `spineColor?`, `paperColor?`, `paperTexture?` (procType), `coverMaterialPreset?=cardboard`, `position?`, `rotationDeg?`, `scale?`, `generateMaterials?=true` | `{ groupId, coverFrontId, coverBackId, spineId, pageIds[], materialIds }` |
| `create_paper_stack` | `name?`, `count?=20`, `width?=0.21`, `height?=0.297`, `sheetThickness?=0.001`, `jitter?=0.002`, `rotationJitterDeg?=2`, `color?`, `position?` | `{ groupId, pageIds[] }` |

`create_book` builds a real, editable hierarchy: group → cover pivots (for opening animation),
spine, and **individual page meshes** with bendable geometry (segments along the page width).
`create_page_turn` can then animate any page. `create_book_open` rotates the cover pivots.

### Viewport / render / project

| Command | Params | Returns |
|---|---|---|
| `render_preview` | `width?=1024`, `height?=1024`, `cameraId?`, `transparent?`, `shading?`, `frame?` | `{ dataUrl, previewUrl, width, height }` — dataUrl is a PNG data URL; `previewUrl` fetchable at `/api/agent/preview/{id}` |
| `set_shading` | `mode`: solid\|material\|wireframe | `{}` |
| `set_grid` / `set_axes` | `visible` | `{}` |
| `set_snap` | `enabled?`, `translate?`, `rotateDeg?` | `{}` |
| `set_gizmo` | `mode`: translate\|rotate\|scale, `space?` | `{}` |
| `frame_object` | `objectId?` (default selection) | `{}` |
| `save_project` | `name?` | `{ projectId, name }` (server-side, Prisma) |
| `list_projects` | – | `{ projects: [{ id, name, updatedAt }] }` |
| `load_project` | `projectId` | `{ objects: n }` |
| `new_project` | – | `{}` |
| `export_scene` | `format`: gltf\|glb\|obj | `{ downloadUrl, format }` |
| `undo` / `redo` | – | `{}` |

---

## 3. Typical agent workflow

```
Build → inspect_scene → render_preview → fetch preview PNG → analyze → modify → repeat
```

Example — 54-page notebook with cover, materials, camera, page-turn:

```jsonc
// 1. book
POST /api/agent/command { "command": "create_book", "params": {
  "pageCount": 54, "pageWidth": 0.15, "pageHeight": 0.21,
  "pageThickness": 0.0004, "coverThickness": 0.003,
  "coverColor": "#7a3b2e", "coverMaterialPreset": "leather", "paperTexture": "paper" } }

// 2. response: { ok: true, result: { groupId, coverFrontId, coverBackId, spineId, pageIds: [...] } }

// 3. open + turn pages
{ "command": "create_book_open", "params": { "objectId": "<groupId>", "startFrame": 0, "endFrame": 60 } }
{ "command": "create_page_turn", "params": { "objectId": "<pageIds[53]>", "startFrame": 70, "endFrame": 100, "curvature": 0.6 } }

// 4. play + look
{ "command": "play_animation" }
{ "command": "render_preview", "params": { "width": 1024, "height": 768 } }
```

## 4. Design rules

- Deterministic, validated, documented, extensible. Unknown command → `VALIDATION`.
- Never dependent on mouse coordinates; everything is id-based.
- Features that are planned but not implemented respond `NOT_IMPLEMENTED` — the UI marks them clearly too.
- Scene/project data is serializable (JSON) and independent of GitHub (projects live in the app DB).
