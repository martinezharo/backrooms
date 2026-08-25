// The pipe under Level 37's drain.
//
// It belongs to neither floor: it starts at the bottom of the deep end, passes
// through the ceiling of the level below and keeps going until it is under the
// water down there, so that the water is one column and you can swim the whole
// length of it in either direction. Because it spans two slabs it cannot live
// in a chunk — chunk streaming would unload half of it — so it owns its meshes
// the way the portal does, and only a change of level takes it down.

import * as THREE from 'three';
import { CELL } from '../core/constants';
import { getWorldMaterials } from '../rendering/Textures';
import { BIOMES, biomeForDepth } from './Biomes';
import { baseY, type ShaftSpec } from './Slabs';

/** Ribs down the inside. Without them the descent has no sense of speed. */
const RIB_SPACING = 1.6;

export class Shaft {
  readonly spec: ShaftSpec;
  readonly group = new THREE.Group();

  private geos: THREE.BufferGeometry[] = [];
  private shellMat: THREE.MeshStandardMaterial;
  private ribMat!: THREE.MeshStandardMaterial;
  private glow: THREE.PointLight;

  constructor(scene: THREE.Scene, spec: ShaftSpec) {
    this.spec = spec;
    const len = spec.top - spec.bottom;
    const midY = (spec.top + spec.bottom) / 2;
    const mats = getWorldMaterials();

    // The wall of the pipe, seen from the inside. Open at both ends: the top is
    // the drain you came through, the bottom is where it lets go of you.
    const tube = new THREE.CylinderGeometry(spec.radius, spec.radius, len, 20, 1, true);
    this.shellMat = mats.metal.clone();
    this.shellMat.side = THREE.BackSide;
    this.shellMat.color.setHex(0x4a5a56);
    const shell = new THREE.Mesh(tube, this.shellMat);
    shell.position.set(spec.x, midY, spec.z);
    this.group.add(shell);
    this.geos.push(tube);

    // Ribs, and they glow faintly of their own accord. Nothing down here casts
    // enough light to pick a dark ring out of a dark pipe, and a shaft you
    // cannot see the sides of is indistinguishable from falling through
    // nothing: the rings receding under you are the whole sense of descent.
    const rib = new THREE.TorusGeometry(spec.radius - 0.03, 0.05, 6, 18);
    this.geos.push(rib);
    this.ribMat = new THREE.MeshStandardMaterial({
      color: 0x2b3a38,
      emissive: 0x4d7d84,
      emissiveIntensity: 0.9,
      roughness: 0.6,
      metalness: 0.5,
    });
    for (let y = spec.top - RIB_SPACING; y > spec.bottom; y -= RIB_SPACING) {
      const m = new THREE.Mesh(rib, this.ribMat);
      m.rotation.x = Math.PI / 2;
      m.position.set(spec.x, y, spec.z);
      this.group.add(m);
    }

    // A light that rides down with you. One lamp at the far end only lights the
    // far end, and the pipe is twelve metres of nothing in between.
    this.glow = new THREE.PointLight(0x9fd6e4, 14, 11, 1.4);
    this.glow.position.set(spec.x, spec.top - 2, spec.z);
    this.group.add(this.glow);

    // Both floors are missing a whole cell of surface where the pipe goes
    // through them, and the pipe only covers a circle of it. Without a collar
    // on each you can see out through the corners into nothing at all.
    const collar = (y: number, up: boolean, mat: THREE.Material) => {
      const g = new THREE.RingGeometry(spec.radius, CELL * 0.72, 24, 1);
      const m = new THREE.Mesh(g, mat);
      m.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
      m.position.set(spec.x, y, spec.z);
      this.group.add(m);
      this.geos.push(g);
    };
    // the basin it drains, seen from above
    collar(spec.top + 0.01, true, mats.tileFloor);
    // and the ceiling it comes through downstairs, seen from below
    const lowerCeil = baseY(spec.lower) + BIOMES[biomeForDepth(spec.lower)].ceiling;
    collar(lowerCeil - 0.01, false, mats.concrete);

    scene.add(this.group);
  }

  /**
   * Keep the lamp beside whoever is in the pipe, wherever in it they are, and
   * let it wander the way light through moving water does. Outside the pipe it
   * sits at the top, lighting the mouth for anyone swimming towards it.
   */
  update(time: number, viewerY: number): void {
    const s = this.spec;
    const y = Math.min(s.top - 1, Math.max(s.bottom + 1, viewerY));
    this.glow.position.y += (y - this.glow.position.y) * 0.12;
    this.glow.intensity = 13 + Math.sin(time * 0.9) * 2.4 + Math.sin(time * 2.3) * 1.1;
    this.ribMat.emissiveIntensity = 0.75 + Math.sin(time * 1.7) * 0.15;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.shellMat.dispose();
    this.ribMat.dispose();
  }
}
