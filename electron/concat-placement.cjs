// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jareer and Concat contributors
// SPDX-FileCopyrightText: 2026 FreeCut contributors
'use strict';

// Adapted from jub0t/Concat e5c8662daf6d721de2fd6c4e78cb671cd6d98393:
// src/crates/concat-export/src/lib.rs::place_layer and
// src/crates/concat-render/src/compositor.rs::blend_transformed.
// Modified 2026-09-19: Rust-to-JavaScript port; project-pixel offsets and FFmpeg layer bounds.
// The original centres a fitted layer, translates fractions to output pixels,
// and bounds its rotated rectangle. FreeCut stores translation in project
// pixels, so the caller supplies its pixel-to-output conversion instead.
function layerPlacement(width, height, sourceWidth, sourceHeight, transform, pixelScale, verticalScale = pixelScale) {
  const fit = Math.min(width / sourceWidth, height / sourceHeight);
  const scaledWidth = Math.max(1, Math.round(sourceWidth * fit * transform.scale));
  const scaledHeight = Math.max(1, Math.round(sourceHeight * fit * transform.scale));
  const rotation = transform.rotation * Math.PI / 180;
  const sin = Math.sin(rotation), cos = Math.cos(rotation);
  const halfWidth = scaledWidth / 2, halfHeight = scaledHeight / 2;
  const reachX = halfWidth * Math.abs(cos) + halfHeight * Math.abs(sin);
  const reachY = halfWidth * Math.abs(sin) + halfHeight * Math.abs(cos);
  const rotatedWidth = Math.ceil(reachX * 2 - 1e-9);
  const rotatedHeight = Math.ceil(reachY * 2 - 1e-9);
  const centreX = width / 2 + transform.x * pixelScale;
  const centreY = height / 2 + transform.y * verticalScale;
  return { scaledWidth, scaledHeight, rotatedWidth, rotatedHeight, rotation,
    x: centreX - rotatedWidth / 2, y: centreY - rotatedHeight / 2 };
}

module.exports = { layerPlacement };
