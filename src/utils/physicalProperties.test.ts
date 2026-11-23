import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MATERIAL_SPECS,
  computeMeshPhysicalProperties,
  rescalePhysicalProperties,
  formatMassDisplay,
} from './physicalProperties';

/**
 * Extracts world-space triangle vertex coordinates from a Three.js BufferGeometry.
 */
function extractTriangles(geom: THREE.BufferGeometry, offset: [number, number, number] = [0, 0, 0]): Float32Array {
  const posAttr = geom.attributes.position;
  const idxAttr = geom.index;
  const out: number[] = [];
  const [ox, oy, oz] = offset;

  if (idxAttr) {
    for (let i = 0; i < idxAttr.count; i++) {
      const idx = idxAttr.getX(i);
      out.push(posAttr.getX(idx) + ox, posAttr.getY(idx) + oy, posAttr.getZ(idx) + oz);
    }
  } else {
    for (let i = 0; i < posAttr.count; i++) {
      out.push(posAttr.getX(i) + ox, posAttr.getY(i) + oy, posAttr.getZ(i) + oz);
    }
  }
  return new Float32Array(out);
}

describe('Physical Properties Engine (Mass, CoM, Inertia Tensor)', () => {
  it('computes exact analytical volume, mass, CoM, and inertia tensor for a 40x20x10 mm box', () => {
    // 40 mm x 20 mm x 10 mm = 4 cm x 2 cm x 1 cm -> V = 8 cm³
    // Aluminum 6061-T6 density = 2.70 g/cm³ -> m = 21.60 g
    // Analytical I_xx = (1/12) * 21.6 * (2² + 1²) = 9.00 g·cm²
    // Analytical I_yy = (1/12) * 21.6 * (4² + 1²) = 30.60 g·cm²
    // Analytical I_zz = (1/12) * 21.6 * (4² + 2²) = 36.00 g·cm²
    const box = new THREE.BoxGeometry(40, 20, 10);
    const tris = extractTriangles(box);
    const props = computeMeshPhysicalProperties(tris, 'anodized_blue');

    assert.equal(props.volumeCm3, 8);
    assert.equal(props.surfaceAreaCm2, 28); // 2*(4*2 + 4*1 + 2*1) = 28 cm²
    assert.equal(props.massGrams, 21.6);
    assert.equal(props.centerOfMassMm.x, 0);
    assert.equal(props.centerOfMassMm.y, 0);
    assert.equal(props.centerOfMassMm.z, 0);

    assert.ok(Math.abs(props.inertiaTensorGCm2.ixx - 9.0) < 0.02);
    assert.ok(Math.abs(props.inertiaTensorGCm2.iyy - 30.6) < 0.02);
    assert.ok(Math.abs(props.inertiaTensorGCm2.izz - 36.0) < 0.02);
    assert.equal(props.inertiaTensorGCm2.ixy, 0);
    assert.equal(props.inertiaTensorGCm2.ixz, 0);
    assert.equal(props.inertiaTensorGCm2.iyz, 0);

    assert.deepEqual(props.principalMomentsGCm2, [9, 30.6, 36]);
  });

  it('tracks shifted Center of Mass and preserves CoM inertia invariance under translation', () => {
    const box = new THREE.BoxGeometry(40, 20, 10);
    const shiftedTris = extractTriangles(box, [15, 25, -10]);
    const props = computeMeshPhysicalProperties(shiftedTris, 'anodized_blue');

    assert.equal(props.centerOfMassMm.x, 15);
    assert.equal(props.centerOfMassMm.y, 25);
    assert.equal(props.centerOfMassMm.z, -10);

    // Inertia tensor about CoM MUST remain identical regardless of translation
    assert.ok(Math.abs(props.inertiaTensorGCm2.ixx - 9.0) < 0.02);
    assert.ok(Math.abs(props.inertiaTensorGCm2.iyy - 30.6) < 0.02);
    assert.ok(Math.abs(props.inertiaTensorGCm2.izz - 36.0) < 0.02);
  });

  it('matches analytical cylinder volume, mass, and axial moment of inertia I_yy = 0.5 * m * r²', () => {
    // Radius = 20 mm (2 cm), Height = 50 mm (5 cm)
    // V = pi * 2² * 5 ≈ 62.83 cm³; Titan Grade 5 density = 4.43 g/cm³
    const r = 20;
    const h = 50;
    const cyl = new THREE.CylinderGeometry(r, r, h, 96);
    const tris = extractTriangles(cyl, [0, h / 2, 0]);
    const props = computeMeshPhysicalProperties(tris, 'titanium');

    const exactVolCm3 = Math.PI * 2 * 2 * 5;
    const exactMassG = exactVolCm3 * MATERIAL_SPECS.titanium.densityGCm3;
    const exactIyy = 0.5 * exactMassG * (2 * 2); // 0.5 * m * r_cm²
    const exactIxx = (1 / 12) * exactMassG * (3 * 2 * 2 + 5 * 5);

    assert.ok(Math.abs(props.volumeCm3 - exactVolCm3) / exactVolCm3 < 0.005);
    assert.ok(Math.abs(props.massGrams - exactMassG) / exactMassG < 0.005);
    assert.ok(Math.abs(props.centerOfMassMm.y - 25) < 0.05);
    assert.ok(Math.abs(props.inertiaTensorGCm2.iyy - exactIyy) / exactIyy < 0.01);
    assert.ok(Math.abs(props.inertiaTensorGCm2.ixx - exactIxx) / exactIxx < 0.01);
    assert.ok(Math.abs(props.inertiaTensorGCm2.izz - exactIxx) / exactIxx < 0.01);
  });

  it('scales mass and inertia tensor proportionally across material finishes', () => {
    const box = new THREE.BoxGeometry(30, 30, 30); // 27 cm³
    const tris = extractTriangles(box);
    const pmma = computeMeshPhysicalProperties(tris, 'frosted_glass'); // 1.18 g/cm³
    const brass = computeMeshPhysicalProperties(tris, 'brushed_gold'); // 8.47 g/cm³

    const expectedRatio = MATERIAL_SPECS.brushed_gold.densityGCm3 / MATERIAL_SPECS.frosted_glass.densityGCm3;
    assert.ok(Math.abs(brass.massGrams / pmma.massGrams - expectedRatio) < 0.005);
    assert.ok(Math.abs(brass.inertiaTensorGCm2.ixx / pmma.inertiaTensorGCm2.ixx - expectedRatio) < 0.005);

    // Rescale helper should produce identical mass & inertia
    const rescaled = rescalePhysicalProperties(pmma, 'brushed_gold');
    assert.ok(Math.abs(rescaled.massGrams - brass.massGrams) < 0.05);
    assert.ok(Math.abs(rescaled.inertiaTensorGCm2.ixx - brass.inertiaTensorGCm2.ixx) < 0.1);
  });

  it('handles inverted triangle winding gracefully without negative mass', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const tris = extractTriangles(box);
    // Flip winding of every triangle by swapping vertex 1 and vertex 2
    for (let i = 0; i < tris.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const tmp = tris[i + 3 + k];
        tris[i + 3 + k] = tris[i + 6 + k];
        tris[i + 6 + k] = tmp;
      }
    }
    const props = computeMeshPhysicalProperties(tris, 'matte_polymer');
    assert.equal(props.volumeCm3, 8);
    assert.ok(props.massGrams > 0);
    assert.ok(props.inertiaTensorGCm2.ixx > 0);
  });

  it('formats gram and kilogram display strings cleanly', () => {
    assert.equal(formatMassDisplay(21.6), '21,6 g');
    assert.equal(formatMassDisplay(1485), '1,49 kg');
  });
});
