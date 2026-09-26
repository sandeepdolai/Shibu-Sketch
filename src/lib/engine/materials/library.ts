/**
 * ACAN3D — Material presets & MaterialDef -> THREE.MeshPhysicalMaterial bridge.
 *
 * The engine stores materials as serializable MaterialDefs (types.ts); this
 * module knows how to turn them into real MeshPhysicalMaterials, including
 * per-material cloned texture maps (so texture repeat stays per-material).
 */
import * as THREE from 'three';
import type { MaterialDef, MaterialSlot } from '../types';

export interface MaterialPreset {
  key: string;
  label: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  side: 'front' | 'back' | 'double';
  /** procedural texture type suggested for this preset (see textures.ts) */
  suggestTexture?: string;
}

export const MATERIAL_PRESETS: Record<string, MaterialPreset> = {
  paper: {
    key: 'paper', label: 'Paper', color: '#f5f1e6', roughness: 0.92, metalness: 0,
    opacity: 1, transparent: false, side: 'front', suggestTexture: 'paper',
  },
  cardboard: {
    key: 'cardboard', label: 'Cardboard', color: '#b79675', roughness: 0.9, metalness: 0,
    opacity: 1, transparent: false, side: 'front', suggestTexture: 'cardboard',
  },
  leather: {
    key: 'leather', label: 'Leather', color: '#7a3b2e', roughness: 0.65, metalness: 0,
    opacity: 1, transparent: false, side: 'front', suggestTexture: 'leather',
  },
  plastic: {
    key: 'plastic', label: 'Plastic', color: '#e8e8e8', roughness: 0.35, metalness: 0,
    opacity: 1, transparent: false, side: 'front',
  },
  wood: {
    key: 'wood', label: 'Wood', color: '#8a5a33', roughness: 0.7, metalness: 0,
    opacity: 1, transparent: false, side: 'front', suggestTexture: 'wood',
  },
  metal: {
    key: 'metal', label: 'Metal', color: '#c0c0c8', roughness: 0.25, metalness: 0.9,
    opacity: 1, transparent: false, side: 'front', suggestTexture: 'brushed_metal',
  },
  glass: {
    key: 'glass', label: 'Glass', color: '#dfe9e7', roughness: 0.08, metalness: 0,
    opacity: 0.25, transparent: true, side: 'front',
  },
  rubber: {
    key: 'rubber', label: 'Rubber', color: '#2b2b2e', roughness: 0.95, metalness: 0,
    opacity: 1, transparent: false, side: 'front',
  },
  fabric: {
    key: 'fabric', label: 'Fabric', color: '#8d7f6f', roughness: 0.95, metalness: 0,
    opacity: 1, transparent: false, side: 'front',
  },
};

/** Neutral gray, plastic-like default when no preset is given. */
const NEUTRAL: MaterialPreset = {
  key: 'neutral', label: 'Neutral', color: '#b9b9bd', roughness: 0.5, metalness: 0.02,
  opacity: 1, transparent: false, side: 'front',
};

const SLOTS: MaterialSlot[] = ['map', 'normalMap', 'roughnessMap'];

function sideToThree(side: MaterialPreset['side'] | MaterialDef['side']): THREE.Side {
  if (side === 'back') return THREE.BackSide;
  if (side === 'double') return THREE.DoubleSide;
  return THREE.FrontSide;
}

/** Build a serializable MaterialDef from a preset key (neutral when omitted/unknown). */
export function defaultMaterialDef(id: string, name: string, preset?: string): MaterialDef {
  const p = (preset && MATERIAL_PRESETS[preset]) || NEUTRAL;
  const def: MaterialDef = {
    id,
    name,
    color: p.color,
    roughness: p.roughness,
    metalness: p.metalness,
    opacity: p.opacity,
    emissive: '#000000',
    emissiveIntensity: 0,
    transparent: p.transparent,
    side: p.side,
  };
  if (preset && MATERIAL_PRESETS[preset]) def.preset = p.key;
  return def;
}

/**
 * Apply a MaterialDef onto a MeshPhysicalMaterial.
 * Texture maps are CLONED from textureMap so repeat is per-material.
 * map gets SRGBColorSpace; normal/roughness maps stay linear.
 */
export function applyMaterialProps(
  mat: THREE.MeshPhysicalMaterial,
  def: MaterialDef,
  textureMap: Map<string, THREE.Texture>,
): void {
  mat.color.set(def.color);
  mat.emissive.set(def.emissive);
  mat.emissiveIntensity = def.emissiveIntensity;
  mat.roughness = Math.min(1, Math.max(0, def.roughness));
  mat.metalness = Math.min(1, Math.max(0, def.metalness));

  const opacity = Math.min(1, Math.max(0, def.opacity));
  mat.opacity = opacity;
  mat.transparent = def.transparent || opacity < 1;
  // transparent + see-through -> no depth write; opaque -> depth write
  mat.depthWrite = !(mat.transparent && opacity < 1);
  mat.side = sideToThree(def.side);

  const repeat = def.textureRepeat ?? [1, 1];

  for (const slot of SLOTS) {
    const texId = def.maps?.[slot];
    const source = texId ? textureMap.get(texId) : undefined;
    if (source) {
      const tex = source.clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      if (slot === 'map') {
        tex.colorSpace = THREE.SRGBColorSpace;
      } else {
        tex.colorSpace = THREE.NoColorSpace;
      }
      tex.needsUpdate = true;
      mat[slot] = tex;
    } else {
      mat[slot] = null;
    }
  }

  mat.needsUpdate = true;
}

/** Small per-preset physical extras (clearcoat / sheen). */
function applyPresetExtras(mat: THREE.MeshPhysicalMaterial, preset?: string): void {
  switch (preset) {
    case 'leather':
      mat.clearcoat = 0.3;
      mat.clearcoatRoughness = 0.5;
      break;
    case 'plastic':
      mat.clearcoat = 0.8;
      mat.clearcoatRoughness = 0.25;
      break;
    case 'fabric':
      mat.sheen = 0.5;
      mat.sheenRoughness = 0.8;
      break;
    default:
      break;
  }
}

/** Create a MeshPhysicalMaterial from a MaterialDef (then apply props + preset extras). */
export function makeThreeMaterial(
  def: MaterialDef,
  textureMap: Map<string, THREE.Texture>,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial();
  applyMaterialProps(mat, def, textureMap);
  applyPresetExtras(mat, def.preset);
  return mat;
}
