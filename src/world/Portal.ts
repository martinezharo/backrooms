// The way out. A hole punched through a wall or a floor that looks straight
// down onto the real world — down here and down out there were never the same
// direction. Dormant until the fuses go in.

import * as THREE from 'three';
import { getAerial } from '../rendering/AerialView';
import { ChunkData, PortalSpot } from './Chunk';
import { World } from './World';

const PortalShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex;
    uniform vec2 uCentre;
    uniform float uTime;
    uniform float uActive;   // 0 = dead slab, 1 = wide open
    uniform float uPull;     // 0..1 — the last second before it takes you
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float r = length(p);
      float ang = atan(p.y, p.x);

      // the rim never sits still
      float wob = noise(vec2(ang * 2.4, uTime * 0.55)) * 0.06
                + noise(vec2(ang * 7.0, uTime * 1.3)) * 0.025;
      float edge = 0.94 + wob * (0.4 + 0.6 * uActive);
      float mask = 1.0 - smoothstep(edge - 0.06, edge, r);
      if (mask < 0.004) discard;

      // fisheye: the further out you look, the further away the ground is
      float bulge = 1.0 + r * r * 0.85;
      float zoom = mix(0.34, 0.19, uActive) * (1.0 - uPull * 0.55);
      vec2 drift = vec2(uTime * 0.0035, uTime * 0.0021);
      vec2 uv = p * bulge * zoom + uCentre + drift;

      vec3 col = texture2D(uTex, uv).rgb;

      // haze towards the rim — kilometres of air in the way
      col = mix(col, vec3(0.62, 0.71, 0.79), smoothstep(0.25, 1.0, r) * 0.34);
      // daylight is brutal after all that yellow
      col *= 1.12;

      // dormant: the image is barely a rumour behind static
      float stat = hash(vUv * 640.0 + fract(uTime) * 91.0);
      vec3 dead = vec3(0.035, 0.04, 0.045) + stat * 0.05;
      col = mix(dead, col, smoothstep(0.0, 0.85, uActive));

      // rim light
      float ring = smoothstep(edge - 0.16, edge - 0.02, r) * (0.35 + 0.65 * uActive);
      col += vec3(0.75, 0.86, 1.0) * ring * (0.6 + 0.4 * sin(uTime * 3.0 + ang * 3.0));

      gl_FragColor = vec4(col, mask);
    }
  `,
};

export class Portal {
  readonly spot: PortalSpot;
  readonly center: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private light: THREE.PointLight;
  private active = 0;
  private activeTarget = 0;

  constructor(scene: THREE.Scene, spot: PortalSpot, seed: number) {
    this.spot = spot;
    this.center = new THREE.Vector3(spot.x, spot.y, spot.z);

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: getAerial(seed).texture },
        // the portal already shows the ground you are going to hit
        uCentre: { value: getAerial(seed).landing.clone() },
        uTime: { value: 0 },
        uActive: { value: 0 },
        uPull: { value: 0 },
      },
      vertexShader: PortalShader.vertexShader,
      fragmentShader: PortalShader.fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(spot.radius, 64), this.mat);
    this.mesh.position.copy(this.center);
    if (spot.onWall) this.mesh.rotation.y = spot.angle + Math.PI / 2;
    else this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);

    // real daylight spilling into the room once it wakes up
    this.light = new THREE.PointLight(0xbfd8f0, 0, 14, 1.6);
    this.light.position.set(
      spot.x + (spot.onWall ? Math.cos(spot.angle) * 0.6 : 0),
      spot.y + (spot.onWall ? 0 : 0.8),
      spot.z + (spot.onWall ? -Math.sin(spot.angle) * 0.6 : 0),
    );
    scene.add(this.light);
  }

  get isOpen(): boolean {
    return this.activeTarget > 0.5;
  }

  open(): void {
    this.activeTarget = 1;
  }

  /** 0..1 — drives the final lurch as the player steps through. */
  setPull(v: number): void {
    this.mat.uniforms.uPull.value = v;
  }

  /** How close the player is to stepping through it. */
  distanceTo(p: THREE.Vector3): number {
    return this.center.distanceTo(p);
  }

  update(time: number, dt: number): void {
    this.active += (this.activeTarget - this.active) * Math.min(1, dt * 1.1);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uActive.value = this.active;
    this.light.intensity = this.active * (26 + Math.sin(time * 2.1) * 2);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.light.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * Watches chunk streaming for the exit chunk and keeps the portal alive from
 * then on — it is the one landmark that must never blink out of existence.
 */
export class PortalManager {
  portal: Portal | null = null;
  private scene: THREE.Scene;
  private seed: number;
  /** restored from a save: the fuses went in before you quit */
  private alreadyOpen = false;

  constructor(scene: THREE.Scene, world: World, seed: number) {
    this.scene = scene;
    this.seed = seed;
    const prev = world.onChunkLoaded;
    world.onChunkLoaded = (c) => { prev?.(c); this.chunkLoaded(c); };
  }

  private chunkLoaded(c: ChunkData): void {
    if (!c.portal || this.portal) return;
    this.portal = new Portal(this.scene, c.portal, this.seed);
    if (this.alreadyOpen) this.portal.open();
  }

  /** The door stays fed across a save, whether or not its chunk is loaded. */
  setOpen(): void {
    this.alreadyOpen = true;
    this.portal?.open();
  }

  /** Leaving the floor the door is on — there is no door on the others. */
  reset(): void {
    this.portal?.dispose();
    this.portal = null;
    this.alreadyOpen = false;
  }

  update(time: number, dt: number): void {
    this.portal?.update(time, dt);
  }
}
