/* DiceScene — dados d6 3D con física real (three.js + cannon-es).
 * Canvas con alpha para flotar sobre Arkenforge. La física decide el resultado:
 * los dados se lanzan, rebotan y la cara superior se lee del quaternion. */
import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';

const DIE_SIZE = 1.5;

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

function faceTexture(value, wrath) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  // cuerpo del dado
  if (wrath) {
    const grad = g.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#e8b64c');
    grad.addColorStop(.5, '#d29a33');
    grad.addColorStop(1, '#b57f22');
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

  // pips
  const pip = PIP_LAYOUT[value];
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

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeMaterials(wrath) {
  // orden BoxGeometry: +x, -x, +y, -y, +z, -z  → valores según FACE_VALUES
  const order = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  return order.map(name => new THREE.MeshStandardMaterial({
    map: faceTexture(FACE_VALUES[name], wrath),
    roughness: wrath ? .35 : .5,
    metalness: wrath ? .45 : .05,
    emissive: new THREE.Color(wrath ? 0xcf8f1f : 0x000000),
    emissiveIntensity: wrath ? .28 : 0,
    transparent: true,
    opacity: 1
  }));
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

    this.renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: true
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
    this.camera.aspect = w / h;
    const dist = 15.5;
    // encuadre: el ancho visible en el suelo cubre siempre ~21 unidades
    const vFov = this.camera.fov * Math.PI / 180;
    const pitch = .62;               // radianes aprox de la cámara (abajo)
    const halfW = Math.tan(vFov / 2) * this.camera.aspect * dist * (0.55 + pitch * .55);
    this.worldHalfW = Math.min(12, Math.max(8.5, halfW));
    this.camera.position.set(0, 11.5, 10.5);
    this.camera.lookAt(0, 0, .8);
    this.camera.updateProjectionMatrix();
    this._buildPhysics();
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

    const half = this.worldHalfW;
    const addPlane = (n, pos) => {
      const p = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
      p.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), n);
      p.position.set(pos.x, pos.y, pos.z);
      this.world.addBody(p);
    };
    const up = new CANNON.Vec3(0, 1, 0);
    addPlane(up, { x: 0, y: 0, z: 0 });                                   // suelo
    addPlane(new CANNON.Vec3(1, 0, 0), { x: -half, y: 0, z: 0 });        // pared izq
    addPlane(new CANNON.Vec3(-1, 0, 0), { x: half, y: 0, z: 0 });        // pared der
    addPlane(new CANNON.Vec3(0, 0, 1), { x: 0, y: 0, z: -half * .62 });  // pared atrás
    addPlane(new CANNON.Vec3(0, 0, -1), { x: 0, y: 0, z: half * .62 });  // pared delante
    addPlane(new CANNON.Vec3(0, -1, 0), { x: 0, y: 14, z: 0 });          // techo (por si acaso)
  }

  /* ---------- lanzamiento ---------- */

  throwDice(count, { wrathIndex = -1, scale = 1 } = {}) {
    this.clearDice();
    this.rollActive = true;
    this.settleCounter = 0;
    const size = DIE_SIZE * scale;

    for (let i = 0; i < count; i++) {
      const wrath = i === wrathIndex;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        makeMaterials(wrath)
      );
      mesh.castShadow = true;
      this.scene.add(mesh);

      const body = new CANNON.Body({
        mass: 1,
        material: this.dieMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(size / 2 * .96, size / 2 * .96, size / 2 * .96)),
        sleepSpeedLimit: .12,
        sleepTimeLimit: .28
      });

      // posición inicial: repartidos arriba, cayendo hacia el centro
      const cols = Math.ceil(Math.sqrt(count));
      const gx = (i % cols) - (cols - 1) / 2;
      const gz = Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2;
      const spread = Math.min(this.worldHalfW * .75, 9);
      body.position.set(
        gx * (spread / Math.max(1, cols / 2)) + (Math.random() - .5),
        7.5 + Math.random() * 3.5 + gz * .8,
        gz * 2.2 + (Math.random() - .5) * 1.5
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
        mesh, body, wrath, value: 0, settleFrames: 0,
        baseEmissive: wrath ? .28 : 0
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
      d.mesh.geometry.dispose();
      d.mesh.material.forEach(m => m.dispose());
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
    return {
      x: (v.x * .5 + .5) * window.innerWidth,
      y: (-v.y * .5 + .5) * window.innerHeight
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
        if (this.settleCounter > 20) {
          this.rollActive = false;
          this._readFaces();
          this.onSettled?.(this.dice.map(d => d.value));
        }
      } else {
        this.settleCounter = 0;
      }
    }

    // respiración dorada del dado de Ira
    const t = performance.now() / 1000;
    for (const d of this.dice) {
      if (d.wrath && !d.flash) {
        d.mesh.material.forEach(m => {
          m.emissiveIntensity = .22 + Math.sin(t * 4) * .1;
        });
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
    }

    this.renderer.render(this.scene, this.camera);
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
        m.emissive.set(d.wrath ? 0xcf8f1f : 0x000000);
        m.emissiveIntensity = d.baseEmissive;
        d.flash = false;
      });
    }, ms);
  }

  /* mantén un dado encendido fijo (pifia/glory) */
  lockGlow(index, color, intensity = 1.8) {
    const d = this.dice[index];
    if (!d) return;
    d.flash = true;
    d.mesh.material.forEach(m => { m.emissive.set(color); m.emissiveIntensity = intensity; });
  }
}
