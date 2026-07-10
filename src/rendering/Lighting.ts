// A small pool of real PointLights is re-assigned every frame to the fixtures
// nearest the player; everything else glows via emissive material + bloom.

import * as THREE from 'three';
import { BIOMES } from '../world/Biomes';
import { LightFixture } from '../world/Chunk';
import { flickerOn, World } from '../world/World';

const POOL_SIZE = 9;
const REACH = 22; // only fixtures within this radius get a real light

const FLASHLIGHT_INTENSITY = 200;

// Auto-iris: beyond this distance the beam runs at full power; closer
// subjects dim it so ACES doesn't blow them out to pure white.
const IRIS_DIST = 6;
const IRIS_MIN = 0.05;

export class Lighting {
  private pool: THREE.PointLight[] = [];
  private ambient: THREE.AmbientLight;
  flashlight: THREE.SpotLight;
  flashlightOn = false;

  /** 0..1 — proximity of the nearest entity; the torch hates company */
  private threat = 0;
  /** current brightness multiplier after threat dimming + flicker */
  private dimFactor = 1;
  /** distance to the nearest entity in front of the camera (fed by Game) */
  private subjectDist = Infinity;
  /** smoothed auto-iris exposure factor */
  private iris = 1;

  private world: World;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xfff0bb, 0, 15, 1.8);
      scene.add(l);
      this.pool.push(l);
    }
    this.ambient = new THREE.AmbientLight(0x6b6244, 0.5);
    scene.add(this.ambient);

    this.flashlight = new THREE.SpotLight(0xfff6e0, 0, 26, Math.PI / 5.5, 0.45, 1.4);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 26;
    this.flashlight.shadow.bias = -0.003;
    scene.add(this.flashlight);
    scene.add(this.flashlight.target);
  }

  setFlashlight(on: boolean): void {
    this.flashlightOn = on;
  }

  /** Feed the nearest-entity proximity (0 = nothing near, 1 = touching). */
  setThreat(level: number): void {
    this.threat += (THREE.MathUtils.clamp(level, 0, 1) - this.threat) * 0.12;
  }

  /** Distance to the nearest entity inside the beam cone (for the auto-iris). */
  setSubjectDistance(d: number): void {
    this.subjectDist = d;
  }

  /** Is a world point inside the flashlight beam? (used by Smilers) */
  inFlashlightBeam(p: THREE.Vector3): boolean {
    if (!this.flashlightOn) return false;
    // a beam choked down by a nearby entity no longer repels anything
    if (this.dimFactor < 0.3) return false;
    const toP = p.clone().sub(this.flashlight.position);
    const dist = toP.length();
    if (dist > 24) return false;
    const dir = this.flashlight.target.position.clone().sub(this.flashlight.position).normalize();
    return toP.normalize().dot(dir) > Math.cos(Math.PI / 4.5);
  }

  /** Is a world point near a lit (working, currently-on) fixture? */
  isLitArea(p: THREE.Vector3, time: number): boolean {
    for (const c of this.world.allChunks()) {
      for (const L of c.lights) {
        const dx = L.x - p.x;
        const dz = L.z - p.z;
        if (dx * dx + dz * dz < 16 && flickerOn(L, time)) return true;
      }
    }
    return false;
  }

  update(camera: THREE.PerspectiveCamera, time: number): void {
    const px = camera.position.x;
    const pz = camera.position.z;

    // ambient follows the player's biome (lerped)
    const biome = this.world.biomeAt(px, pz);
    this.ambient.color.lerp(new THREE.Color(biome.ambientColor), 0.04);
    this.ambient.intensity += (biome.ambientIntensity - this.ambient.intensity) * 0.04;

    // nearest fixtures get the real lights
    const near: { L: LightFixture; d: number; biomeLight: number; intensity: number }[] = [];
    for (const c of this.world.allChunks()) {
      const def = BIOMES[c.biome];
      for (const L of c.lights) {
        if (L.broken) continue;
        const dx = L.x - px;
        const dz = L.z - pz;
        const d = dx * dx + dz * dz;
        if (d < REACH * REACH) {
          near.push({ L, d, biomeLight: def.lightColor, intensity: def.lightIntensity });
        }
      }
    }
    near.sort((a, b) => a.d - b.d);

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = this.pool[i];
      const entry = near[i];
      if (!entry) {
        light.intensity = 0;
        continue;
      }
      light.position.set(entry.L.x, entry.L.y - 0.25, entry.L.z);
      light.color.setHex(entry.biomeLight);
      const on = flickerOn(entry.L, time);
      light.intensity = on ? entry.intensity : entry.intensity * 0.04;
    }

    // flicker panel emissive sync
    for (const c of this.world.allChunks()) {
      for (const fp of c.flickerPanels) {
        const mat = fp.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = flickerOn(fp.light, time) ? 1.5 : 0.08;
      }
    }

    // flashlight follows the camera with a slight lag for weight
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const pos = camera.position.clone()
      .add(dir.clone().multiplyScalar(0.25))
      .add(new THREE.Vector3(0.12, -0.18, 0));
    this.flashlight.position.lerp(pos, 0.5);

    // auto-iris: how far away is whatever the beam is pointed at?
    let subject = Math.min(IRIS_DIST, this.subjectDist);
    const horiz = Math.hypot(dir.x, dir.z);
    if (horiz > 0.05) {
      const wallD = this.world.raycastWall(
        px, pz,
        px + (dir.x / horiz) * IRIS_DIST,
        pz + (dir.z / horiz) * IRIS_DIST,
      );
      if (wallD !== null) subject = Math.min(subject, wallD / horiz);
    }
    if (dir.y < -0.05) {
      const floorY = this.world.groundHeight(px + dir.x * 1.5, pz + dir.z * 1.5, 0.3, camera.position.y, 4);
      subject = Math.min(subject, (camera.position.y - floorY) / -dir.y);
    } else if (dir.y > 0.05) {
      const ceilY = this.world.ceilHeight(px + dir.x * 1.5, pz + dir.z * 1.5);
      if (isFinite(ceilY)) subject = Math.min(subject, (ceilY - camera.position.y) / dir.y);
    }
    // keep the lit subject's apparent brightness roughly what a mid-range wall
    // gets at full power, instead of nuking close surfaces to white
    const irisTarget = THREE.MathUtils.clamp(
      Math.pow(Math.max(subject, 0.01) / IRIS_DIST, 1.3), IRIS_MIN, 1,
    );
    this.iris += (irisTarget - this.iris) * 0.18;

    const targetPos = camera.position.clone().add(dir.multiplyScalar(12));
    this.flashlight.target.position.lerp(targetPos, 0.35);

    // something near = the torch starts to die: nervous flicker that cuts out
    // more often the closer it gets, brightness draining to almost nothing
    let flicker = 1;
    if (this.threat > 0.03) {
      const n = Math.sin(time * 31) * Math.sin(time * 17.3 + 1.7) + Math.sin(time * 7.1) * 0.5;
      const cutAt = 1.25 - this.threat * 1.15;
      flicker = n > cutAt
        ? 0.08
        : 1 - this.threat * 0.3 * (0.5 + 0.5 * Math.sin(time * 47));
    }
    this.dimFactor = Math.pow(1 - this.threat, 1.6) * flicker;
    // iris is exposure adaptation, not light output — dimFactor (which drives
    // the Smiler-repelling beam check) stays independent of it
    const target = this.flashlightOn
      ? Math.max(2, FLASHLIGHT_INTENSITY * this.dimFactor * this.iris)
      : 0;
    this.flashlight.intensity += (target - this.flashlight.intensity) * 0.5;
  }
}
