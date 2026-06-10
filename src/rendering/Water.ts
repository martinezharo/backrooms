// Murky animated water surface — shared shader material, time-driven ripples.

import * as THREE from 'three';

let material: THREE.ShaderMaterial | null = null;

export function getWaterMaterial(): THREE.ShaderMaterial {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x1d4a3c) },
        uDeepColor: { value: new THREE.Color(0x06140f) },
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
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      void main() {
        vec3 V = normalize(vViewDir);
        // animated pseudo-normal from layered sines
        float nx = sin(vWorldPos.x * 2.3 + uTime * 1.3) * 0.5 + sin(vWorldPos.z * 3.1 - uTime * 0.7) * 0.5;
        float nz = cos(vWorldPos.z * 2.7 + uTime * 1.1) * 0.5 + cos(vWorldPos.x * 1.9 + uTime * 0.5) * 0.5;
        vec3 Nrm = normalize(vec3(nx * 0.18, 1.0, nz * 0.18));
        float fres = pow(1.0 - abs(dot(V, Nrm)), 2.0);
        // faint moving caustic shimmer
        float shimmer = sin(vWorldPos.x * 5.0 + uTime * 2.0) * sin(vWorldPos.z * 4.3 - uTime * 1.6);
        shimmer = smoothstep(0.55, 1.0, shimmer) * 0.25;
        vec3 col = mix(uDeepColor, uColor, fres * 0.85 + 0.15) + vec3(shimmer) * uColor * 1.6;
        float alpha = 0.78 + fres * 0.18;
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
      }
    `,
  });
  return material;
}

export function updateWater(time: number): void {
  if (material) material.uniforms.uTime.value = time;
}
