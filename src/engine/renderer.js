// Canvas2D reimplementation of the original gr::EGL_Context 2D path.
// Render state layout mirrors the native RenderState2D used by GameLua / Sprite::draw:
//   rotation (cos, sin), translation (tx, ty), scale (sx, sy), pivot (px, py).
// A primitive at (x, y, w, h) is transformed as:
//   screen = S(sx,sy) * T(tx + x + px, ty + y + py) * R * (local - pivot)
// which is exactly the vertex math in EGL_Image::draw / EGL_Context::fillRect2D.

export class RenderState {
  constructor() { this.reset(); }
  reset() {
    this.c = 1; this.s = 0;
    this.tx = 0; this.ty = 0;
    this.sx = 1; this.sy = 1;
    this.px = 0; this.py = 0;
  }
}

export class Renderer {
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = width;   // logical screen (device) size, as reported to Lua
    this.height = height;
    this.k = 1;           // backing-store pixels per logical pixel
    this.rs = new RenderState();
    this.maskLayer = null;
  }
  resize(k) {
    this.k = k;
    this.canvas.width = Math.round(this.width * k);
    this.canvas.height = Math.round(this.height * k);
    this.ctx.imageSmoothingEnabled = true;
  }
  getRenderState2D() { return this.rs; }

  clear(rgb) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgb(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _apply(ctx, x, y) {
    const rs = this.rs, k = this.k;
    ctx.setTransform(k * rs.sx, 0, 0, k * rs.sy, 0, 0);
    ctx.translate(rs.tx + x + rs.px, rs.ty + y + rs.py);
    if (rs.c !== 1 || rs.s !== 0) ctx.transform(rs.c, rs.s, -rs.s, rs.c, 0, 0);
  }

  // EGL_Image::draw(x, y, srcX, srcY, w, h)
  drawImage(img, x, y, sx, sy, w, h) {
    if (!img || w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    this._apply(ctx, x, y);
    ctx.drawImage(img.canvas, sx, sy, w, h, -this.rs.px, -this.rs.py, w, h);
  }

  // EGL_Context::fillRect2D(color ARGB, x, y, w, h)
  fillRect(argb, x, y, w, h) {
    const ctx = this.ctx;
    this._apply(ctx, x, y);
    const a = ((argb >>> 24) & 255) / 255;
    ctx.fillStyle = `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${a})`;
    ctx.fillRect(-this.rs.px, -this.rs.py, w, h);
  }

  // EGL_Context::texturizeRect2D: fills rect with a repeating image region
  texturizeRect(img, srcX, srcY, srcW, srcH, offX, offY, x, y, w, h) {
    const ctx = this.ctx;
    this._apply(ctx, x, y);
    const pat = img.patternFor(ctx, srcX, srcY, srcW, srcH);
    if (pat.setTransform) pat.setTransform(new DOMMatrix([1, 0, 0, 1, offX - x - this.rs.px, offY - y - this.rs.py]));
    ctx.fillStyle = pat;
    ctx.fillRect(-this.rs.px, -this.rs.py, w, h);
  }

  drawLine2D(argb, x1, y1, x2, y2) {
    const ctx = this.ctx;
    this._apply(ctx, 0, 0);
    ctx.strokeStyle = `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${((argb >>> 24) & 255) / 255})`;
    ctx.lineWidth = 1 / Math.max(1e-6, Math.abs(this.rs.sx));
    ctx.beginPath();
    ctx.moveTo(x1 - this.rs.px, y1 - this.rs.py);
    ctx.lineTo(x2 - this.rs.px, y2 - this.rs.py);
    ctx.stroke();
  }

  // ---- MaskedImage: sprite alpha used as a mask over a world-aligned repeating texture ----
  maskBegin() {
    if (!this.maskLayer) {
      this.maskLayer = document.createElement('canvas');
    }
    const m = this.maskLayer;
    if (m.width !== this.canvas.width || m.height !== this.canvas.height) {
      m.width = this.canvas.width; m.height = this.canvas.height;
    }
    this.maskCtx = m.getContext('2d');
    this.maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.maskCtx.globalCompositeOperation = 'source-over';
    this.maskCtx.clearRect(0, 0, m.width, m.height);
    this.maskItems = [];
  }
  maskAdd(texture, spriteImg, sprite, x, y) {
    // Draw the mask (sprite shape) in world space with the current state.
    const ctx = this.maskCtx;
    this._apply(ctx, x - sprite.px, y - sprite.py);
    ctx.drawImage(spriteImg.canvas, sprite.x, sprite.y, sprite.w, sprite.h, -this.rs.px, -this.rs.py, sprite.w, sprite.h);
    this.maskItems.push({ texture, tx: this.rs.tx, ty: this.rs.ty, sx: this.rs.sx, sy: this.rs.sy });
  }
  maskRender() {
    if (!this.maskItems || !this.maskItems.length) return;
    const ctx = this.maskCtx, k = this.k;
    // Texture coordinates are world positions / texture size (see MaskedImage::add).
    const groups = new Map();
    for (const it of this.maskItems) groups.set(it.texture, it);
    ctx.globalCompositeOperation = 'source-in';
    for (const [tex, it] of groups) {
      ctx.setTransform(k * it.sx, 0, 0, k * it.sy, 0, 0);
      ctx.translate(it.tx, it.ty);
      ctx.fillStyle = tex.pattern(ctx);
      const inv = 1 / (k * it.sx);
      ctx.fillRect(-it.tx - 4, -it.ty - 4, this.canvas.width * inv + 8, this.canvas.height * inv + 8);
    }
    ctx.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.maskLayer, 0, 0);
    this.maskItems = [];
  }
}

// Wraps a decoded image (canvas) with helpers.
export class Image2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this._pattern = null;
    this._sub = new Map();
  }
  pattern(ctx) {
    if (!this._pattern) this._pattern = ctx.createPattern(this.canvas, 'repeat');
    return this._pattern;
  }
  patternFor(ctx, x, y, w, h) {
    const key = `${x},${y},${w},${h}`;
    let p = this._sub.get(key);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(this.canvas, x, y, w, h, 0, 0, w, h);
      p = ctx.createPattern(c, 'repeat');
      this._sub.set(key, p);
    }
    return p;
  }
}
