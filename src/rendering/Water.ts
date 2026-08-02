// Animated water surface — one shared shader, two tunings: the lit turquoise
// of the poolrooms and the black water of the flooded level.

import * as THREE from 'three';

export type WaterKind = 'pool' | 'deep';

const TUNING: Record<WaterKind, { shallow: number; deep: number; alpha: number; shimmer: number }> = {
  // chlorinated and backlit: you can see the tiles through it
  pool: { shallow: 0x77ccc6, deep: 0x1a747c, alpha: 0.5, shimmer: 0.55 },
  // you cannot see anything through this and that is the point
  deep: { shallow: 0x1d4a3c, deep: 0x06140f, alpha: 0.86, shimmer: 0.18 },
};

const materials: Partial<Record<WaterKind, THREE.ShaderMaterial>> = {};

export function getWaterMaterial(kind: WaterKind = 'deep'): THREE.ShaderMaterial {
  const existing = materials[kind];
  if (existing) return existing;
  const t = TUNING[kind];
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(t.shallow) },
        uDeepColor: { value: new THREE.Color(t.deep) },
        uAlpha: { value: t.alpha },
        uShimmer: { value: t.shimmer },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      void main() {
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        wp.y += sin(wp.x * 1.7 + uTime * 1.1) * 0.025 + cos(wp.z * 2.1 + uTime * 0.8) * 0.02;
        vWorldPos = wp.xyz;
        vViewDir = cameraPosition - wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uDeepColor;
      uniform float uAlpha;
      uniform float uShimmer;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      void main() {
        vec3 V = normalize(vViewDir);
        // animated pseudo-normal from layered sines
        float nx = sin(vWorldPos.x * 2.3 + uTime * 1.3) * 0.5 + sin(vWorldPos.z * 3.1 - uTime * 0.7) * 0.5;
        float nz = cos(vWorldPos.z * 2.7 + uTime * 1.1) * 0.5 + cos(vWorldPos.x * 1.9 + uTime * 0.5) * 0.5;
        vec3 Nrm = normalize(vec3(nx * 0.18, 1.0, nz * 0.18));
        float fres = pow(1.0 - abs(dot(V, Nrm)), 2.0);
        // Caustic veins. Two wave sets at an angle to the world axes, summed
        // and sharpened — multiplying two axis-aligned sines instead lays down
        // a regular lattice of dots, which reads as polka dots, not water.
        vec2 p = vWorldPos.xz;
        // warp the sample point first, or the wave sets line up into a regular
        // lattice of blobs; the warp is what turns them into wandering veins
        p += vec2(sin(p.y * 0.71 + uTime * 0.4), cos(p.x * 0.63 - uTime * 0.33)) * 0.75;
        float w = sin(p.x * 3.7 + uTime * 0.9) + sin(p.y * 4.3 - uTime * 0.7)
                + sin((p.x + p.y) * 2.53 + uTime * 1.1) + sin((p.x - p.y) * 3.11 - uTime * 0.6)
                + sin((p.x * 0.7 + p.y * 1.3) * 5.9 + uTime * 1.7) * 0.6;
        float shimmer = pow(max(0.0, w * 0.19 + 0.5), 6.0) * uShimmer;
        vec3 col = mix(uDeepColor, uColor, fres * 0.85 + 0.15) + vec3(shimmer) * uColor;
        float alpha = min(1.0, uAlpha + fres * 0.2);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `,
  });
  materials[kind] = material;
  return material;
}

export function updateWater(time: number): void {
  for (const m of Object.values(materials)) m.uniforms.uTime.value = time;
}
