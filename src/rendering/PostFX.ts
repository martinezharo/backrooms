// Post-processing: bloom + one combined pass for chromatic aberration,
// animated film grain, vignette and the underwater tint/wobble.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { RenderQuality } from './Quality';

const AtmosphereShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.00035 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.55 },
    uUnderwater: { value: 0 },
    uWaterTint: { value: new THREE.Color(0x74d9bf) },
    uDamage: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uUnderwater;
    uniform vec3 uWaterTint;
    uniform float uDamage;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      // underwater wobble
      if (uUnderwater > 0.001) {
        uv.x += sin(uv.y * 22.0 + uTime * 2.1) * 0.004 * uUnderwater;
        uv.y += cos(uv.x * 18.0 + uTime * 1.7) * 0.004 * uUnderwater;
      }

      // radial chromatic aberration
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);
      vec2 offs = center * (uAberration * (1.0 + r2 * 6.0)) * 14.0;
      float cr = texture2D(tDiffuse, uv + offs).r;
      vec2 gb = texture2D(tDiffuse, uv).gb;
      float cb = texture2D(tDiffuse, uv - offs).b;
      vec3 col = vec3(cr, gb.x, cb);

      // underwater tint — chlorine blue in the poolrooms, black-green below
      col = mix(col, col * uWaterTint + uWaterTint * 0.03, uUnderwater);

      // film grain (animated)
      float g = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 43.0) - 0.5;
      col += g * uGrain * (0.35 + 0.4 * (1.0 - dot(col, vec3(0.333))));

      // vignette
      float vig = smoothstep(0.95, 0.25, length(center) * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette);

      // damage flash pushes red into the edges
      col = mix(col, vec3(0.45, 0.02, 0.0), uDamage * (1.0 - vig) * 1.6);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  private atmo: ShaderPass;
  private bloom: UnrealBloomPass;
  private underwaterTarget = 0;
  private vignetteTarget = 0.55;
  private readonly waterTintTarget = new THREE.Color(0x74d9bf);
  private damageFlash = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    quality: RenderQuality,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.26, 0.6, 0.92,
    );
    this.composer.addPass(this.bloom);

    this.atmo = new ShaderPass(AtmosphereShader);
    this.composer.addPass(this.atmo);

    this.composer.addPass(new OutputPass());
    this.composer.setPixelRatio(quality.postfxPixelRatio);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  /** Vignette strength for the biome the player is standing in. */
  setVignette(v: number): void {
    this.vignetteTarget = v;
  }

  /** Colour the frame takes on once the player goes under, per biome. */
  setWaterTint(hex: number): void {
    this.waterTintTarget.setHex(hex);
  }

  setUnderwater(under: boolean): void {
    const target = under ? 1 : 0;
    if (target === this.underwaterTarget) return;
    this.underwaterTarget = target;
  }

  triggerDamage(strength = 1): void {
    this.damageFlash = Math.min(1, this.damageFlash + strength * 0.6);
  }

  update(time: number, dt: number): void {
    const u = this.atmo.uniforms;
    u.uTime.value = time;
    u.uUnderwater.value += (this.underwaterTarget - u.uUnderwater.value) * Math.min(1, dt * 6);
    u.uVignette.value += (this.vignetteTarget - u.uVignette.value) * Math.min(1, dt * 1.2);
    (u.uWaterTint.value as THREE.Color).lerp(this.waterTintTarget, Math.min(1, dt * 1.2));
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    u.uDamage.value = this.damageFlash;
  }

  render(): void {
    this.composer.render();
  }
}
