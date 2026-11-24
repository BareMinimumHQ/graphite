// The float buffer that strokes pile up in before the paper pass reads them.
import { FIELD_HEIGHT, FIELD_WIDTH } from '../core/constants.js'

/** A float buffer the size of the canvas that strokes pile up in, and the farness map at `unit + 1`. */
export function createStrokeBuffer(
  gl: WebGL2RenderingContext,
  unit: number,
  farnessMap: Uint8Array,
) {
  if (!gl.getExtension('EXT_color_buffer_float'))
    throw new Error('Stroke brushes need EXT_color_buffer_float')
  const far = gl.createTexture()
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  if (!far || !texture || !framebuffer) {
    gl.deleteTexture(far)
    gl.deleteTexture(texture)
    gl.deleteFramebuffer(framebuffer)
    throw new Error('Could not allocate Graphite stroke buffer resources')
  }
  gl.activeTexture(gl.TEXTURE0 + unit + 1)
  gl.bindTexture(gl.TEXTURE_2D, far)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    FIELD_WIDTH,
    FIELD_HEIGHT,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    farnessMap,
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  let size: [number, number] | undefined
  return {
    /** Starts a layer: binds the buffer, clears it unless `keep` (to add strokes to the last
     * frame's), and sets the blending strokes combine with. */
    begin(width: number, height: number, keep = false) {
      gl.activeTexture(gl.TEXTURE0 + unit + 1)
      gl.bindTexture(gl.TEXTURE_2D, far)
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (size?.[0] !== width || size[1] !== height) {
        size = undefined
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA16F,
          width,
          height,
          0,
          gl.RGBA,
          gl.HALF_FLOAT,
          null,
        )
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          texture,
          0,
        )
        if (
          gl.getError() !== gl.NO_ERROR ||
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
        )
          throw new Error('WebGL could not allocate the graphite stroke buffer')
        size = [width, height]
      }
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.viewport(0, 0, width, height)
      if (!keep) gl.clear(gl.COLOR_BUFFER_BIT)
      // Graphite covers what is already there: a + b(1 - a). Dust closeness is a max.
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE)
    },
    /** Ends a layer: draws to the canvas again, with the buffer bound for the paper pass. */
    end(restoreBlend: () => void) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.blendEquation(gl.FUNC_ADD)
      restoreBlend()
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
    },
    dispose() {
      gl.deleteTexture(far)
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
    },
  }
}
