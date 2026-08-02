// Device-aware rendering limits. The game is intentionally procedural, so the
// cheapest way to support phones is to cap the number of pixels and shadow
// samples before the first WebGL resource is created.
//
// Desktop keeps the original quality on purpose: everything is drawn through
// the EffectComposer, so lowering the ratio there costs image sharpness across
// the whole frame, not just the post passes.

export interface RenderQuality {
  mobile: boolean;
  antialias: boolean;
  pixelRatio: number;
  postfxPixelRatio: number;
  shadowMapSize: number;
}

export function getRenderQuality(): RenderQuality {
  // Only a real touch device is treated as mobile. A narrow desktop window is
  // still a desktop GPU, and this is evaluated once at startup — a viewport
  // test would lock a resized window into phone quality for the whole run.
  const mobile = matchMedia('(hover: none) and (pointer: coarse)').matches;
  const dpr = window.devicePixelRatio || 1;
  const pixelRatio = Math.min(mobile ? 1.25 : 1.75, dpr);

  return {
    mobile,
    antialias: !mobile,
    pixelRatio,
    // The composer must match the renderer, otherwise the scene is rendered at
    // one resolution and rescaled to another, which reads as a soft image.
    // Phones trade that sharpness away because the post passes are fill-bound.
    postfxPixelRatio: mobile ? Math.min(0.9, dpr) : pixelRatio,
    shadowMapSize: mobile ? 512 : 1024,
  };
}
