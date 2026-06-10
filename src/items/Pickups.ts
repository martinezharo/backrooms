// Items lying in the world: spawned from chunk data, bobbing glow indicator,
// E to pick up, G drops the equipped item back into the world.

import * as THREE from 'three';
import { CHUNK } from '../core/constants';
import { World } from '../world/World';
import { ChunkData } from '../world/Chunk';
import { buildItemMesh } from './ItemMeshes';
import { ItemInstance, makeItem } from './Items';

export interface Pickup {
  item: ItemInstance;
  mesh: THREE.Group;
  glow: THREE.Mesh;
  x: number; y: number; z: number;
  spawnId: string | null; // null for player-dropped items
  phase: number;
}

interface StoredDrop { item: ItemInstance; x: number; y: number; z: number; }

let glowGeo: THREE.RingGeometry | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;

function makeGlow(): THREE.Mesh {
  glowGeo ??= new THREE.RingGeometry(0.18, 0.3, 24);
  glowMat ??= new THREE.MeshBasicMaterial({
    color: 0xfff0a8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(glowGeo, glowMat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export class Pickups {
  private scene: THREE.Scene;
  private pickups: Pickup[] = [];
  private consumed = new Set<string>();          // spawn ids already taken
  private droppedByChunk = new Map<string, StoredDrop[]>(); // survive chunk unload

  constructor(scene: THREE.Scene, world: World) {
    this.scene = scene;
    const prevLoaded = world.onChunkLoaded;
    const prevUnloaded = world.onChunkUnloaded;
    world.onChunkLoaded = (c) => { prevLoaded?.(c); this.chunkLoaded(c); };
    world.onChunkUnloaded = (c) => { prevUnloaded?.(c); this.chunkUnloaded(c); };
  }

  private chunkKey(x: number, z: number): string {
    return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  }

  private chunkLoaded(c: ChunkData): void {
    for (const s of c.itemSpawns) {
      if (this.consumed.has(s.id)) continue;
      this.place(makeItem(s.itemId), s.x, s.y, s.z, s.id);
    }
    const key = `${c.cx},${c.cz}`;
    const drops = this.droppedByChunk.get(key);
    if (drops) {
      for (const d of drops) this.place(d.item, d.x, d.y, d.z, null);
      this.droppedByChunk.delete(key);
    }
  }

  private chunkUnloaded(c: ChunkData): void {
    const key = `${c.cx},${c.cz}`;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (this.chunkKey(p.x, p.z) !== key) continue;
      if (p.spawnId === null) {
        const list = this.droppedByChunk.get(key) ?? [];
        list.push({ item: p.item, x: p.x, y: p.y, z: p.z });
        this.droppedByChunk.set(key, list);
      }
      this.removeMesh(p);
      this.pickups.splice(i, 1);
    }
  }

  private place(item: ItemInstance, x: number, y: number, z: number, spawnId: string | null): void {
    const mesh = buildItemMesh(item.def.id);
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const glow = makeGlow();
    glow.position.set(x, y - 0.1, z);
    this.scene.add(mesh, glow);
    this.pickups.push({ item, mesh, glow, x, y, z, spawnId, phase: Math.random() * 10 });
  }

  private removeMesh(p: Pickup): void {
    this.scene.remove(p.mesh, p.glow);
    p.mesh.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }

  drop(item: ItemInstance, pos: THREE.Vector3): void {
    this.place(item, pos.x, pos.y + 0.16, pos.z, null);
  }

  nearest(pos: THREE.Vector3, maxDist: number): Pickup | null {
    let best: Pickup | null = null;
    let bestD = maxDist * maxDist;
    for (const p of this.pickups) {
      const dx = p.x - pos.x;
      const dy = p.y - pos.y;
      const dz = p.z - pos.z;
      const d = dx * dx + dy * dy * 0.5 + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  take(p: Pickup): ItemInstance {
    if (p.spawnId) this.consumed.add(p.spawnId);
    this.removeMesh(p);
    const i = this.pickups.indexOf(p);
    if (i >= 0) this.pickups.splice(i, 1);
    return p.item;
  }

  update(time: number): void {
    for (const p of this.pickups) {
      p.mesh.position.y = p.y + Math.sin(time * 1.6 + p.phase) * 0.035 + 0.05;
      p.mesh.rotation.y += 0.008;
      const s = 1 + Math.sin(time * 2.2 + p.phase) * 0.12;
      p.glow.scale.set(s, s, 1);
    }
  }

  reset(): void {
    for (const p of this.pickups) this.removeMesh(p);
    this.pickups.length = 0;
    this.consumed.clear();
    this.droppedByChunk.clear();
  }
}
