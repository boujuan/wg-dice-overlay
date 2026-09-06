/* DiceScene — dados d6 3D con física real (three.js + cannon-es).
 * Canvas con alpha para flotar sobre Arkenforge. La física decide el resultado:
 * los dados se lanzan, rebotan y la cara superior se lee del quaternion. */
import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';

/* Paletas de acento: el dorado es el canónico; el resto son opción estética.
 * Todo en strings CSS (#rrggbb): THREE.Color y los canvas los aceptan igual. */
const ACCENTS = {
  gold:  { body: ['#e8b64c', '#d29a33', '#b57f22'], emissive: '#cf8f1f', glow: '#ffd24a', soft: '#ffe9b0' },
  red:   { body: ['#e86a55', '#c9462f', '#9c2f1d'], emissive: '#c93a24', glow: '#ff6a4a', soft: '#ffb4a0' },
  blue:  { body: ['#5f8fe0', '#3f6cc4', '#2b4c94'], emissive: '#3f6cc4', glow: '#6fa2ff', soft: '#bcd2ff' },
  green: { body: ['#6fc46a', '#4a9c46', '#33772f'], emissive: '#4a9c46', glow: '#7fe07a', soft: '#c2f0be' }
};

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { h: 42, s: .45, l: .55 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
const hslStr = (h, s, l) =>
  `hsl(${Math.round(h)} ${Math.round(Math.min(1, Math.max(0, s)) * 100)}% ${Math.round(Math.min(1, Math.max(0, l)) * 100)}%)`;

/* acento por nombre (gold/red/…) o por hex custom (#rrggbb) */
function resolveAccent(v) {
  if (ACCENTS[v]) return ACCENTS[v];
  if (/^#?[0-9a-f]{6}$/i.test(String(v || '').trim())) {
    const { h, s, l } = hexToHsl(v);
    return {
      body: [hslStr(h, s, Math.min(1, l + .16)), hslStr(h, s, l), hslStr(h, s * .9, Math.max(0, l - .12))],
      emissive: hslStr(h, s, l * .8),
      glow: hslStr(h, Math.min(1, s + .1), Math.min(1, l + .2)),
      soft: hslStr(h, s * .5, Math.min(.92, l + .42))
    };
  }
  return ACCENTS.gold;
}

/* Caras de un BoxGeometry (orden de materiales): +x, -x, +y, -y, +z, -z.
 * Opuestos suman 7. La textura del pip i se pinta según este mapa. */
const FACE_VALUES = { px: 3, nx: 4, py: 1, ny: 6, pz: 2, nz: 5 };
const AXES = [
  { name: 'px', axis: new THREE.Vector3(1, 0, 0), value: FACE_VALUES.px },
  { name: 'nx', axis: new THREE.Vector3(-1, 0, 0), value: FACE_VALUES.nx },
  { name: 'py', axis: new THREE.Vector3(0, 1, 0), value: FACE_VALUES.py },
  { name: 'ny', axis: new THREE.Vector3(0, -1, 0), value: FACE_VALUES.ny },
  { name: 'pz', axis: new THREE.Vector3(0, 0, 1), value: FACE_VALUES.pz },
  { name: 'nz', axis: new THREE.Vector3(0, 0, -1), value: FACE_VALUES.nz }
];

/* ---------- texturas de cara generadas por canvas ---------- */

const PIP_LAYOUT = {
  1: [[.5, .5]],
  2: [[.28, .28], [.72, .72]],
  3: [[.25, .25], [.5, .5], [.75, .75]],
  4: [[.28, .28], [.72, .28], [.28, .72], [.72, .72]],
  5: [[.26, .26], [.74, .26], [.5, .5], [.26, .74], [.74, .74]],
  6: [[.3, .24], [.7, .24], [.3, .5], [.7, .5], [.3, .76], [.7, .76]]
};

/* Caca estilizada para el 1 del dado de Ira (¡PIFIA!): silueta marrón oscuro
 * con remolino, legible sobre cualquier acento. */
function drawPoop(g, S, accent) {
  const dark = '#4a2c10';
  const light = accent.body[1];
  g.fillStyle = dark;
  // montículo: tres lóbulos apilados de mayor a menor
  g.beginPath();
  g.ellipse(S * .5, S * .68, S * .21, S * .085, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(S * .5, S * .565, S * .155, S * .08, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(S * .5, S * .46, S * .105, S * .07, 0, 0, Math.PI * 2);
  g.fill();
  // punta rizada
  g.beginPath();
  g.ellipse(S * .5, S * .375, S * .062, S * .045, -.35, 0, Math.PI * 2);
  g.fill();
  // remolino con el tono del cuerpo del dado
  g.strokeStyle = light;
  g.lineWidth = S * .012;
  g.beginPath();
  g.moveTo(S * .36, S * .60);
  g.quadraticCurveTo(S * .5, S * .545, S * .635, S * .605);
  g.moveTo(S * .41, S * .50);
  g.quadraticCurveTo(S * .5, S * .455, S * .585, S * .505);
  g.stroke();
  // brillo, mismo estilo que los pips
  g.fillStyle = 'rgba(255,230,160,.3)';
  g.beginPath();
  g.arc(S * .435, S * .415, S * .026, 0, Math.PI * 2);
  g.fill();
}

/* Calavera estilizada para el 6 del dado de Ira: silueta oscura (contrasta con
 * cualquier acento) con cuencas/nariz/dientes del tono medio del propio dado. */
function drawSkull(g, S, accent) {
  const dark = '#3d2708';
  const light = accent.body[1];
  // cráneo + mandíbula
  g.fillStyle = dark;
  g.beginPath();
  g.ellipse(S * .5, S * .40, S * .185, S * .168, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.roundRect(S * .395, S * .515, S * .21, S * .135, S * .035);
  g.fill();
  // cuencas, nariz y dientes en el tono del cuerpo
  g.fillStyle = light;
  for (const ex of [S * .428, S * .572]) {
    g.beginPath();
    g.ellipse(ex, S * .388, S * .038, S * .046, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(S * .5, S * .438);
  g.lineTo(S * .5 + S * .026, S * .492);
  g.lineTo(S * .5 - S * .026, S * .492);
  g.closePath();
  g.fill();
  for (const tx of [S * .452, S * .5, S * .548]) {
    g.beginPath();
    g.roundRect(tx - S * .008, S * .545, S * .016, S * .068, S * .006);
    g.fill();
  }
  // brillo, mismo estilo que los pips
  g.fillStyle = 'rgba(255,230,160,.3)';
  g.beginPath();
  g.arc(S * .44, S * .30, S * .030, 0, Math.PI * 2);
  g.fill();
}

function faceTexture(value, wrath, accent = ACCENTS.gold) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  // cuerpo del dado
  if (wrath) {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, accent.body[0]);
    grad.addColorStop(.5, accent.body[1]);
    grad.addColorStop(1, accent.body[2]);
    g.fillStyle = grad;
  } else {
    const grad = g.createRadialGradient(S * .38, S * .34, S * .1, S * .5, S * .5, S * .75);
    grad.addColorStop(0, '#faf5e6');
    grad.addColorStop(1, '#ddd3ba');
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, S, S);

  // borde interior sutil (aspecto de dado tallado)
  g.strokeStyle = wrath ? 'rgba(90,58,10,.55)' : 'rgba(90,80,60,.35)';
  g.lineWidth = 5;
  g.strokeRect(9, 9, S - 18, S - 18);

  // pips — en el dado de Ira: 6 = calavera, 1 = caca, resto = pips normales
  const pip = PIP_LAYOUT[value];
  if (wrath && value === 6) {
    drawSkull(g, S, accent);
  } else if (wrath && value === 1) {
    drawPoop(g, S, accent);
  } else {
  g.fillStyle = wrath ? '#3d2708' : '#33291a';
  for (const [x, y] of pip) {
    g.beginPath();
    g.arc(x * S, y * S, S * .085, 0, Math.PI * 2);
    g.fill();
    // brillo del pip
    g.fillStyle = wrath ? 'rgba(255,230,160,.35)' : 'rgba(255,255,255,.25)';
    g.beginPath();
    g.arc(x * S - S * .018, y * S - S * .022, S * .028, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = wrath ? '#3d2708' : '#33291a';
  }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeMaterials(wrath, accent, cache) {
  // orden BoxGeometry: +x, -x, +y, -y, +z, -z  → valores según FACE_VALUES.
  // Las texturas (canvas 256²) se cachean: 12 en total, no 6 por dado.
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const pre = wrath ? 'w' : 'n';
  return order.map(name => new THREE.MeshStandardMaterial({
    map: cache[pre + name] || (cache[pre + name] = faceTexture(FACE_VALUES[name], wrath, accent)),
    roughness: wrath ? .35 : .5,
    metalness: wrath ? .45 : .05,
    emissive: new THREE.Color(wrath ? accent.emissive : 0x000000),
    emissiveIntensity: wrath ? .28 : 0,
    transparent: true,
    opacity: 1
  }));
}

/* Dado con esquinas redondeadas: parte de un BoxGeometry subdividido y empuja
 * cada vértice a la cápsula del cubo (cubo interior + radio). Conserva los 6
 * grupos de material y los UV, así que las caras de pips siguen intactas. */
function roundedBoxGeometry(size, radius) {
  const seg = 6;
  const g = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const inner = size / 2 - radius;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      Math.max(-inner, Math.min(inner, v.x)),
      Math.max(-inner, Math.min(inner, v.y)),
      Math.max(-inner, Math.min(inner, v.z))
    );
    d.copy(v).sub(c);
    const len = d.length();
    if (len > 1e-6) {
      d.divideScalar(len);
      pos.setXYZ(i, c.x + d.x * radius, c.y + d.y * radius, c.z + d.z * radius);
      nor.setXYZ(i, d.x, d.y, d.z);
    }
  }
  return g;
}

/* Halo aditivo (billboard) para rodear el dado con "fuego" sin lavar su textura */
const _glowTexCache = {};
function glowTexture() {
  if (_glowTexCache.tex) return _glowTexCache.tex;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,.9)');
  grad.addColorStop(.45, 'rgba(255,255,255,.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _glowTexCache.tex = tex;
  return tex;
}

/* ---------- escena ---------- */

export class DiceScene {
  constructor(canvas, { onClack } = {}) {
    this.canvas = canvas;
    this.onClack = onClack || (() => {});
    this.dice = [];              // {mesh, body, value, wrath, settleFrames}
    this.world = null;
    this.lastClack = 0;
    this.settleCounter = 0;
    this.rollActive = false;
    this.onSettled = null;
    this.fadeState = null;       // {t0, dur, done}
    this.accent = ACCENTS.gold;
    this.viewRect = null;        // {x,y,w,h} fracción de pantalla (null = toda)
    this.cameraAngle = 50;       // grados desde el suelo: 90 = cenital, 10 = muy rasante
    this.wallHeight = 1.5;       // altura a la que se calculan las paredes lejanas/laterales
    this.wallBodies = [];
    this._tex = {};              // caché de texturas de cara (12 en total)
    this._geo = {};              // caché de geometrías por tamaño

    this.renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, .1, 200);

    const amb = new THREE.AmbientLight(0xffffff, 1.1);
    const dir = new THREE.DirectionalLight(0xfff2dd, 2.2);
    dir.position.set(-6, 14, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -14; dir.shadow.camera.right = 14;
    dir.shadow.camera.top = 14; dir.shadow.camera.bottom = -14;
    const rim = new THREE.DirectionalLight(0x8899ff, .5);
    rim.position.set(8, 6, -8);
    this.scene.add(amb, dir, rim);

    // suelo invisible que solo recibe sombras (se ve el mapa de Arkenforge debajo)
    this.shadowGround = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.ShadowMaterial({ opacity: .3 })
    );
    this.shadowGround.rotation.x = -Math.PI / 2;
    this.shadowGround.receiveShadow = true;
    this.scene.add(this.shadowGround);

    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this._onCollide = this._onCollide.bind(this);
    this.resize();
    this.renderer.setAnimationLoop(this._loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // la escena se renderiza solo dentro de la zona de caída (o toda la pantalla)
    const r = this.viewRect || { x: 0, y: 0, w: 1, h: 1 };
    this.vp = {
      x: r.x * w,
      y: (1 - r.y - r.h) * h,   // WebGL mide y desde abajo
      w: r.w * w,
      h: r.h * h
    };
    this.camera.aspect = this.vp.w / Math.max(1, this.vp.h);
    // posición de la cámara según el ángulo (se mira siempre al centro del suelo)
    const theta = Math.min(89.4, Math.max(10, this.cameraAngle)) * Math.PI / 180;
    const R = 15.05;
    this.camera.position.set(0, R * Math.sin(theta), .8 + R * Math.cos(theta));
    this.camera.lookAt(0, 0, .8);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this._computeQuads();
    // no reconstruir la física con una tirada en vuelo (los cuerpos se perderían)
    if (!this.rollActive) this._buildPhysics();
  }

  /* zona de pantalla (fracciones 0-1) donde caen los dados */
  setViewport(rect) {
    this.viewRect = rect;
    this.resize();
  }

  setCameraAngle(deg) {
    this.cameraAngle = Math.min(90, Math.max(10, Number(deg) || 50));
    this.resize();
  }

  setAccent(name) {
    this.accent = resolveAccent(name);
    this._tex = {};   // las texturas dependen del acento → regenerar
  }

  /* Trapecio visible a una altura h del suelo: la cámara mira inclinada, así que
   * el suelo visible es un trapecio (estrecho cerca de cámara, ancho al fondo).
   * Se calcula lanzando rayos por las esquinas del frustum. El borde superior se
   * limita a MAXDEPTH de profundidad: con cámaras rasantes el "infinito" del
   * horizonte no es un sitio donde poner dados. */
  _quadAt(h) {
    const cam = this.camera;
    const ray = (nx, ny) => {
      const d = new THREE.Vector3(nx, ny, .5).unproject(cam).sub(cam.position).normalize();
      if (d.y > -1e-4) return null;   // rayo hacia arriba: no toca el suelo
      const t = (h - cam.position.y) / d.y;
      return cam.position.clone().addScaledVector(d, t);
    };
    const nearL = ray(-1, -1), nearR = ray(1, -1);
    if (!nearL || !nearR) return null;
    const zN = Math.max(nearL.z, nearR.z);
    const MAXDEPTH = 24;
    const zCenter = ny => { const p = ray(0, ny); return p ? p.z : -1e9; };
    let ny = 1;
    if (zCenter(1) < zN - MAXDEPTH) {
      // demasiado lejos (o horizonte): buscar la altura de pantalla límite
      let lo = -1, hi = 1;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        if (zCenter(mid) < zN - MAXDEPTH) hi = mid; else lo = mid;
      }
      ny = lo;
    }
    const farL = ray(-1, ny), farR = ray(1, ny);
    if (!farL || !farR) return null;
    // margen del 5% para que un dado apoyado en la pared no roce el borde
    const c = nearL.clone().add(nearR).add(farL).add(farR).multiplyScalar(.25);
    const sh = p => p.clone().lerp(c, .05);
    return { nearL: sh(nearL), nearR: sh(nearR), farL: sh(farL), farR: sh(farR) };
  }

  _computeQuads() {
    this.groundQuad = this._quadAt(0);
    this.raisedQuad = this._quadAt(this.wallHeight);
    const q = this.groundQuad;
    if (q) {
      this.worldHalfW = Math.min(Math.abs(q.nearR.x), Math.abs(q.nearL.x));
      this.worldZNear = Math.max(q.nearL.z, q.nearR.z);
      this.worldZFar = Math.min(q.farL.z, q.farR.z);
    }
  }

  _buildPhysics() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
    this.world.allowSleep = true;
    const mat = new CANNON.Material('die');
    const groundMat = new CANNON.Material('ground');
    this.world.addContactMaterial(new CANNON.ContactMaterial(mat, groundMat, {
      friction: .25, restitution: .32
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, {
      friction: .18, restitution: .4
    }));
    this.dieMaterial = mat;
    this.groundMat = groundMat;

    const addPlane = (n, pos, track) => {
      const p = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
      p.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), n);
      p.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(p);
      if (track) this.wallBodies.push(p);
    };
    addPlane(new CANNON.Vec3(0, 1, 0), { x: 0, y: 0, z: 0 });    // suelo
    addPlane(new CANNON.Vec3(0, -1, 0), { x: 0, y: 14, z: 0 });  // techo (por si acaso)
    this.wallBodies = [];
    this._buildWalls();
  }

  /* Paredes de contención, dinámicas con el ángulo de cámara:
   * - la pared cercana (abajo en pantalla) se calcula a nivel del suelo: al
   *   elevarse, un dado se adentra en pantalla, nunca se corta;
   * - la lejana y las laterales se calculan a la ALTURA DEL DADO: su cara
   *   superior es lo primero que cruzaría el borde superior de la pantalla. */
  _buildWalls() {
    if (!this.world) return;
    for (const b of this.wallBodies) { try { this.world.removeBody(b); } catch {} }
    this.wallBodies = [];
    const q = this.raisedQuad || this.groundQuad;
    const g = this.groundQuad;
    if (!q || !g) return;

    const addWall = (n, pos) => {
      const p = new CANNON.Body({ mass: 0, material: this.groundMat, shape: new CANNON.Plane() });
      p.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), n);
      p.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(p);
      this.wallBodies.push(p);
    };

    const zN = Math.max(g.nearL.z, g.nearR.z);      // pared delante (borde inferior)
    const zF = Math.min(q.farL.z, q.farR.z);        // pared detrás (borde superior, a altura de dado)
    addWall(new CANNON.Vec3(0, 0, -1), { x: 0, y: 0, z: zN });
    addWall(new CANNON.Vec3(0, 0, 1), { x: 0, y: 0, z: zF });

    const side = (a, b) => {      // pared vertical alineada con el borde lateral del trapecio
      let dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      let nx = -dz, nz = dx;
      const cx = (q.nearL.x + q.nearR.x + q.farL.x + q.farR.x) / 4;
      const cz = (q.nearL.z + q.nearR.z + q.farL.z + q.farR.z) / 4;
      if ((cx - a.x) * nx + (cz - a.z) * nz < 0) { nx = -nx; nz = -nz; }
      addWall(new CANNON.Vec3(nx, 0, nz), { x: a.x, y: 0, z: a.z });
    };
    side(q.nearL, q.farL);
    side(q.nearR, q.farR);
  }

  /* recalcula las paredes para la altura real de los dados de la tirada */
  updateWalls(height) {
    this.wallHeight = height;
    this.raisedQuad = this._quadAt(height);
    this._buildWalls();
  }

  /* ---------- lanzamiento ---------- */

  throwDice(count, { wrathIndex = -1, scale = 1 } = {}) {
    this.clearDice();
    this.rollActive = true;
    this.settleCounter = 0;
    // tamaño: los dados ocupan ~22% del área del trapecio visible (ni gigantes ni perdidos)
    const g = this.groundQuad;
    const nearW = Math.abs(g.nearR.x - g.nearL.x), farW = Math.abs(g.farR.x - g.farL.x);
    const depth = this.worldZNear - this.worldZFar;
    const size = Math.max(.28, Math.min(1.5,
      Math.sqrt((nearW + farW) / 2 * depth * .22 / Math.max(1, count)))) * scale;
    // paredes a la altura real de ESTA tirada (la cara superior no puede cortarse)
    this.updateWalls(size);

    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const gkey = size.toFixed(2);
    const geo = this._geo[gkey] || (this._geo[gkey] = roundedBoxGeometry(size, size * .13));
    const castShadow = count <= 60;   // en pools enormes, las sombras son el mayor coste

    for (let i = 0; i < count; i++) {
      const wrath = i === wrathIndex;
      const mesh = new THREE.Mesh(geo, makeMaterials(wrath, this.accent, this._tex));
      mesh.castShadow = castShadow;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        mass: 1,
        material: this.dieMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(size / 2 * .96, size / 2 * .96, size / 2 * .96)),
        sleepSpeedLimit: .12,
        sleepTimeLimit: .28
      });

      // posición inicial: rejilla dentro del trapecio (más estrecho cerca de cámara)
      const q = this.raisedQuad;
      const col = i % cols, row = Math.floor(i / cols);
      const u = (col + .5) / cols;                    // 0..1 a lo ancho
      const v = .18 + .64 * ((row + .5) / rows);      // evita los bordes cercano/lejano
      const lx = q.nearL.x + (q.farL.x - q.nearL.x) * v;
      const lz = q.nearL.z + (q.farL.z - q.nearL.z) * v;
      const rx = q.nearR.x + (q.farR.x - q.nearR.x) * v;
      const rz = q.nearR.z + (q.farR.z - q.nearR.z) * v;
      body.position.set(
        lx + (rx - lx) * u + (Math.random() - .5) * .6,
        5.5 + Math.random() * 2.5 + row * .7,
        lz + (rz - lz) * u + (Math.random() - .5) * .6
      );
      body.quaternion.setFromEuler(
        Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2
      );
      body.velocity.set(
        (Math.random() - .5) * 7,
        -(2 + Math.random() * 3),
        (Math.random() - .5) * 4
      );
      body.angularVelocity.set(
        (Math.random() - .5) * 22,
        (Math.random() - .5) * 22,
        (Math.random() - .5) * 22
      );
      body.addEventListener('collide', this._onCollide);
      this.world.addBody(body);

      this.dice.push({
        mesh, body, wrath, value: 0, settleFrames: 0, size,
        baseEmissive: wrath ? .28 : 0,
        emissiveBase: wrath ? this.accent.emissive : 0x000000
      });
    }
    return this.dice.map(d => d.wrath);
  }

  _onCollide(e) {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 1.4) {
      const now = performance.now();
      if (now - this.lastClack > 28) {
        this.lastClack = now;
        this.onClack(Math.min(1, v / 14));
      }
    }
  }

  /* lee la cara superior desde el quaternion del cuerpo */
  _readFaces() {
    const up = new THREE.Vector3(0, 1, 0);
    for (const d of this.dice) {
      let best = -2, value = 1;
      for (const ax of AXES) {
        const v = ax.axis.clone().applyQuaternion(d.mesh.quaternion);
        if (v.y > best) { best = v.y; value = ax.value; }
      }
      d.value = value;
    }
  }

  _allSettled() {
    return this.dice.every(d =>
      d.body.sleepState === CANNON.Body.SLEEPING ||
      (d.body.velocity.length() < .1 && d.body.angularVelocity.length() < .1)
    );
  }

  clearDice() {
    for (const d of this.dice) {
      d.body.removeEventListener('collide', this._onCollide);
      this.world.removeBody(d.body);
      this.scene.remove(d.mesh);
      // geometría y texturas son compartidas (caché): solo se liberan los materiales
      d.mesh.material.forEach(m => m.dispose());
      if (d.glowSprite) d.glowSprite.material.dispose();
    }
    this.dice = [];
    this.rollActive = false;
    this.fadeState = null;
  }

  /* empieza el fundido a negro (transparente) de todos los dados */
  startFade(dur = 600) {
    if (this.dice.length) this.fadeState = { t0: performance.now(), dur };
  }

  projectToScreen(pos) {
    const v = pos.clone().project(this.camera);
    const vp = this.vp || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    return {
      x: vp.x + (v.x * .5 + .5) * vp.w,
      y: vp.y + (-v.y * .5 + .5) * vp.h
    };
  }

  screenPositions() {
    return this.dice.map(d => ({
      ...this.projectToScreen(d.mesh.position),
      value: d.value,
      wrath: d.wrath
    }));
  }

  wrathSpeed() {
    const w = this.dice.find(d => d.wrath);
    return w ? w.body.velocity.length() : 0;
  }

  wrathScreenPos() {
    const w = this.dice.find(d => d.wrath);
    return w ? this.projectToScreen(w.mesh.position) : null;
  }

  _loop() {
    const dt = Math.min(this.clock.getDelta(), .05);
    if (this.rollActive && this.world) {
      this.world.step(1 / 120, dt, 6);
      for (const d of this.dice) {
        d.mesh.position.copy(d.body.position);
        d.mesh.quaternion.copy(d.body.quaternion);
      }
      if (this._allSettled()) {
        this.settleCounter++;
        if (this.settleCounter > 8) {
          this.rollActive = false;
          this._readFaces();
          this.onSettled?.(this.dice.map(d => d.value));
        }
      } else {
        this.settleCounter = 0;
      }
    }

    // respiración del dado de Ira
    const t = performance.now() / 1000;
    for (const d of this.dice) {
      if (d.wrath && !d.flash) {
        d.mesh.material.forEach(m => {
          m.emissiveIntensity = .22 + Math.sin(t * 4) * .1;
        });
      }
      // pulso del halo de fuego (pifia/gloria)
      if (d.glowSprite) {
        d.glowSprite.material.opacity = .5 + Math.sin(t * 6) * .22;
        const s = 2.9 * d.size * (1 + Math.sin(t * 6) * .07);
        d.glowSprite.scale.set(s, s, 1);
      }
    }

    // fundido de salida
    if (this.fadeState) {
      const k = Math.min(1, (performance.now() - this.fadeState.t0) / this.fadeState.dur);
      for (const d of this.dice) {
        d.mesh.material.forEach(m => { m.opacity = 1 - k; });
        d.mesh.castShadow = k < .3;
      }
      this.shadowGround.material.opacity = .3 * (1 - k);
      if (k >= 1) { this.clearDice(); this.shadowGround.material.opacity = .3; }
      else for (const d of this.dice) if (d.glowSprite) d.glowSprite.material.opacity *= (1 - k);
    }

    // render solo dentro de la zona de caída (scissor recorta el resto)
    const vp = this.vp || { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    this.renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
    this.renderer.setScissor(vp.x, vp.y, vp.w, vp.h);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
  }

  /* resalta un dado durante el conteo (índice en orden de lanzamiento) */
  highlight(index, color, intensity = 1.4, ms = 300) {
    const d = this.dice[index];
    if (!d) return;
    d.flash = true;
    const mats = d.mesh.material;
    mats.forEach(m => { m.emissive.set(color); m.emissiveIntensity = intensity; });
    setTimeout(() => {
      mats.forEach(m => {
        m.emissive.set(d.emissiveBase);
        m.emissiveIntensity = d.baseEmissive;
        d.flash = false;
      });
    }, ms);
  }

  /* halo fijo alrededor del dado (pifia/gloria): fuego perimetral que pulsa y
   * deja la cara del dado perfectamente legible */
  lockGlow(index, color) {
    const d = this.dice[index];
    if (!d || d.glow) return;
    d.glow = color;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(),
      color, transparent: true, opacity: .7,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const s = d.mesh.geometry.parameters.width * 2.9;
    sprite.scale.set(s, s, 1);
    d.mesh.add(sprite);
    d.glowSprite = sprite;
    // calentita sutil en el propio dado, sin lavar la textura
    d.mesh.material.forEach(m => { m.emissive.set(color); m.emissiveIntensity = .45; });
  }
}
