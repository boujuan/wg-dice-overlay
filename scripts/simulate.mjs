#!/usr/bin/env node
/* 🎲 W&G 3D Dice Engine — Parallel Monte Carlo Simulation & Bias Analyzer
 * Runs the exact three.js + cannon-es physics engine from overlay/dice.js
 * in parallel across worker threads, computing statistical metrics (Chi-Square,
 * p-value, W&G rules, cocked dice) and rendering terminal plots.
 */

process.removeAllListeners('warning');

import { isMainThread, Worker, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ============================================================================
// ANSI Color & Formatting Helpers
// ============================================================================
const useColor = process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes('--no-color');
const c = {
  reset: s => useColor ? `\x1b[0m${s}\x1b[0m` : s,
  bold: s => useColor ? `\x1b[1m${s}\x1b[22m` : s,
  dim: s => useColor ? `\x1b[2m${s}\x1b[22m` : s,
  cyan: s => useColor ? `\x1b[36m${s}\x1b[39m` : s,
  green: s => useColor ? `\x1b[32m${s}\x1b[39m` : s,
  yellow: s => useColor ? `\x1b[33m${s}\x1b[39m` : s,
  red: s => useColor ? `\x1b[31m${s}\x1b[39m` : s,
  magenta: s => useColor ? `\x1b[35m${s}\x1b[39m` : s,
  bgGreen: s => useColor ? `\x1b[42m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
  bgRed: s => useColor ? `\x1b[41m\x1b[37m\x1b[1m${s}\x1b[0m` : s,
  bgYellow: s => useColor ? `\x1b[43m\x1b[30m\x1b[1m${s}\x1b[0m` : s,
};

// ============================================================================
// Statistical Functions
// ============================================================================

// Lanczos approximation for Gamma(z)
function gamma(z) {
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.138571095836524, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = C[0];
  for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

// Lower incomplete gamma function: P(s, x) = gamma(s, x)
function lowerIncompleteGamma(s, x) {
  let sum = 1 / s;
  let term = 1 / s;
  for (let n = 1; n < 300; n++) {
    term *= x / (s + n);
    sum += term;
    if (term < sum * 1e-14) break;
  }
  return Math.pow(x, s) * Math.exp(-x) * sum;
}

// Chi-Square survival function p-value for df degrees of freedom
function chi2PValue(chi2, df) {
  if (chi2 <= 0) return 1.0;
  const a = df / 2;
  const x = chi2 / 2;
  const p = 1 - lowerIncompleteGamma(a, x) / gamma(a);
  return Math.max(0, Math.min(1, p));
}

// ============================================================================
// Worker Thread Physics Engine Simulation
// ============================================================================
if (!isMainThread) {
  runWorkerSimulation();
}

async function runWorkerSimulation() {
  const { rollsPerPool, poolSizes, scale, cameraAngle, workerId } = workerData;

  const THREE = await import(path.join(projectRoot, 'overlay', 'vendor', 'three.module.js'));
  const CANNON = await import(path.join(projectRoot, 'overlay', 'vendor', 'cannon-es.js'));

  const FACE_VALUES = { px: 3, nx: 4, py: 1, ny: 6, pz: 2, nz: 5 };
  const AXES = [
    { name: 'px', axis: new THREE.Vector3(1, 0, 0), value: FACE_VALUES.px },
    { name: 'nx', axis: new THREE.Vector3(-1, 0, 0), value: FACE_VALUES.nx },
    { name: 'py', axis: new THREE.Vector3(0, 1, 0), value: FACE_VALUES.py },
    { name: 'ny', axis: new THREE.Vector3(0, -1, 0), value: FACE_VALUES.ny },
    { name: 'pz', axis: new THREE.Vector3(0, 0, 1), value: FACE_VALUES.pz },
    { name: 'nz', axis: new THREE.Vector3(0, 0, -1), value: FACE_VALUES.nz }
  ];

  // Camera and frustum setup matching overlay/dice.js
  const camera = new THREE.PerspectiveCamera(42, 1920 / 1080, 0.1, 200);
  const theta = Math.min(89.4, Math.max(10, cameraAngle)) * Math.PI / 180;
  const R = 15.05;
  camera.position.set(0, R * Math.sin(theta), 0.8 + R * Math.cos(theta));
  camera.lookAt(0, 0, 0.8);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const ray = (nx, ny, h = 0) => {
    const d = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    if (d.y > -1e-4) return null;
    const t = (h - camera.position.y) / d.y;
    return camera.position.clone().addScaledVector(d, t);
  };

  const nearL = ray(-1, -1), nearR = ray(1, -1);
  const zN = Math.max(nearL.z, nearR.z);
  const MAXDEPTH = 24;
  const zCenter = ny => { const p = ray(0, ny); return p ? p.z : -1e9; };
  let ny = 1;
  if (zCenter(1) < zN - MAXDEPTH) {
    let lo = -1, hi = 1;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (zCenter(mid) < zN - MAXDEPTH) hi = mid; else lo = mid;
    }
    ny = lo;
  }
  const farL = ray(-1, ny), farR = ray(1, ny);
  const cMid = nearL.clone().add(nearR).add(farL).add(farR).multiplyScalar(0.25);
  const sh = p => p.clone().lerp(cMid, 0.05);
  const groundQuad = { nearL: sh(nearL), nearR: sh(nearR), farL: sh(farL), farR: sh(farR) };

  const nearW = Math.abs(groundQuad.nearR.x - groundQuad.nearL.x);
  const farW = Math.abs(groundQuad.farR.x - groundQuad.farL.x);
  const worldZNear = Math.max(groundQuad.nearL.z, groundQuad.nearR.z);
  const worldZFar = Math.min(groundQuad.farL.z, groundQuad.farR.z);
  const depth = worldZNear - worldZFar;

  const results = {};

  for (const count of poolSizes) {
    const numRolls = rollsPerPool[count] || 0;
    if (numRolls <= 0) continue;

    const poolResult = {
      pool: count,
      rolls: numRolls,
      totalDice: numRolls * count,
      faces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      wrathFaces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      cocked: 0,
      icons: 0,
      totalSettleSteps: 0
    };

    // Calculate dynamic size & raisedQuad for this pool size
    const size = Math.max(0.28, Math.min(1.5,
      Math.sqrt((nearW + farW) / 2 * depth * 0.22 / Math.max(1, count)))) * scale;

    const rNL = ray(-1, -1, size), rNR = ray(1, -1, size);
    const rFL = ray(-1, ny, size), rFR = ray(1, ny, size);
    const cH = rNL.clone().add(rNR).add(rFL).add(rFR).multiplyScalar(0.25);
    const shH = p => p.clone().lerp(cH, 0.05);
    const raisedQuad = { nearL: shH(rNL), nearR: shH(rNR), farL: shH(rFL), farR: shH(rFR) };

    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const quat = new THREE.Quaternion();

    for (let r = 0; r < numRolls; r++) {
      // Create new physics world for this roll
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
      world.allowSleep = true;
      const mat = new CANNON.Material('die');
      const groundMat = new CANNON.Material('ground');
      world.addContactMaterial(new CANNON.ContactMaterial(mat, groundMat, { friction: 0.25, restitution: 0.32 }));
      world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.18, restitution: 0.4 }));

      const addPlane = (n, pos) => {
        const p = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
        p.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), n);
        p.position.set(pos.x, pos.y, pos.z);
        world.addBody(p);
      };
      addPlane(new CANNON.Vec3(0, 1, 0), { x: 0, y: 0, z: 0 }); // Ground
      addPlane(new CANNON.Vec3(0, -1, 0), { x: 0, y: 14, z: 0 }); // Ceiling

      // Containment walls
      const zN_w = Math.max(groundQuad.nearL.z, groundQuad.nearR.z);
      const zF_w = Math.min(raisedQuad.farL.z, raisedQuad.farR.z);
      addPlane(new CANNON.Vec3(0, 0, -1), { x: 0, y: 0, z: zN_w });
      addPlane(new CANNON.Vec3(0, 0, 1), { x: 0, y: 0, z: zF_w });

      const side = (a, b) => {
        let dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        let nx = -dz, nz = dx;
        const cx = (raisedQuad.nearL.x + raisedQuad.nearR.x + raisedQuad.farL.x + raisedQuad.farR.x) / 4;
        const cz = (raisedQuad.nearL.z + raisedQuad.nearR.z + raisedQuad.farL.z + raisedQuad.farR.z) / 4;
        if ((cx - a.x) * nx + (cz - a.z) * nz < 0) { nx = -nx; nz = -nz; }
        addPlane(new CANNON.Vec3(nx, 0, nz), { x: a.x, y: 0, z: a.z });
      };
      side(raisedQuad.nearL, raisedQuad.farL);
      side(raisedQuad.nearR, raisedQuad.farR);

      // Create dice bodies
      const diceBodies = [];
      for (let i = 0; i < count; i++) {
        const body = new CANNON.Body({
          mass: 1,
          material: mat,
          shape: new CANNON.Box(new CANNON.Vec3(size / 2 * 0.96, size / 2 * 0.96, size / 2 * 0.96)),
          sleepSpeedLimit: 0.12,
          sleepTimeLimit: 0.28
        });

        const col = i % cols, row = Math.floor(i / cols);
        const u = (col + 0.5) / cols;
        const v = 0.18 + 0.64 * ((row + 0.5) / rows);
        const lx = raisedQuad.nearL.x + (raisedQuad.farL.x - raisedQuad.nearL.x) * v;
        const lz = raisedQuad.nearL.z + (raisedQuad.farL.z - raisedQuad.nearL.z) * v;
        const rx = raisedQuad.nearR.x + (raisedQuad.farR.x - raisedQuad.nearR.x) * v;
        const rz = raisedQuad.nearR.z + (raisedQuad.farR.z - raisedQuad.nearR.z) * v;

        body.position.set(
          lx + (rx - lx) * u + (Math.random() - 0.5) * 0.6,
          5.5 + Math.random() * 2.5 + row * 0.7,
          lz + (rz - lz) * u + (Math.random() - 0.5) * 0.6
        );
        body.quaternion.setFromEuler(
          Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2
        );
        body.velocity.set(
          (Math.random() - 0.5) * 7,
          -(2 + Math.random() * 3),
          (Math.random() - 0.5) * 4
        );
        body.angularVelocity.set(
          (Math.random() - 0.5) * 22,
          (Math.random() - 0.5) * 22,
          (Math.random() - 0.5) * 22
        );
        world.addBody(body);
        diceBodies.push(body);
      }

      // Step simulation until settled
      let settleCounter = 0;
      let stepCount = 0;
      for (stepCount = 0; stepCount < 400; stepCount++) {
        world.step(1 / 120, 1 / 60, 6);
        const allSettled = diceBodies.every(b =>
          b.sleepState === CANNON.Body.SLEEPING ||
          (b.velocity.length() < 0.1 && b.angularVelocity.length() < 0.1)
        );
        if (allSettled) {
          settleCounter++;
          if (settleCounter > 8) break;
        } else {
          settleCounter = 0;
        }
      }
      poolResult.totalSettleSteps += stepCount;

      // Read faces from quaternions
      for (let i = 0; i < diceBodies.length; i++) {
        const b = diceBodies[i];
        quat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        let best = -2, value = 1;
        for (const ax of AXES) {
          const vec = ax.axis.clone().applyQuaternion(quat);
          if (vec.y > best) { best = vec.y; value = ax.value; }
        }
        if (best < 0.8) poolResult.cocked++;
        poolResult.faces[value]++;

        // W&G icons: 4-5 = 1 icon, 6 = 2 icons
        if (value >= 6) poolResult.icons += 2;
        else if (value >= 4) poolResult.icons += 1;

        // Last die is Wrath die in W&G
        if (i === diceBodies.length - 1) {
          poolResult.wrathFaces[value]++;
        }
      }

      // Report progress periodically
      if ((r + 1) % 50 === 0 || r === numRolls - 1) {
        parentPort.postMessage({ type: 'progress', rollsDone: 50 });
      }
    }

    results[count] = poolResult;
  }

  parentPort.postMessage({ type: 'done', results });
}

// ============================================================================
// Main Process / CLI Orchestrator
// ============================================================================
if (isMainThread) {
  main();
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  let rolls = 500;
  let minDice = 1;
  let maxDice = 6;
  let numWorkers = Math.min(cpus().length, 16);
  let scale = 1.0;
  let cameraAngle = 50;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      printHelp();
      process.exit(0);
    } else if (a === '-n' || a === '--rolls') {
      rolls = parseInt(args[++i], 10) || rolls;
    } else if (a === '-r' || a === '--range') {
      const match = /^(\d+)-(\d+)$/.exec(args[++i] || '');
      if (match) {
        minDice = parseInt(match[1], 10);
        maxDice = parseInt(match[2], 10);
      } else if (/^\d+$/.test(args[i])) {
        minDice = maxDice = parseInt(args[i], 10);
      }
    } else if (a === '-w' || a === '--workers') {
      numWorkers = parseInt(args[++i], 10) || numWorkers;
    } else if (a === '--scale') {
      scale = parseFloat(args[++i]) || scale;
    } else if (a === '--camera') {
      cameraAngle = parseFloat(args[++i]) || cameraAngle;
    } else if (/^\d+$/.test(a) && i === 0) {
      rolls = parseInt(a, 10);
    } else if (/^\d+-\d+$/.test(a)) {
      const parts = a.split('-').map(Number);
      minDice = parts[0];
      maxDice = parts[1];
    }
  }

  if (minDice > maxDice) [minDice, maxDice] = [maxDice, minDice];
  minDice = Math.max(1, minDice);
  maxDice = Math.min(60, maxDice);

  return { rolls, minDice, maxDice, numWorkers, scale, cameraAngle };
}

function printHelp() {
  console.log(`
${c.bold('🎲 W&G 3D Dice Engine — Parallel Monte Carlo Simulator')}

${c.cyan('Usage:')}
  node scripts/simulate.mjs [options]
  node scripts/simulate.mjs <rolls> <minDice>-<maxDice>

${c.cyan('Options:')}
  -n, --rolls <N>       Number of throws per pool size (default: 500)
  -r, --range <min-max> Range of dice to simulate (default: 1-6, max: 60)
  -w, --workers <N>     Number of parallel worker threads (default: ${cpus().length})
      --scale <S>       Scale factor for dice (default: 1.0)
      --camera <deg>    Camera elevation angle in degrees (default: 50)
      --no-color        Disable ANSI terminal colors
  -h, --help            Show this help message

${c.cyan('Examples:')}
  ${c.dim('# Quick test: 300 throws for pools of 1 to 5 dice')}
  node scripts/simulate.mjs -n 300 -r 1-5

  ${c.dim('# Rigorous high-sample test: 2,000 throws per pool across 1 to 10 dice')}
  node scripts/simulate.mjs -n 2000 -r 1-10

  ${c.dim('# Single pool test: 10,000 throws of 7 dice')}
  node scripts/simulate.mjs -n 10000 -r 7-7
`);
}

// Render horizontal Unicode bar plot with a vertical target line at expected %
function renderBar(obsPct, expPct, maxScale = 30, barWidth = 32) {
  const targetCol = Math.round((expPct / maxScale) * barWidth);
  const obsCol = Math.round((obsPct / maxScale) * barWidth);

  const fullBlocks = Math.floor((obsPct / maxScale) * barWidth);
  const remainder = ((obsPct / maxScale) * barWidth) - fullBlocks;
  const fractions = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const fracIndex = Math.min(7, Math.floor(remainder * 8));

  let barChars = '█'.repeat(fullBlocks) + (fracIndex > 0 ? fractions[fracIndex] : '');
  if (barChars.length < barWidth) {
    barChars = barChars.padEnd(barWidth, ' ');
  } else {
    barChars = barChars.slice(0, barWidth);
  }

  // Insert target mark '│' at targetCol
  const chars = barChars.split('');
  if (targetCol >= 0 && targetCol < chars.length) {
    if (chars[targetCol] === ' ') chars[targetCol] = c.cyan('│');
    else chars[targetCol] = c.bold(chars[targetCol]);
  }

  const diff = obsPct - expPct;
  let colorFn = c.green;
  if (Math.abs(diff) > 1.5) colorFn = c.red;
  else if (Math.abs(diff) > 0.6) colorFn = c.yellow;

  return colorFn(chars.join(''));
}

async function main() {
  const opts = parseCliArgs();
  const poolSizes = [];
  for (let s = opts.minDice; s <= opts.maxDice; s++) poolSizes.push(s);

  const totalPoolSizes = poolSizes.length;
  const totalRolls = opts.rolls * totalPoolSizes;

  console.log(`\n${c.bold('🎲 W&G 3D Dice Engine — Parallel Monte Carlo Simulation & Bias Analyzer')}`);
  console.log(c.dim('━'.repeat(74)));
  console.log(`  ${c.cyan('Throws per pool:')}  ${c.bold(opts.rolls.toLocaleString())}`);
  console.log(`  ${c.cyan('Dice pool range:')}  ${c.bold(opts.minDice + ' to ' + opts.maxDice + ' dice')} (${totalPoolSizes} pool configurations)`);
  console.log(`  ${c.cyan('Total throws:')}     ${c.bold(totalRolls.toLocaleString())} scheduled across ${c.bold(opts.numWorkers)} parallel threads`);
  console.log(`  ${c.cyan('Camera & Scale:')}   ${opts.cameraAngle}° elevation · scale ${opts.scale}x`);
  console.log(c.dim('━'.repeat(74)));

  // Split rolls per pool across workers
  const workerAssignments = Array.from({ length: opts.numWorkers }, (_, i) => ({
    workerId: i,
    poolSizes,
    rollsPerPool: {},
    scale: opts.scale,
    cameraAngle: opts.cameraAngle
  }));

  for (const size of poolSizes) {
    const base = Math.floor(opts.rolls / opts.numWorkers);
    let rem = opts.rolls % opts.numWorkers;
    for (let w = 0; w < opts.numWorkers; w++) {
      workerAssignments[w].rollsPerPool[size] = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  }

  const t0 = performance.now();
  let completedRolls = 0;

  // Real-time progress bar
  const renderProgress = () => {
    const pct = Math.min(100, (completedRolls / totalRolls) * 100);
    const elapsed = Math.max(0.001, (performance.now() - t0) / 1000);
    const rate = Math.round(completedRolls / elapsed);
    const barLen = 28;
    const filled = Math.round((pct / 100) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));
    process.stdout.write(`\r  ${c.cyan('Simulating:')} [${c.green(bar)}] ${pct.toFixed(1)}% | ${completedRolls.toLocaleString()}/${totalRolls.toLocaleString()} rolls (${rate.toLocaleString()} rolls/s) `);
  };

  renderProgress();

  // Launch workers
  const workerPromises = workerAssignments.map(data => {
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, { workerData: data });
      worker.on('message', msg => {
        if (msg.type === 'progress') {
          completedRolls = Math.min(totalRolls, completedRolls + msg.rollsDone);
          renderProgress();
        } else if (msg.type === 'done') {
          resolve(msg.results);
        }
      });
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  });

  const workerOutputs = await Promise.all(workerPromises);
  const elapsedSec = (performance.now() - t0) / 1000;
  completedRolls = totalRolls;
  renderProgress();
  console.log(`\n  ${c.green('✔')} Simulation completed in ${c.bold(elapsedSec.toFixed(2))}s (${Math.round(totalRolls / elapsedSec).toLocaleString()} throws/s)\n`);

  // Merge results
  const aggregate = {
    totalRolls: 0,
    totalDice: 0,
    faces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    wrathFaces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    cocked: 0,
    icons: 0,
    byPool: {}
  };

  for (const size of poolSizes) {
    aggregate.byPool[size] = {
      pool: size,
      rolls: 0,
      totalDice: 0,
      faces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      wrathFaces: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      cocked: 0,
      icons: 0
    };
  }

  for (const out of workerOutputs) {
    for (const [sStr, res] of Object.entries(out)) {
      const s = parseInt(sStr, 10);
      const target = aggregate.byPool[s];
      target.rolls += res.rolls;
      target.totalDice += res.totalDice;
      target.cocked += res.cocked;
      target.icons += res.icons;
      for (let f = 1; f <= 6; f++) {
        target.faces[f] += res.faces[f];
        target.wrathFaces[f] += res.wrathFaces[f];
        aggregate.faces[f] += res.faces[f];
        aggregate.wrathFaces[f] += res.wrathFaces[f];
      }
      aggregate.totalRolls += res.rolls;
      aggregate.totalDice += res.totalDice;
      aggregate.cocked += res.cocked;
      aggregate.icons += res.icons;
    }
  }

  // ==========================================================================
  // Display Output & Terminal Plots
  // ==========================================================================
  const totalD = aggregate.totalDice;
  const expPerFace = totalD / 6;
  const expPct = 100 / 6;

  console.log(c.bold('📊 1. FACE DISTRIBUTION & TERMINAL PLOT (Overall)'));
  console.log(c.dim('   Target line (│) = theoretical 16.67% expected frequency'));
  console.log('  ' + c.dim('┌──────┬──────────┬─────────┬────────┬──────────────────────────────────┬───────────┐'));
  console.log('  ' + c.dim('│') + c.bold(' Face ') + c.dim('│') + c.bold('  Count   ') + c.dim('│') + c.bold('  Obs%   ') + c.dim('│') + c.bold(' Exp%   ') + c.dim('│') + c.bold(' Distribution Plot (0-25%)        ') + c.dim('│') + c.bold(' Diff (Δ)  ') + c.dim('│'));
  console.log('  ' + c.dim('├──────┼──────────┼─────────┼────────┼──────────────────────────────────┼───────────┤'));

  let chi2 = 0;
  let sumValues = 0;
  let sumSqValues = 0;

  for (let f = 1; f <= 6; f++) {
    const obs = aggregate.faces[f];
    const obsPct = (obs / totalD) * 100;
    const diffPct = obsPct - expPct;
    const diffCount = obs - expPerFace;
    chi2 += (diffCount * diffCount) / expPerFace;

    sumValues += f * obs;
    sumSqValues += (f * f) * obs;

    const bar = renderBar(obsPct, expPct, 25, 32);
    const sign = diffPct > 0 ? '+' : '';
    const diffColor = Math.abs(diffPct) > 1.0 ? c.red : (Math.abs(diffPct) > 0.5 ? c.yellow : c.green);

    console.log(
      `  ${c.dim('│')}  ${c.bold(String(f))}   ${c.dim('│')} ${String(obs.toLocaleString()).padStart(8)} ${c.dim('│')} ${obsPct.toFixed(2).padStart(6)}% ${c.dim('│')} ${expPct.toFixed(2)}% ${c.dim('│')} ${bar} ${c.dim('│')} ${diffColor((sign + diffPct.toFixed(2) + '%').padStart(9))} ${c.dim('│')}`
    );
  }
  console.log('  ' + c.dim('└──────┴──────────┴─────────┴────────┴──────────────────────────────────┴───────────┘'));

  // Statistical Evaluation
  const df = 5;
  const pVal = chi2PValue(chi2, df);
  const meanVal = sumValues / totalD;
  const variance = (sumSqValues / totalD) - (meanVal * meanVal);
  const stdDev = Math.sqrt(Math.max(0, variance));

  console.log(`\n${c.bold('📐 2. HYPOTHESIS TESTING & BIAS VERDICT')}`);
  console.log(`  • ${c.cyan('Chi-Square Statistic (χ²):')} ${c.bold(chi2.toFixed(3))} (df = 5, critical threshold at α=0.05 is 11.07)`);
  console.log(`  • ${c.cyan('p-value:')}                  ${c.bold(pVal.toFixed(4))} ${pVal > 0.05 ? c.green('(p > 0.05: Null hypothesis holds)') : c.red('(p ≤ 0.05: Statistically anomalous)')}`);
  console.log(`  • ${c.cyan('Mean Face Value:')}          ${c.bold(meanVal.toFixed(3))} (Theoretical ideal: 3.500)`);
  console.log(`  • ${c.cyan('Standard Deviation:')}        ${c.bold(stdDev.toFixed(3))} (Theoretical ideal: 1.708)`);

  if (pVal >= 0.05) {
    console.log(`\n  ${c.bgGreen(' PASS ')} ${c.bold(c.green('NO STATISTICAL BIAS DETECTED'))}`);
    console.log(`  ${c.dim('The physics simulation produces outcomes statistically indistinguishable from a fair die.')}`);
  } else if (pVal >= 0.01) {
    console.log(`\n  ${c.bgYellow(' MARGINAL ')} ${c.bold(c.yellow('SLIGHT STATISTICAL VARIATION'))}`);
    console.log(`  ${c.dim('Marginal anomaly detected (0.01 < p < 0.05). Increase sample size to verify if persistent.')}`);
  } else {
    console.log(`\n  ${c.bgRed(' FAIL ')} ${c.bold(c.red('POTENTIAL PHYSICAL BIAS DETECTED (p < 0.01)'))}`);
    console.log(`  ${c.dim('Check initial angle randomization or wall collision geometries.')}`);
  }

  // Wrath & Glory Mechanics
  const totalWrathRolls = aggregate.totalRolls;
  const wrath1 = aggregate.wrathFaces[1];
  const wrath6 = aggregate.wrathFaces[6];
  const wrath1Pct = (wrath1 / totalWrathRolls) * 100;
  const wrath6Pct = (wrath6 / totalWrathRolls) * 100;

  console.log(`\n${c.bold('⚔️  3. WARHAMMER 40K: WRATH & GLORY MECHANICS')}`);
  console.log(`  • ${c.cyan('Total Wrath Dice Throws:')} ${totalWrathRolls.toLocaleString()}`);
  console.log(`  • ${c.red('Complications (Wrath = 1):')} ${wrath1.toLocaleString()} (${wrath1Pct.toFixed(2)}% vs 16.67% exp)`);
  console.log(`  • ${c.yellow('Glorias (Wrath = 6):')}       ${wrath6.toLocaleString()} (${wrath6Pct.toFixed(2)}% vs 16.67% exp)`);
  console.log(`  • ${c.cyan('Total Icons Generated:')}    ${aggregate.icons.toLocaleString()}`);
  console.log(`  • ${c.cyan('Average Icons / Die:')}      ${(aggregate.icons / totalD).toFixed(3)} (Theoretical ideal: 0.667)`);

  // Physical Behaviors
  const cockedPct = (aggregate.cocked / totalD) * 100;
  console.log(`\n${c.bold('🎲 4. PHYSICAL SIMULATION BEHAVIOR')}`);
  console.log(`  • ${c.cyan('Cocked / Leaning Dice (>36° tilt):')} ${aggregate.cocked.toLocaleString()} (${cockedPct.toFixed(2)}% of all dice)`);
  console.log(`  • ${c.dim('Note: Leaning dice are resolved by selecting the face with the maximum upward projection vector.')}`);

  // Per-Pool Breakdown Table
  if (poolSizes.length > 1) {
    console.log(`\n${c.bold('📋 5. BREAKDOWN BY POOL SIZE')}`);
    console.log('  ' + c.dim('┌──────┬────────┬──────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬───────────┬─────────┐'));
    console.log('  ' + c.dim('│') + c.bold(' Pool ') + c.dim('│') + c.bold(' Throws ') + c.dim('│') + c.bold('   Dice   ') + c.dim('│') + c.bold('  1%   ') + c.dim('│') + c.bold('  2%   ') + c.dim('│') + c.bold('  3%   ') + c.dim('│') + c.bold('  4%   ') + c.dim('│') + c.bold('  5%   ') + c.dim('│') + c.bold('  6%   ') + c.dim('│') + c.bold(' Avg Icons ') + c.dim('│') + c.bold(' Cocked% ') + c.dim('│'));
    console.log('  ' + c.dim('├──────┼────────┼──────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼───────────┼─────────┤'));

    for (const size of poolSizes) {
      const res = aggregate.byPool[size];
      const dCount = res.totalDice;
      const fPct = f => ((res.faces[f] / dCount) * 100).toFixed(1) + '%';
      const avgIcons = (res.icons / dCount).toFixed(2);
      const cPct = ((res.cocked / dCount) * 100).toFixed(1) + '%';

      console.log(
        `  ${c.dim('│')}  ${String(size).padStart(2)}d ${c.dim('│')} ${String(res.rolls).padStart(6)} ${c.dim('│')} ${String(dCount.toLocaleString()).padStart(8)} ${c.dim('│')} ${fPct(1).padStart(7)} ${c.dim('│')} ${fPct(2).padStart(7)} ${c.dim('│')} ${fPct(3).padStart(7)} ${c.dim('│')} ${fPct(4).padStart(7)} ${c.dim('│')} ${fPct(5).padStart(7)} ${c.dim('│')} ${fPct(6).padStart(7)} ${c.dim('│')} ${avgIcons.padStart(9)} ${c.dim('│')} ${cPct.padStart(7)} ${c.dim('│')}`
      );
    }
    console.log('  ' + c.dim('└──────┴────────┴──────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴───────────┴─────────┘'));
  }

  console.log('');
}
