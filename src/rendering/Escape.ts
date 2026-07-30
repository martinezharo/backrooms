// The fall. Once you step through the portal the maze is gone and you are
// dropping — through the cloud deck, then a long open plummet towards a
// landscape that keeps getting bigger. Rendered as one fullscreen pass over
// the procedural aerial view: zoom blur, cloud layers whipping past and a
// slow spin do the work that geometry would otherwise have to.

import * as THREE from 'three';
import { getAerial } from './AerialView';

/** seconds of freefall before the whiteout */
export const FALL_DURATION = 15.5;
const WHITEOUT = 1.4;

const FallShader = {
  uniforms: {
    uTex: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uScale: { value: 0.44 },
    uBlur: { value: 0.0 },
    uSpin: { value: 0 },
    uCloud: { value: 1 },
    uFlash: { value: 1 },
    uWhite: { value: 0 },
    uShake: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uCentre: { value: new THREE.Vector2(0.5, 0.5) },
    uProgress: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex;
    uniform float uTime;
    uniform float uScale;   // half-extent of the texture on screen
    uniform float uBlur;    // radial (zoom) blur strength
    uniform float uSpin;
    uniform float uCloud;
    uniform float uFlash;
    uniform float uWhite;
    uniform vec2  uShake;
    uniform float uAspect;
    uniform vec2  uCentre; // where you're going to land
    uniform float uProgress;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    /** one cloud deck rushing outwards past the camera */
    vec2 deck(vec2 p, float phase, float seed) {
      float ph = fract(phase);
      // a deck you are falling into grows on screen: high frequency far away,
      // huge and soft by the time it swallows the lens
      float freq = mix(11.0, 0.45, ph * ph);
      float d = fbm(p * freq + vec2(seed * 13.3, seed * 7.1));
      float mask = smoothstep(0.44, 0.70, d);
      // fade in far away, blow out as it passes
      float life = smoothstep(0.0, 0.22, ph) * (1.0 - smoothstep(0.76, 1.0, ph));
      return vec2(mask * life, d);
    }

    void main() {
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) + uShake;

      float s = sin(uSpin), c = cos(uSpin);
      vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);

      // ---- ground, sampled along the zoom axis for motion blur ----
      vec3 col = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 14; i++) {
        float t = float(i) / 13.0;
        float k = 1.0 + t * uBlur;                 // each tap is a moment later
        vec2 uv = rp * uScale * k + uCentre;
        float w = 1.0 - t * 0.55;
        col += texture2D(uTex, uv).rgb * w;
        wsum += w;
      }
      col /= wsum;

      // ground detail that never runs out, however close you get: two octaves
      // pinned to world scale, so the last seconds read as texture, not pixels
      float grit = fbm(rp * (14.0 / max(uScale, 0.004)));
      float fine = fbm(rp * (52.0 / max(uScale, 0.004)) + 7.3);
      col *= 0.9 + 0.2 * grit;
      col += (fine - 0.5) * 0.09 * smoothstep(0.25, 0.9, uProgress);

      // ---- air ----
      float haze = smoothstep(0.05, 0.55, uScale);           // thicker when high up
      col = mix(col, vec3(0.66, 0.75, 0.84), haze * 0.5);

      vec2 c1 = deck(rp, uTime * 0.23, 1.0);
      vec2 c2 = deck(rp, uTime * 0.17 + 0.43, 2.0);
      vec2 c3 = deck(rp, uTime * 0.31 + 0.77, 3.0);
      float cloud = clamp((c1.x + c2.x * 0.9 + c3.x * 0.7) * uCloud, 0.0, 1.0);
      vec3 cloudCol = mix(vec3(0.72, 0.78, 0.86), vec3(1.0, 0.99, 0.96), c1.y);
      col = mix(col, cloudCol, cloud);

      // ---- lens ----
      float r = length(p);
      vec2 offs = normalize(p + 1e-5) * (0.004 + uBlur * 0.02) * r;
      col.r = mix(col.r, texture2D(uTex, (rp + offs) * uScale + uCentre).r, 0.25);
      col.b = mix(col.b, texture2D(uTex, (rp - offs) * uScale + uCentre).b, 0.25);

      // the closer the ground, the more light there is in your face — but keep
      // the contrast up, or the last seconds turn into grey soup
      col *= 1.0 + uProgress * 0.55;
      col = mix(col, (col - 0.5) * 1.16 + 0.5, smoothstep(0.45, 1.0, uProgress));
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, mix(vec3(lum), col, 1.35), smoothstep(0.3, 0.85, uProgress));
      col = mix(col, vec3(0.97, 0.98, 1.0), smoothstep(0.78, 1.0, uProgress) * 0.28);

      // vignette, easing off as the fall accelerates
      col *= 1.0 - smoothstep(0.35, 1.05, r) * 0.55 * (1.0 - uProgress * 0.6);
      col += (hash(vUv * 1920.0 + fract(uTime) * 37.0) - 0.5) * 0.055;

      col = mix(col, vec3(1.0), uFlash);
      col = mix(col, vec3(1.0), uWhite);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Escape {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private t = 0;
  private running = false;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FallShader.uniforms),
      vertexShader: FallShader.vertexShader,
      fragmentShader: FallShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  start(seed: number): void {
    const aerial = getAerial(seed);
    this.mat.uniforms.uTex.value = aerial.texture;
    (this.mat.uniforms.uCentre.value as THREE.Vector2).copy(aerial.landing);
    this.mat.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    this.t = 0;
    this.running = true;
  }

  get active(): boolean { return this.running; }
  /** 0..1 through the whole sequence, whiteout included */
  get progress(): number { return Math.min(1, this.t / (FALL_DURATION + WHITEOUT)); }
  get finished(): boolean { return this.t >= FALL_DURATION + WHITEOUT; }

  /** How hard the wind should be howling right now. */
  get windLevel(): number {
    const u = Math.min(1, this.t / FALL_DURATION);
    return Math.min(1, u * 1.6) * (1 - Math.max(0, (this.t - FALL_DURATION) / WHITEOUT) * 0.7);
  }

  /** Camera shake, also fed to the HUD-free screen jitter. */
  get intensity(): number {
    return Math.pow(Math.min(1, this.t / FALL_DURATION), 2.4);
  }

  update(dt: number): void {
    if (!this.running) return;
    this.t += dt;
    const u = Math.min(1, this.t / FALL_DURATION);
    const un = this.mat.uniforms;

    // altitude collapses towards the ground; scale is what's left of the map
    const alt = Math.pow(1 - u, 1.8);
    un.uScale.value = 0.02 + 0.44 * alt;

    // apparent speed = how fast the scale is shrinking, and that drives blur
    const rate = 1.8 / ((1 - u) + 0.06) / FALL_DURATION;
    // a streak, not an average: too much spread and the ground turns to soup
    un.uBlur.value = Math.min(0.55, 0.03 + rate * 0.3);

    un.uProgress.value = u;
    un.uTime.value = this.t;
    un.uSpin.value = Math.sin(this.t * 0.21) * 0.12 + this.t * 0.012;
    // you fall out of the bottom of the cloud deck and it is gone for good
    un.uCloud.value = Math.max(0, 1 - Math.max(0, this.t - 0.5) / 5);
    un.uFlash.value = Math.max(0, 1 - this.t / 0.9);

    const over = this.t - FALL_DURATION;
    un.uWhite.value = over > 0 ? Math.min(1, Math.pow(over / WHITEOUT, 0.7)) : 0;

    const shake = this.intensity * 0.012;
    (un.uShake.value as THREE.Vector2).set(
      Math.sin(this.t * 27.3) * shake + Math.sin(this.t * 11.1) * shake * 0.6,
      Math.cos(this.t * 23.7) * shake + Math.sin(this.t * 8.3) * shake * 0.6,
    );
  }

  setSize(w: number, h: number): void {
    this.mat.uniforms.uAspect.value = w / h;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  stop(): void {
    this.running = false;
  }
}
