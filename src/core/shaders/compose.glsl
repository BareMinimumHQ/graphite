// Package-owned entry point: builds the Surface, calls the brush and applies colour and layer opacity.
// Linear to sRGB output; the renderer passes uColor as linear.
vec4 sRGBTransferOETF(in vec4 value) {
  return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  Surface s = Surface(uv, uv * uFieldSize);
  float fill = uShadingOpacity > 0.0 ? brushShading(s) * uShadingOpacity : 0.0;
  float outline = uOutlineOpacity > 0.0 ? brushOutline(s) : 0.0;
  // Graphite over graphite adds up: where shading crosses the outline it is darker than either mark.
  float alpha = fill + outline * uOutlineOpacity * (1.0 - fill);
  fragColor = sRGBTransferOETF(vec4(uColor, alpha));
}
