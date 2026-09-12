// ---------------------------------------------------------------------------
// renderer.js - WebGL 1. Four small programs: terrain, sky, clouds and a
// plain-colour program for the selection box, the breaking overlay and the
// block in your hand.
// ---------------------------------------------------------------------------

import { mat4, perspective, lookAt, multiply, invert, frustumFromMatrix, sphereInFrustum, clamp, lerp } from './math.js';
import { getAtlasCanvas, buildCloudTexture, tileIndex, tileUV, CRACK_STAGES } from './textures.js';
import { CHUNK_X, CHUNK_Z, SECTION_H } from './world.js';
import * as B from './blocks.js';

const MAX_LIGHTS = 4;

const TERRAIN_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec2 aLight;
attribute vec3 aNormal;
uniform mat4 uProj, uView;
uniform vec3 uOffset;
varying vec2 vUV;
varying vec2 vLight;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
void main() {
  vec3 world = aPos + uOffset;
  vec4 eye = uView * vec4(world, 1.0);
  gl_Position = uProj * eye;
  vUV = aUV;
  vLight = aLight;
  vNormal = aNormal;
  vWorld = world;
  vDist = length(eye.xyz);
}`;

const TERRAIN_FS = `
precision mediump float;
uniform sampler2D uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
uniform float uDaylight;
uniform float uAlpha;
uniform float uHeadlamp;
uniform vec3 uCamPos;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform float uLightStr[${MAX_LIGHTS}];
varying vec2 vUV;
varying vec2 vLight;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vDist;
void main() {
  vec4 tex = texture2D(uAtlas, vUV);
  if (tex.a < 0.5) discard;

  float sky = vLight.x * uDaylight;
  vec3 light = vec3(max(sky, vLight.y));

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 d = uLightPos[i] - vWorld;
    float dist = length(d);
    float att = max(0.0, 1.0 - dist / 13.0);
    att *= att * uLightStr[i];
    att *= 0.45 + 0.55 * max(0.0, dot(normalize(d + vec3(0.001)), vNormal));
    light += vec3(1.0, 0.86, 0.62) * att;
  }

  float toCam = length(uCamPos - vWorld);
  light += vec3(1.0, 0.95, 0.88) * uHeadlamp * max(0.0, 1.0 - toCam / 11.0) * 0.55;

  light = max(light, vec3(0.05));
  vec3 col = tex.rgb * min(light, vec3(1.35));
  float fog = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, tex.a * uAlpha);
}`;

const SKY_VS = `
attribute vec2 aPos;
uniform mat4 uInvViewProj;
varying vec3 vRay;
void main() {
  gl_Position = vec4(aPos, 0.999, 1.0);
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(aPos, -1.0, 1.0);
  vRay = far.xyz / far.w - near.xyz / near.w;
}`;

const SKY_FS = `
precision mediump float;
uniform vec3 uTop, uHorizon, uSunColor;
uniform vec3 uSunDir;
uniform float uStars;
varying vec3 vRay;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
void main() {
  vec3 dir = normalize(vRay);
  float h = clamp(dir.y * 1.6 + 0.12, 0.0, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.7));

  // Stars fade in as the sun goes down.
  if (uStars > 0.01 && dir.y > 0.02) {
    vec3 g = floor(dir * 140.0);
    float s = hash(g);
    if (s > 0.9965) {
      float twinkle = 0.55 + 0.45 * hash(g + 7.0);
      col += vec3(1.0, 0.98, 0.92) * uStars * twinkle * smoothstep(0.0, 0.25, dir.y);
    }
  }

  float sun = max(0.0, dot(dir, uSunDir));
  col += uSunColor * pow(sun, 220.0) * 1.4;         // the disc
  col += uSunColor * pow(sun, 8.0) * 0.22;          // the glow around it
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uProj, uView;
uniform vec2 uScroll;
varying vec2 vUV;
varying float vDist;
void main() {
  vec4 eye = uView * vec4(aPos, 1.0);
  gl_Position = uProj * eye;
  vUV = aUV + uScroll;
  vDist = length(eye.xz);
}`;

const CLOUD_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uTint;
uniform float uFade;
varying vec2 vUV;
varying float vDist;
void main() {
  vec4 c = texture2D(uTex, vUV);
  float a = c.a * uFade * clamp(1.0 - vDist / 260.0, 0.0, 1.0);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uTint, a);
}`;

const FLAT_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uProj, uView;
uniform vec3 uOffset;
uniform float uScale;
varying vec2 vUV;
void main() {
  vec3 world = (aPos - 0.5) * uScale + 0.5 + uOffset;
  gl_Position = uProj * uView * vec4(world, 1.0);
  vUV = aUV;
}`;

const FLAT_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec4 uColor;
uniform vec4 uUVRect;
uniform float uTextured;
varying vec2 vUV;
void main() {
  if (uTextured > 0.5) {
    vec2 uv = mix(uUVRect.xy, uUVRect.zw, vUV);
    vec4 c = texture2D(uTex, uv);
    if (c.a < 0.1) discard;
    gl_FragColor = vec4(c.rgb, c.a * uColor.a);
  } else {
    gl_FragColor = uColor;
  }
}`;

const ITEM_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute vec2 aLight;
uniform mat4 uMVP;
varying vec2 vUV;
varying float vShade;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vUV = aUV;
  vShade = aLight.x;
}`;

const ITEM_FS = `
precision mediump float;
uniform sampler2D uAtlas;
uniform float uLight;
varying vec2 vUV;
varying float vShade;
void main() {
  vec4 c = texture2D(uAtlas, vUV);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb * vShade * uLight, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh) + '\n' + src);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  // Collect attribute and uniform locations up front.
  p.attribs = {}; p.uniforms = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    p.attribs[info.name] = gl.getAttribLocation(p, info.name);
  }
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    p.uniforms[name] = gl.getUniformLocation(p, name);
  }
  return p;
}

function texFromCanvas(gl, canvas) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// Unit cube geometry shared by the selection box, the crack overlay and the
// block held in the player's hand.
const CUBE_FACES = [
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.72, tile: 0 },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.72, tile: 1 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tile: 2 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tile: 3 },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.86, tile: 4 },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.86, tile: 5 },
];
const CUBE_UV = [[0, 1], [1, 1], [1, 0], [0, 0]];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const opts = { alpha: false, antialias: false, depth: true, stencil: false,
                   powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.uintIndices = !!gl.getExtension('OES_element_index_uint');

    this.programs = {
      terrain: program(gl, TERRAIN_VS, TERRAIN_FS),
      sky: program(gl, SKY_VS, SKY_FS),
      cloud: program(gl, CLOUD_VS, CLOUD_FS),
      flat: program(gl, FLAT_VS, FLAT_FS),
      item: program(gl, ITEM_VS, ITEM_FS),
    };

    this.atlas = texFromCanvas(gl, getAtlasCanvas());
    this.clouds = texFromCanvas(gl, buildCloudTexture());
    gl.bindTexture(gl.TEXTURE_2D, this.clouds);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.sections = new Map();   // "cx,sy,cz" -> gpu buffers
    this.proj = mat4();
    this.view = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.planes = [];
    this.stats = { sections: 0, tris: 0 };

    this.buildStaticGeometry();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.55, 0.72, 0.92, 1);
  }

  buildStaticGeometry() {
    const gl = this.gl;

    // Full-screen triangle for the sky.
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Cloud sheet.
    const S = 300, y = 96, reps = 6;
    this.cloudBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -S, y, -S, 0, 0,  S, y, -S, reps, 0,  S, y, S, reps, reps,
      -S, y, -S, 0, 0,  S, y, S, reps, reps,  -S, y, S, 0, reps,
    ]), gl.STATIC_DRAW);

    // Wireframe unit cube for the selection box.
    const e = [];
    for (let i = 0; i < 4; i++) {
      const a = [(i & 1), 0, (i >> 1)];
      e.push(a[0], 0, a[2], a[0], 1, a[2]);
    }
    for (let yy = 0; yy <= 1; yy++) {
      e.push(0, yy, 0, 1, yy, 0);  e.push(1, yy, 0, 1, yy, 1);
      e.push(1, yy, 1, 0, yy, 1);  e.push(0, yy, 1, 0, yy, 0);
    }
    this.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(e), gl.STATIC_DRAW);
    this.lineCount = e.length / 3;

    // Textured unit cube (positions + uv) for the crack overlay.
    const pos = [], uv = [], idx = [];
    CUBE_FACES.forEach((f, fi) => {
      const base = fi * 4;
      for (let i = 0; i < 4; i++) {
        pos.push(f.v[i][0], f.v[i][1], f.v[i][2]);
        uv.push(CUBE_UV[i][0], CUBE_UV[i][1]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    this.cubePos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubePos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    this.cubeUV = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeUV);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    this.cubeIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

    this.itemBuf = gl.createBuffer();
    this.itemBlock = -1;
    this.itemVerts = 0;
  }

  /* ------------------------------------------------------------ geometry io */

  uploadSection(key, mesh) {
    const gl = this.gl;
    let entry = this.sections.get(key);
    if (!entry) {
      entry = { solid: null, water: null, center: null };
      const [cx, sy, cz] = key.split(',').map(Number);
      entry.center = [cx * CHUNK_X + CHUNK_X / 2, sy * SECTION_H + SECTION_H / 2, cz * CHUNK_Z + CHUNK_Z / 2];
      this.sections.set(key, entry);
    }
    for (const kind of ['solid', 'water']) {
      const data = mesh[kind];
      if (entry[kind]) { gl.deleteBuffer(entry[kind].vbo); gl.deleteBuffer(entry[kind].ibo); entry[kind] = null; }
      if (!data) continue;
      // Interleave into one buffer: pos(3) uv(2) light(2) normal(3).
      const n = data.pos.length / 3;
      const inter = new Float32Array(n * 10);
      for (let i = 0; i < n; i++) {
        inter[i * 10] = data.pos[i * 3];
        inter[i * 10 + 1] = data.pos[i * 3 + 1];
        inter[i * 10 + 2] = data.pos[i * 3 + 2];
        inter[i * 10 + 3] = data.uv[i * 2];
        inter[i * 10 + 4] = data.uv[i * 2 + 1];
        inter[i * 10 + 5] = data.light[i * 2];
        inter[i * 10 + 6] = data.light[i * 2 + 1];
        inter[i * 10 + 7] = data.normal[i * 3];
        inter[i * 10 + 8] = data.normal[i * 3 + 1];
        inter[i * 10 + 9] = data.normal[i * 3 + 2];
      }
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      let indices, type;
      if (this.uintIndices) { indices = new Uint32Array(data.index); type = gl.UNSIGNED_INT; }
      else { indices = new Uint16Array(data.index.filter((v) => v < 65536)); type = gl.UNSIGNED_SHORT; }
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      entry[kind] = { vbo, ibo, count: indices.length, type };
    }
    if (!entry.solid && !entry.water) {
      this.sections.delete(key);
    }
  }

  dropSection(key) {
    const gl = this.gl;
    const entry = this.sections.get(key);
    if (!entry) return;
    for (const kind of ['solid', 'water']) {
      if (entry[kind]) { gl.deleteBuffer(entry[kind].vbo); gl.deleteBuffer(entry[kind].ibo); }
    }
    this.sections.delete(key);
  }

  dropChunk(cx, cz) {
    for (const key of [...this.sections.keys()]) {
      const [kx, , kz] = key.split(',').map(Number);
      if (kx === cx && kz === cz) this.dropSection(key);
    }
  }

  resize(width, height, scale) {
    const gl = this.gl;
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    this.aspect = w / h;
  }

  /* --------------------------------------------------------------- the frame */

  // `sky` holds the colours for the current time of day, computed in main.js.
  render(cam, world, sky, opts) {
    const gl = this.gl;
    const far = opts.renderDistance * CHUNK_X + 48;
    perspective(this.proj, (opts.fov * Math.PI) / 180, this.aspect, 0.08, far);
    const dir = cam.direction();
    lookAt(this.view, [cam.x, cam.y, cam.z],
      [cam.x + dir[0], cam.y + dir[1], cam.z + dir[2]], [0, 1, 0]);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
    frustumFromMatrix(this.planes, this.viewProj);

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawSky(sky, cam);
    this.drawTerrain(cam, world, sky, opts, far);
    this.drawClouds(cam, sky);
    this.drawWater(cam, world, sky, opts, far);
    if (opts.target) this.drawSelection(opts.target, opts.breakProgress);
    if (opts.heldBlock) this.drawHeldBlock(opts, sky);
  }

  drawSky(sky, cam) {
    const gl = this.gl;
    const p = this.programs.sky;
    gl.useProgram(p);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    // Sky direction only - strip the camera translation out of the matrix.
    const view = this.view.slice();
    view[12] = view[13] = view[14] = 0;
    const vp = multiply(mat4(), this.proj, view);
    gl.uniformMatrix4fv(p.uniforms.uInvViewProj, false, invert(mat4(), vp));
    gl.uniform3fv(p.uniforms.uTop, sky.top);
    gl.uniform3fv(p.uniforms.uHorizon, sky.horizon);
    gl.uniform3fv(p.uniforms.uSunColor, sky.sunColor);
    gl.uniform3fv(p.uniforms.uSunDir, sky.sunDir);
    gl.uniform1f(p.uniforms.uStars, sky.stars);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(p.attribs.aPos);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  bindTerrainProgram(cam, world, sky, opts, far, alpha) {
    const gl = this.gl;
    const p = this.programs.terrain;
    gl.useProgram(p);
    gl.uniformMatrix4fv(p.uniforms.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.uniforms.uView, false, this.view);
    gl.uniform3fv(p.uniforms.uFogColor, sky.fog);
    gl.uniform1f(p.uniforms.uFogNear, far * 0.55);
    gl.uniform1f(p.uniforms.uFogFar, far * 0.98);
    gl.uniform1f(p.uniforms.uDaylight, sky.daylight);
    gl.uniform1f(p.uniforms.uAlpha, alpha);
    gl.uniform1f(p.uniforms.uHeadlamp, opts.headlamp ? 1 : 0);
    gl.uniform3f(p.uniforms.uCamPos, cam.x, cam.y, cam.z);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(p.uniforms.uAtlas, 0);

    // The four nearest light-emitting blocks get per-pixel point lights.
    const pos = new Float32Array(MAX_LIGHTS * 3);
    const str = new Float32Array(MAX_LIGHTS);
    const near = [];
    for (const l of world.lights.values()) {
      const d = (l.x - cam.x) ** 2 + (l.y - cam.y) ** 2 + (l.z - cam.z) ** 2;
      if (d > 26 * 26) continue;
      near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(MAX_LIGHTS, near.length); i++) {
      const l = near[i][1];
      pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z;
      str[i] = l.strength;
    }
    gl.uniform3fv(p.uniforms.uLightPos, pos);
    gl.uniform1fv(p.uniforms.uLightStr, str);
    return p;
  }

  drawSectionBuffers(p, buffers) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
    const stride = 40;
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(p.attribs.aUV);
    gl.vertexAttribPointer(p.attribs.aUV, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(p.attribs.aLight);
    gl.vertexAttribPointer(p.attribs.aLight, 2, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(p.attribs.aNormal);
    gl.vertexAttribPointer(p.attribs.aNormal, 3, gl.FLOAT, false, stride, 28);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.ibo);
    gl.drawElements(gl.TRIANGLES, buffers.count, buffers.type, 0);
  }

  visibleSections(cam, opts) {
    const out = [];
    const maxDist = (opts.renderDistance + 1) * CHUNK_X;
    for (const entry of this.sections.values()) {
      const c = entry.center;
      const dx = c[0] - cam.x, dz = c[2] - cam.z;
      if (dx * dx + dz * dz > maxDist * maxDist) continue;
      if (!sphereInFrustum(this.planes, c[0], c[1], c[2], 14)) continue;
      out.push([dx * dx + (c[1] - cam.y) ** 2 + dz * dz, entry]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  }

  drawTerrain(cam, world, sky, opts, far) {
    const gl = this.gl;
    const p = this.bindTerrainProgram(cam, world, sky, opts, far, 1);
    gl.disable(gl.BLEND);
    this.visible = this.visibleSections(cam, opts);
    this.stats.sections = 0;
    this.stats.tris = 0;
    for (const [, entry] of this.visible) {
      if (!entry.solid) continue;
      this.drawSectionBuffers(p, entry.solid);
      this.stats.sections++;
      this.stats.tris += entry.solid.count / 3;
    }
  }

  drawWater(cam, world, sky, opts, far) {
    const gl = this.gl;
    const p = this.bindTerrainProgram(cam, world, sky, opts, far, 0.72);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);   // the surface should be visible from below too
    gl.depthMask(false);
    for (let i = this.visible.length - 1; i >= 0; i--) {
      const entry = this.visible[i][1];
      if (!entry.water) continue;
      this.drawSectionBuffers(p, entry.water);
      this.stats.tris += entry.water.count / 3;
    }
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  drawClouds(cam, sky) {
    const gl = this.gl;
    const p = this.programs.cloud;
    gl.useProgram(p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    // The sheet follows the player so it never runs out.
    const view = this.view.slice();
    const shift = mat4();
    shift[12] = cam.x; shift[14] = cam.z;
    const v = multiply(mat4(), view, shift);
    gl.uniformMatrix4fv(p.uniforms.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.uniforms.uView, false, v);
    gl.uniform2f(p.uniforms.uScroll, sky.cloudScroll, sky.cloudScroll * 0.3);
    gl.uniform3fv(p.uniforms.uTint, sky.cloudTint);
    gl.uniform1f(p.uniforms.uFade, 0.85);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clouds);
    gl.uniform1i(p.uniforms.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudBuf);
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(p.attribs.aUV);
    gl.vertexAttribPointer(p.attribs.aUV, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }

  drawSelection(target, breakProgress) {
    const gl = this.gl;
    const p = this.programs.flat;
    gl.useProgram(p);
    gl.uniformMatrix4fv(p.uniforms.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.uniforms.uView, false, this.view);
    gl.uniform3f(p.uniforms.uOffset, target[0], target[1], target[2]);
    gl.uniform1f(p.uniforms.uScale, 1.004);
    gl.uniform1f(p.uniforms.uTextured, 0);
    gl.uniform4f(p.uniforms.uColor, 0, 0, 0, 0.45);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aPos, 3, gl.FLOAT, false, 0, 0);
    if (p.attribs.aUV !== undefined && p.attribs.aUV >= 0) {
      gl.disableVertexAttribArray(p.attribs.aUV);
      gl.vertexAttrib2f(p.attribs.aUV, 0, 0);
    }
    gl.drawArrays(gl.LINES, 0, this.lineCount);

    // Breaking overlay: the cracks grow as you hold down.
    if (breakProgress > 0) {
      const stage = Math.min(CRACK_STAGES - 1, Math.floor(breakProgress * CRACK_STAGES));
      const [u0, v0, u1, v1] = tileUV(tileIndex('crack_' + stage));
      gl.uniform1f(p.uniforms.uTextured, 1);
      gl.uniform1f(p.uniforms.uScale, 1.002);
      gl.uniform4f(p.uniforms.uColor, 1, 1, 1, 1);
      gl.uniform4f(p.uniforms.uUVRect, u0, v0, u1, v1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.uniform1i(p.uniforms.uTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubePos);
      gl.enableVertexAttribArray(p.attribs.aPos);
      gl.vertexAttribPointer(p.attribs.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeUV);
      gl.enableVertexAttribArray(p.attribs.aUV);
      gl.vertexAttribPointer(p.attribs.aUV, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cubeIdx);
      gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.BLEND);
  }

  // The block you are holding, bobbing in the bottom corner of the screen.
  drawHeldBlock(opts, sky) {
    const gl = this.gl;
    const id = opts.heldBlock;
    if (id !== this.itemBlock) this.buildItemMesh(id);
    if (!this.itemVerts) return;

    const p = this.programs.item;
    gl.useProgram(p);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const proj = perspective(mat4(), 0.9, this.aspect, 0.01, 10);
    const bob = opts.bob || 0;
    const swing = opts.swing || 0;
    const m = mat4();
    // Place the cube down and to the right, tilted, with a little sway.
    const s = 0.38 * clamp(this.aspect, 0.6, 1.2);
    const cos = Math.cos(0.7 + swing), sin = Math.sin(0.7 + swing);
    m[0] = cos * s; m[2] = -sin * s;
    m[5] = s;
    m[8] = sin * s; m[10] = cos * s;
    // Work out where the corner of the screen is at this depth so the cube
    // sits in the same spot whatever the phone's aspect ratio is.
    const depth = 1.15;
    const halfH = Math.tan(0.45) * depth;
    const halfW = halfH * this.aspect;
    m[12] = halfW * 0.62;
    m[13] = -halfH * 0.72 + Math.sin(bob) * 0.03 - swing * 0.3;
    m[14] = -depth;
    const mvp = multiply(mat4(), proj, m);
    gl.uniformMatrix4fv(p.uniforms.uMVP, false, mvp);
    gl.uniform1f(p.uniforms.uLight, Math.max(0.45, sky.daylight));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(p.uniforms.uAtlas, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.itemBuf);
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(p.attribs.aUV);
    gl.vertexAttribPointer(p.attribs.aUV, 2, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(p.attribs.aLight);
    gl.vertexAttribPointer(p.attribs.aLight, 2, gl.FLOAT, false, 28, 20);
    gl.drawArrays(gl.TRIANGLES, 0, this.itemVerts);
  }

  buildItemMesh(id) {
    const gl = this.gl;
    this.itemBlock = id;
    const def = B.blockDef(id);
    if (!def) { this.itemVerts = 0; return; }
    const data = [];
    for (const f of CUBE_FACES) {
      const [u0, v0, u1, v1] = tileUV(tileIndex(def.tiles[f.tile]));
      const quad = [];
      for (let i = 0; i < 4; i++) {
        quad.push([
          f.v[i][0] - 0.5, f.v[i][1] - 0.5, f.v[i][2] - 0.5,
          CUBE_UV[i][0] ? u1 : u0, CUBE_UV[i][1] ? v1 : v0,
          f.shade, 0,
        ]);
      }
      for (const i of [0, 1, 2, 0, 2, 3]) data.push(...quad[i]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.itemBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    this.itemVerts = data.length / 7;
  }
}

export { clamp, lerp };
