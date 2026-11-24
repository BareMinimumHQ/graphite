// Package-owned shader prelude. Every brush can use these inputs and helpers.
precision highp float;
precision highp int;

uniform sampler2D uField;
uniform vec2 uFieldSize;
uniform vec3 uColor;
uniform float uOutlineOpacity;
uniform float uShadingOpacity;

in vec2 vUv;
out vec4 fragColor;

/** One pixel of the drawing. */
struct Surface {
  vec2 uv;  // Field texture coordinate, y down.
  vec2 p;   // Position in field units (650 x 500).
};

float hash(vec2 p) {
  p = fract(p * vec2(.1031, .11369));
  p += dot(p, p + vec2(19.19, 37.37));
  return fract((p.x + p.y) * p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.,0.)), f.x),
             mix(hash(i + vec2(0.,1.)), hash(i + vec2(1.,1.)), f.x), f.y);
}
/** Signed distance to the artwork edge at a texture coordinate: positive inside, reliable to +/-16. */
float fieldDistance(vec2 uv) {
  return (texture(uField, uv).g - .5) * 32.0;
}
