import {
  InertiaTensor,
  MaterialFinish,
  MaterialSpec,
  PhysicalProperties,
  Vector3Tuple,
} from '../types/cad';

/**
 * Calibrated engineering material densities (g/cm³) mapped to each AetherCAD surface finish.
 */
export const MATERIAL_SPECS: Record<MaterialFinish, MaterialSpec> = {
  titanium: {
    id: 'titanium',
    name: 'Titan Grade 5',
    shortName: 'Titan',
    alloy: 'Ti-6Al-4V',
    densityGCm3: 4.43,
    swatchClass: 'bg-slate-400',
  },
  anodized_blue: {
    id: 'anodized_blue',
    name: 'Eloxal Aluminium',
    shortName: 'Alu 6061',
    alloy: 'Al 6061-T6',
    densityGCm3: 2.7,
    swatchClass: 'bg-sky-500',
  },
  frosted_glass: {
    id: 'frosted_glass',
    name: 'Acrylglas',
    shortName: 'PMMA',
    alloy: 'PMMA-XT',
    densityGCm3: 1.18,
    swatchClass: 'bg-cyan-300',
  },
  matte_polymer: {
    id: 'matte_polymer',
    name: 'Carbon-Polymer',
    shortName: 'PA12-CF',
    alloy: 'PA12-CF30',
    densityGCm3: 1.32,
    swatchClass: 'bg-slate-700',
  },
  brushed_gold: {
    id: 'brushed_gold',
    name: 'Messing',
    shortName: 'Messing',
    alloy: 'CuZn39Pb3',
    densityGCm3: 8.47,
    swatchClass: 'bg-amber-400',
  },
};

export const MATERIAL_FINISH_LIST: MaterialSpec[] = [
  MATERIAL_SPECS.titanium,
  MATERIAL_SPECS.anodized_blue,
  MATERIAL_SPECS.frosted_glass,
  MATERIAL_SPECS.matte_polymer,
  MATERIAL_SPECS.brushed_gold,
];

function cleanZero(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded;
}

/**
 * Computes the three real eigenvalues of a symmetric 3x3 matrix using Jacobi rotations,
 * returned sorted ascending [I1, I2, I3].
 */
export function computeSymmetric3x3Eigenvalues(tensor: InertiaTensor): [number, number, number] {
  const a: number[][] = [
    [tensor.ixx, tensor.ixy, tensor.ixz],
    [tensor.ixy, tensor.iyy, tensor.iyz],
    [tensor.ixz, tensor.iyz, tensor.izz],
  ];

  for (let sweep = 0; sweep < 20; sweep++) {
    // Find largest off-diagonal element
    let p = 0;
    let q = 1;
    let maxOff = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > maxOff) {
      maxOff = Math.abs(a[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(a[1][2]) > maxOff) {
      maxOff = Math.abs(a[1][2]);
      p = 1;
      q = 2;
    }
    if (maxOff < 1e-12) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];

    const tau = (aqq - app) / (2 * apq);
    const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    a[p][p] = app - t * apq;
    a[q][q] = aqq + t * apq;
    a[p][q] = 0;
    a[q][p] = 0;

    for (let r = 0; r < 3; r++) {
      if (r !== p && r !== q) {
        const arp = a[r][p];
        const arq = a[r][q];
        a[r][p] = c * arp - s * arq;
        a[p][r] = a[r][p];
        a[r][q] = s * arp + c * arq;
        a[q][r] = a[r][q];
      }
    }
  }

  const vals = [Math.max(0, a[0][0]), Math.max(0, a[1][1]), Math.max(0, a[2][2])].sort((x, y) => x - y);
  return [cleanZero(vals[0], 2), cleanZero(vals[1], 2), cleanZero(vals[2], 2)];
}

/**
 * Exact signed-tetrahedron mesh integration for Volume, Surface Area, Mass,
 * Center of Mass (mm), symmetric 3x3 Inertia Tensor about CoM (g·cm²),
 * Principal Moments of Inertia (g·cm²), and Radii of Gyration (mm).
 *
 * Assumes vertex coordinates in `positions` are world-space millimeters (1 unit = 1 mm),
 * stored as sequential triangle triples [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...].
 */
export function computeMeshPhysicalProperties(
  positions: Float32Array | number[],
  finish: MaterialFinish
): PhysicalProperties {
  const material = MATERIAL_SPECS[finish] || MATERIAL_SPECS.titanium;
  const density = material.densityGCm3;
  const triCount = Math.floor(positions.length / 9);

  if (triCount === 0) {
    return {
      material,
      densityGCm3: density,
      volumeCm3: 0,
      surfaceAreaCm2: 0,
      massGrams: 0,
      massKg: 0,
      centerOfMassMm: { x: 0, y: 0, z: 0 },
      inertiaTensorGCm2: { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 },
      principalMomentsGCm2: [0, 0, 0],
      radiusOfGyrationMm: { x: 0, y: 0, z: 0 },
    };
  }

  let signedVolMm3 = 0;
  let surfaceAreaMm2 = 0;
  let cxNum = 0;
  let cyNum = 0;
  let czNum = 0;

  let areaCxNum = 0;
  let areaCyNum = 0;
  let areaCzNum = 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  // Pass 1: Signed volume, surface area, and center of mass
  for (let i = 0; i < triCount; i++) {
    const base = i * 9;
    const x0 = positions[base];
    const y0 = positions[base + 1];
    const z0 = positions[base + 2];
    const x1 = positions[base + 3];
    const y1 = positions[base + 4];
    const z1 = positions[base + 5];
    const x2 = positions[base + 6];
    const y2 = positions[base + 7];
    const z2 = positions[base + 8];

    if (x0 < minX) minX = x0;
    if (x1 < minX) minX = x1;
    if (x2 < minX) minX = x2;
    if (x0 > maxX) maxX = x0;
    if (x1 > maxX) maxX = x1;
    if (x2 > maxX) maxX = x2;

    if (y0 < minY) minY = y0;
    if (y1 < minY) minY = y1;
    if (y2 < minY) minY = y2;
    if (y0 > maxY) maxY = y0;
    if (y1 > maxY) maxY = y1;
    if (y2 > maxY) maxY = y2;

    if (z0 < minZ) minZ = z0;
    if (z1 < minZ) minZ = z1;
    if (z2 < minZ) minZ = z2;
    if (z0 > maxZ) maxZ = z0;
    if (z1 > maxZ) maxZ = z1;
    if (z2 > maxZ) maxZ = z2;

    // Cross product (v1 x v2) for signed tetrahedron volume with origin
    const v1x2x = y1 * z2 - z1 * y2;
    const v1x2y = z1 * x2 - x1 * z2;
    const v1x2z = x1 * y2 - y1 * x2;
    const dV = (x0 * v1x2x + y0 * v1x2y + z0 * v1x2z) / 6;

    signedVolMm3 += dV;
    cxNum += dV * (x0 + x1 + x2) * 0.25;
    cyNum += dV * (y0 + y1 + y2) * 0.25;
    czNum += dV * (z0 + z1 + z2) * 0.25;

    // Surface area: 0.5 * |(v1 - v0) x (v2 - v0)|
    const e1x = x1 - x0;
    const e1y = y1 - y0;
    const e1z = z1 - z0;
    const e2x = x2 - x0;
    const e2y = y2 - y0;
    const e2z = z2 - z0;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    const dA = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);

    surfaceAreaMm2 += dA;
    areaCxNum += dA * ((x0 + x1 + x2) / 3);
    areaCyNum += dA * ((y0 + y1 + y2) / 3);
    areaCzNum += dA * ((z0 + z1 + z2) / 3);
  }

  const hasValidClosedVolume = Math.abs(signedVolMm3) > 1e-4;
  const volSign = signedVolMm3 < 0 ? -1 : 1;

  let cx = 0;
  let cy = 0;
  let cz = 0;

  if (hasValidClosedVolume) {
    cx = cxNum / signedVolMm3;
    cy = cyNum / signedVolMm3;
    cz = czNum / signedVolMm3;
  } else if (surfaceAreaMm2 > 1e-6) {
    cx = areaCxNum / surfaceAreaMm2;
    cy = areaCyNum / surfaceAreaMm2;
    cz = areaCzNum / surfaceAreaMm2;
  } else {
    cx = (minX + maxX) * 0.5;
    cy = (minY + maxY) * 0.5;
    cz = (minZ + maxZ) * 0.5;
  }

  // Pass 2: Canonical covariance tensor relative to Center of Mass
  let cxx = 0;
  let cyy = 0;
  let czz = 0;
  let cxy = 0;
  let cxz = 0;
  let cyz = 0;

  if (hasValidClosedVolume) {
    for (let i = 0; i < triCount; i++) {
      const base = i * 9;
      const ax = positions[base] - cx;
      const ay = positions[base + 1] - cy;
      const az = positions[base + 2] - cz;
      const bx = positions[base + 3] - cx;
      const by = positions[base + 4] - cy;
      const bz = positions[base + 5] - cz;
      const cxp = positions[base + 6] - cx;
      const cyp = positions[base + 7] - cy;
      const czp = positions[base + 8] - cz;

      const dV =
        (volSign *
          (ax * (by * czp - bz * cyp) +
            ay * (bz * cxp - bx * czp) +
            az * (bx * cyp - by * cxp))) /
        6;

      const w = dV / 20;

      cxx += w * (2 * (ax * ax + bx * bx + cxp * cxp) + 2 * (ax * bx + ax * cxp + bx * cxp));
      cyy += w * (2 * (ay * ay + by * by + cyp * cyp) + 2 * (ay * by + ay * cyp + by * cyp));
      czz += w * (2 * (az * az + bz * bz + czp * czp) + 2 * (az * bz + az * czp + bz * czp));

      cxy +=
        w *
        (2 * (ax * ay + bx * by + cxp * cyp) +
          (ax * by + ay * bx) +
          (ax * cyp + ay * cxp) +
          (bx * cyp + by * cxp));

      cxz +=
        w *
        (2 * (ax * az + bx * bz + cxp * czp) +
          (ax * bz + az * bx) +
          (ax * czp + az * cxp) +
          (bx * czp + bz * cxp));

      cyz +=
        w *
        (2 * (ay * az + by * bz + cyp * czp) +
          (ay * bz + az * by) +
          (ay * czp + az * cyp) +
          (by * czp + bz * cyp));
    }
  } else {
    // Fallback for open / non-manifold thin shell: approximate via bounding box solid fraction
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const bd = Math.max(1, maxZ - minZ);
    const estVolMm3 = Math.max(surfaceAreaMm2 * 1.2, bw * bh * bd * 0.25);
    signedVolMm3 = estVolMm3;
    cxx = (estVolMm3 * bw * bw) / 12;
    cyy = (estVolMm3 * bh * bh) / 12;
    czz = (estVolMm3 * bd * bd) / 12;
  }

  const volumeMm3 = Math.abs(signedVolMm3);
  const volumeCm3 = volumeMm3 / 1000;
  const surfaceAreaCm2 = surfaceAreaMm2 / 100;
  const massGrams = volumeCm3 * density;
  const massKg = massGrams / 1000;

  // Convert mm^5 covariance * (g/mm^3) / 100 (mm^2 -> cm^2) => factor = density * 1e-5
  const k = density * 1e-5;
  const rawTensor: InertiaTensor = {
    ixx: Math.max(0, k * (cyy + czz)),
    iyy: Math.max(0, k * (cxx + czz)),
    izz: Math.max(0, k * (cxx + cyy)),
    ixy: -k * cxy,
    ixz: -k * cxz,
    iyz: -k * cyz,
  };

  const principalMomentsGCm2 = computeSymmetric3x3Eigenvalues(rawTensor);

  // Radius of gyration: r_axis = sqrt(I_axis / m) in cm -> * 10 for mm
  const radiusOfGyrationMm: Vector3Tuple =
    massGrams > 1e-6
      ? {
          x: cleanZero(Math.sqrt(rawTensor.ixx / massGrams) * 10, 2),
          y: cleanZero(Math.sqrt(rawTensor.iyy / massGrams) * 10, 2),
          z: cleanZero(Math.sqrt(rawTensor.izz / massGrams) * 10, 2),
        }
      : { x: 0, y: 0, z: 0 };

  return {
    material,
    densityGCm3: density,
    volumeCm3: cleanZero(volumeCm3, 2),
    surfaceAreaCm2: cleanZero(surfaceAreaCm2, 2),
    massGrams: cleanZero(massGrams, 2),
    massKg: cleanZero(massKg, 4),
    centerOfMassMm: {
      x: cleanZero(cx, 2),
      y: cleanZero(cy, 2),
      z: cleanZero(cz, 2),
    },
    inertiaTensorGCm2: {
      ixx: cleanZero(rawTensor.ixx, 2),
      iyy: cleanZero(rawTensor.iyy, 2),
      izz: cleanZero(rawTensor.izz, 2),
      ixy: cleanZero(rawTensor.ixy, 2),
      ixz: cleanZero(rawTensor.ixz, 2),
      iyz: cleanZero(rawTensor.iyz, 2),
    },
    principalMomentsGCm2,
    radiusOfGyrationMm,
  };
}

/**
 * Rescales an existing PhysicalProperties object instantaneously to a new MaterialFinish
 * (since homogeneous geometry volume, CoM, and radii of gyration are density-invariant,
 * while mass and inertia tensor scale linearly with density).
 */
export function rescalePhysicalProperties(
  props: PhysicalProperties,
  nextFinish: MaterialFinish
): PhysicalProperties {
  const nextMat = MATERIAL_SPECS[nextFinish] || MATERIAL_SPECS.titanium;
  if (props.densityGCm3 <= 0) return { ...props, material: nextMat, densityGCm3: nextMat.densityGCm3 };
  const ratio = nextMat.densityGCm3 / props.densityGCm3;
  return {
    ...props,
    material: nextMat,
    densityGCm3: nextMat.densityGCm3,
    massGrams: cleanZero(props.massGrams * ratio, 2),
    massKg: cleanZero(props.massKg * ratio, 4),
    inertiaTensorGCm2: {
      ixx: cleanZero(props.inertiaTensorGCm2.ixx * ratio, 2),
      iyy: cleanZero(props.inertiaTensorGCm2.iyy * ratio, 2),
      izz: cleanZero(props.inertiaTensorGCm2.izz * ratio, 2),
      ixy: cleanZero(props.inertiaTensorGCm2.ixy * ratio, 2),
      ixz: cleanZero(props.inertiaTensorGCm2.ixz * ratio, 2),
      iyz: cleanZero(props.inertiaTensorGCm2.iyz * ratio, 2),
    },
    principalMomentsGCm2: [
      cleanZero(props.principalMomentsGCm2[0] * ratio, 2),
      cleanZero(props.principalMomentsGCm2[1] * ratio, 2),
      cleanZero(props.principalMomentsGCm2[2] * ratio, 2),
    ],
  };
}

export function formatMassDisplay(massGrams: number): string {
  if (!Number.isFinite(massGrams) || massGrams <= 0) return '0,0 g';
  if (massGrams >= 1000) {
    return `${(massGrams / 1000).toFixed(2).replace('.', ',')} kg`;
  }
  return `${massGrams.toFixed(1).replace('.', ',')} g`;
}

export function formatTensorValue(valGCm2: number): string {
  if (!Number.isFinite(valGCm2) || Math.abs(valGCm2) < 0.005) return '0.00';
  if (Math.abs(valGCm2) >= 10000) {
    return valGCm2.toExponential(2);
  }
  return valGCm2.toFixed(2);
}
