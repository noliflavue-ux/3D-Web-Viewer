import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MaterialFinish, CADModelProject, BoundingDimensions } from '../types/cad';
import { parseScadCode, parseStepFileMetrics, calculateSeparationVector } from './cadParser';
import { computeMeshPhysicalProperties } from './physicalProperties';
import { evaluateOpenScadToGeometries } from './scadEngine';

/**
 * Creates a calibrated PBR material set with varied roughness/metalness across sub-parts
 * so adjacent components read clearly in 3D space.
 */
export function createPartMaterial(
  finish: MaterialFinish,
  partIndex: number,
  isSoftwareGl: boolean,
  wireframe: boolean
): THREE.MeshPhysicalMaterial {
  const roughnessJitter = ((partIndex % 3) - 1) * 0.12;

  switch (finish) {
    case 'titanium':
      return new THREE.MeshPhysicalMaterial({
        color: partIndex % 2 === 0 ? 0xc8d0da : 0x94a3b8,
        metalness: 0.88,
        roughness: Math.max(0.15, Math.min(0.65, 0.28 + roughnessJitter)),
        clearcoat: 0.35,
        clearcoatRoughness: 0.2,
        wireframe,
      });
    case 'anodized_blue':
      return new THREE.MeshPhysicalMaterial({
        color: partIndex % 2 === 0 ? 0x0ea5e9 : 0x334155,
        metalness: 0.78,
        roughness: Math.max(0.18, Math.min(0.7, 0.32 + roughnessJitter)),
        clearcoat: 0.6,
        clearcoatRoughness: 0.15,
        wireframe,
      });
    case 'frosted_glass':
      return new THREE.MeshPhysicalMaterial({
        color: partIndex % 2 === 0 ? 0xe0f2fe : 0xbae6fd,
        metalness: 0.08,
        roughness: 0.18,
        transmission: isSoftwareGl ? 0 : 0.9,
        transparent: true,
        opacity: isSoftwareGl ? 0.55 : 1.0,
        ior: 1.52,
        thickness: 1.8,
        clearcoat: 1.0,
        wireframe,
      });
    case 'brushed_gold':
      return new THREE.MeshPhysicalMaterial({
        color: partIndex % 2 === 0 ? 0xfbbf24 : 0x64748b,
        metalness: 0.92,
        roughness: Math.max(0.14, Math.min(0.6, 0.25 + roughnessJitter)),
        clearcoat: 0.4,
        wireframe,
      });
    case 'matte_polymer':
    default:
      return new THREE.MeshPhysicalMaterial({
        color: partIndex % 2 === 0 ? 0xe2e8f0 : 0x475569,
        metalness: 0.12,
        roughness: Math.max(0.45, Math.min(0.9, 0.68 + roughnessJitter)),
        clearcoat: 0.15,
        wireframe,
      });
  }
}

/**
 * Builds a multi-part (3-12 distinct parts) procedural CAD assembly Group
 * and calculates exact bounding dimensions, volume, surface area, and raw vertex positions for export.
 */
export function buildCADAssemblyGroup(
  project: CADModelProject,
  isSoftwareGl: boolean,
  wireframe: boolean
): {
  group: THREE.Group;
  dimensions: BoundingDimensions;
  exportPositions: Float32Array;
} {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'CAD_Root_Assembly';
  let scadWarnings: string[] = [];

  // 1. If project has raw uploaded STL binary/ASCII base64 data, parse with STLLoader
  if (project.format === 'stl' && project.stlBufferBase64) {
    try {
      const binaryString = atob(project.stlBufferBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const loader = new STLLoader();
      const geom = loader.parse(bytes.buffer);
      geom.computeVertexNormals();
      geom.computeBoundingBox();

      // Center horizontally and ground on Y = 0
      const box = geom.boundingBox || new THREE.Box3();
      const center = new THREE.Vector3();
      box.getCenter(center);
      geom.translate(-center.x, -box.min.y, -center.z);

      const mat = createPartMaterial(project.finish, 0, isSoftwareGl, wireframe);
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = !isSoftwareGl;
      mesh.receiveShadow = !isSoftwareGl;
      mesh.userData = { partGroup: 0, partName: project.name };
      rootGroup.add(mesh);
    } catch {
      // Fall through to parametric builder if base64 decoding fails
    }
  }

  // 2. If STEP file with custom source text and not using standard gear preset
  if (
    rootGroup.children.length === 0 &&
    project.format === 'step' &&
    project.stepSourceText &&
    !project.scadCode.includes('planetary_helical_gear')
  ) {
    const stepMetrics = parseStepFileMetrics(project.stepSourceText);
    const r = stepMetrics.detectedRadius;
    const h = stepMetrics.detectedHeight;

    // Build a 6-part B-Rep style machined housing assembly
    const baseCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.08, h * 0.35, 36),
      createPartMaterial(project.finish, 0, isSoftwareGl, wireframe)
    );
    baseCyl.position.y = (h * 0.35) / 2;
    baseCyl.userData = { partGroup: 0, basePos: baseCyl.position.clone(), explodeVec: new THREE.Vector3(0, -12, 0) };
    rootGroup.add(baseCyl);

    const upperBody = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.72, r * 0.85, h * 0.65, 36),
      createPartMaterial(project.finish, 1, isSoftwareGl, wireframe)
    );
    upperBody.position.y = h * 0.35 + (h * 0.65) / 2;
    upperBody.userData = { partGroup: 1, basePos: upperBody.position.clone(), explodeVec: new THREE.Vector3(0, 14, 0) };
    rootGroup.add(upperBody);

    const collarRing = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.78, 2.4, 16, 36),
      createPartMaterial(project.finish, 2, isSoftwareGl, wireframe)
    );
    collarRing.rotation.x = Math.PI / 2;
    collarRing.position.y = h * 0.68;
    collarRing.userData = { partGroup: 2, basePos: collarRing.position.clone(), explodeVec: new THREE.Vector3(0, 26, 0) };
    rootGroup.add(collarRing);
  }

  // 3. OpenSCAD Evaluation:
  //    - The 3 built-in studio showcase modules (aero_turbine_impeller, precision_servo_bracket,
  //      planetary_helical_gear) use their high-detail multi-part procedural studio meshes.
  //    - ALL user-uploaded, pasted, or custom OpenSCAD code runs through the real OpenSCAD
  //      AST + 2D/3D CSG geometry engine (evaluateOpenScadToGeometries).
  const isBuiltinStudioPreset =
    /\bmodule\s+(aero_turbine_impeller|precision_servo_bracket|planetary_helical_gear)\b/i.test(
      project.scadCode || ''
    );

  if (rootGroup.children.length === 0 && !isBuiltinStudioPreset && project.scadCode?.trim()) {
    const evalResult = evaluateOpenScadToGeometries(project.scadCode, project.parameters);
    scadWarnings = evalResult.warnings;

    if (evalResult.parts.length > 0) {
      // Convert every part from OpenSCAD right-handed Z-up (+X right, +Y back, +Z up)
      // to Three.js right-handed Y-up (+X right, +Y up, +Z front) via rotateX(-PI/2).
      const combinedBox = new THREE.Box3();
      const convertedParts = evalResult.parts.map((part) => {
        const geom = part.geometry.clone();
        geom.rotateX(-Math.PI / 2);
        geom.computeBoundingBox();
        if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
          combinedBox.union(geom.boundingBox);
        }
        return { ...part, geometry: geom };
      });

      const globalCenter = new THREE.Vector3();
      if (!combinedBox.isEmpty()) {
        combinedBox.getCenter(globalCenter);
      }
      const offsetX = -globalCenter.x;
      const offsetY = !combinedBox.isEmpty() ? -combinedBox.min.y : 0;
      const offsetZ = -globalCenter.z;

      convertedParts.forEach((part, idx) => {
        part.geometry.translate(offsetX, offsetY, offsetZ);
        part.geometry.computeVertexNormals();
        part.geometry.computeBoundingBox();
        part.geometry.computeBoundingSphere();

        const baseMat = createPartMaterial(project.finish, idx, isSoftwareGl, wireframe);
        if (part.colorHex !== undefined) {
          baseMat.color.setHex(part.colorHex);
        }
        if (part.opacity !== undefined && part.opacity < 0.99) {
          baseMat.transparent = true;
          baseMat.opacity = Math.max(0.12, part.opacity);
          baseMat.depthWrite = part.opacity > 0.6;
        }

        const mesh = new THREE.Mesh(part.geometry, baseMat);
        mesh.castShadow = !isSoftwareGl;
        mesh.receiveShadow = !isSoftwareGl;
        mesh.userData = {
          partGroup: idx,
          partName: part.partName || `Komponente #${idx + 1}`,
          basePos: new THREE.Vector3(0, 0, 0),
        };
        rootGroup.add(mesh);
      });
    } else if (scadWarnings.length === 0) {
      scadWarnings.push(
        'Keine 3D-Geometrie im OpenSCAD-Quelltext gefunden (z. B. nur Modul-Definition ohne Aufruf).'
      );
    }
  }

  // 4. Built-in Studio Parametric Showcase Assemblies (only for the 3 explicit studio modules)
  if (rootGroup.children.length === 0 && isBuiltinStudioPreset) {
    const parsed = parseScadCode(project.scadCode, project.parameters);

    for (const prim of parsed.primitives) {
      if (prim.type === 'turbine_impeller') {
        const [outerR, hubH, bladeCount] = prim.size;
        const boreRadius = Math.max(3, (prim.position[2] || 16) / 2);

        // Part 1: Lower Machined Backplate Disc (Primary Silhouette)
        const discHeight = Math.max(4, hubH * 0.22);
        const backplate = new THREE.Mesh(
          new THREE.CylinderGeometry(outerR * 0.96, outerR, discHeight, 48),
          createPartMaterial(project.finish, 0, isSoftwareGl, wireframe)
        );
        backplate.position.y = discHeight / 2;
        backplate.userData = {
          partGroup: 0,
          basePos: backplate.position.clone(),
          explodeVec: new THREE.Vector3(0, -16, 0),
        };
        rootGroup.add(backplate);

        // Part 2: Conical Aerodynamic Nose Hub (Secondary Read)
        const coneHeight = hubH * 0.78;
        const hubCone = new THREE.Mesh(
          new THREE.CylinderGeometry(boreRadius * 1.35, outerR * 0.55, coneHeight, 36),
          createPartMaterial(project.finish, 1, isSoftwareGl, wireframe)
        );
        hubCone.position.y = discHeight + coneHeight / 2;
        hubCone.userData = {
          partGroup: 1,
          basePos: hubCone.position.clone(),
          explodeVec: new THREE.Vector3(0, 8, 0),
        };
        rootGroup.add(hubCone);

        // Part 3: Precision Curved Compressor Blades Group
        const bladesGroup = new THREE.Group();
        const bladeMat = createPartMaterial(project.finish, 2, isSoftwareGl, wireframe);
        const bladeLength = Math.max(10, outerR - boreRadius * 1.15);
        const bladeGeom = new THREE.BoxGeometry(bladeLength, hubH * 0.74, 2.2);

        for (let i = 0; i < bladeCount; i++) {
          const angle = (i / bladeCount) * Math.PI * 2;
          const blade = new THREE.Mesh(bladeGeom, bladeMat);
          const midR = boreRadius * 1.1 + bladeLength * 0.48;
          blade.position.set(
            Math.cos(angle) * midR,
            discHeight + (hubH * 0.74) / 2,
            Math.sin(angle) * midR
          );
          blade.rotation.y = -angle + 0.38; // Swept aero angle
          blade.rotation.x = 0.18;
          bladesGroup.add(blade);
        }
        bladesGroup.userData = {
          partGroup: 2,
          basePos: new THREE.Vector3(0, 0, 0),
          explodeVec: new THREE.Vector3(0, 24, 0),
        };
        rootGroup.add(bladesGroup);

        // Part 4: Upper Retaining Lock Ring & Inner Bore Sleeve (Accent Detail)
        const lockRing = new THREE.Mesh(
          new THREE.TorusGeometry(boreRadius * 1.32, 1.8, 16, 36),
          createPartMaterial(project.finish, 3, isSoftwareGl, wireframe)
        );
        lockRing.rotation.x = Math.PI / 2;
        lockRing.position.y = hubH + 1.2;
        lockRing.userData = {
          partGroup: 3,
          basePos: lockRing.position.clone(),
          explodeVec: new THREE.Vector3(0, 38, 0),
        };
        rootGroup.add(lockRing);

        const innerSleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(boreRadius, boreRadius, hubH + 3, 32, 1, false),
          createPartMaterial('matte_polymer', 4, isSoftwareGl, wireframe)
        );
        innerSleeve.position.y = (hubH + 3) / 2;
        innerSleeve.userData = {
          partGroup: 4,
          basePos: innerSleeve.position.clone(),
          explodeVec: new THREE.Vector3(0, -28, 0),
        };
        rootGroup.add(innerSleeve);
      } else if (prim.type === 'bracket_assembly') {
        const [width, height, thickness] = prim.size;
        const boreDia = prim.position[0] || 14;

        // Part 1: Base Mounting Plate
        const basePlate = new THREE.Mesh(
          new THREE.BoxGeometry(width, thickness, height * 0.85),
          createPartMaterial(project.finish, 0, isSoftwareGl, wireframe)
        );
        basePlate.position.set(0, thickness / 2, 0);
        basePlate.userData = {
          partGroup: 0,
          basePos: basePlate.position.clone(),
          explodeVec: new THREE.Vector3(0, -15, 0),
        };
        rootGroup.add(basePlate);

        // Part 2: Vertical Servo Bulkhead Wall
        const wallH = height;
        const verticalWall = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.88, wallH, thickness),
          createPartMaterial(project.finish, 1, isSoftwareGl, wireframe)
        );
        verticalWall.position.set(0, thickness + wallH / 2, -height * 0.3);
        verticalWall.userData = {
          partGroup: 1,
          basePos: verticalWall.position.clone(),
          explodeVec: new THREE.Vector3(0, 12, -14),
        };
        rootGroup.add(verticalWall);

        // Part 3 & 4: Twin Triangular Stiffener Ribs
        const ribShape = new THREE.Shape();
        ribShape.moveTo(0, 0);
        ribShape.lineTo(height * 0.55, 0);
        ribShape.lineTo(0, wallH * 0.78);
        ribShape.closePath();
        const ribGeom = new THREE.ExtrudeGeometry(ribShape, {
          depth: thickness * 0.75,
          bevelEnabled: true,
          bevelThickness: 0.8,
          bevelSize: 0.6,
          bevelSegments: 2,
        });
        const ribMat = createPartMaterial(project.finish, 2, isSoftwareGl, wireframe);

        [-1, 1].forEach((side, idx) => {
          const rib = new THREE.Mesh(ribGeom, ribMat);
          rib.rotation.y = Math.PI / 2;
          rib.position.set(side * (width * 0.36), thickness, -height * 0.25);
          rib.userData = {
            partGroup: 2 + idx,
            basePos: rib.position.clone(),
            explodeVec: new THREE.Vector3(side * 22, 8, 0),
          };
          rootGroup.add(rib);
        });

        // Part 5: Central Bearing Housing Boss Collar
        const bossCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(boreDia * 0.85, boreDia * 0.95, thickness * 1.8, 32),
          createPartMaterial('titanium', 4, isSoftwareGl, wireframe)
        );
        bossCollar.rotation.x = Math.PI / 2;
        bossCollar.position.set(0, thickness + wallH * 0.52, -height * 0.3 + thickness * 0.3);
        bossCollar.userData = {
          partGroup: 4,
          basePos: bossCollar.position.clone(),
          explodeVec: new THREE.Vector3(0, 16, 26),
        };
        rootGroup.add(bossCollar);

        // Part 6: 4 Corner Hex Socket Cap Bolts
        const boltGroup = new THREE.Group();
        const boltMat = createPartMaterial('titanium', 5, isSoftwareGl, wireframe);
        const boltGeom = new THREE.CylinderGeometry(3.2, 3.2, thickness * 1.45, 16);
        const xOff = width * 0.38;
        const zOff = height * 0.28;
        [
          [-xOff, zOff],
          [xOff, zOff],
          [-xOff, -zOff * 0.2],
          [xOff, -zOff * 0.2],
        ].forEach(([bx, bz]) => {
          const bolt = new THREE.Mesh(boltGeom, boltMat);
          bolt.position.set(bx, thickness * 0.85, bz);
          boltGroup.add(bolt);
        });
        boltGroup.userData = {
          partGroup: 5,
          basePos: new THREE.Vector3(0, 0, 0),
          explodeVec: new THREE.Vector3(0, 30, 0),
        };
        rootGroup.add(boltGroup);
      } else if (prim.type === 'gear') {
        const [pitchR, gearH, teethCount] = prim.size;

        // Part 1: Main Gear Web Body
        const gearWeb = new THREE.Mesh(
          new THREE.CylinderGeometry(pitchR * 0.88, pitchR * 0.88, gearH, 48),
          createPartMaterial(project.finish, 0, isSoftwareGl, wireframe)
        );
        gearWeb.position.y = gearH / 2;
        gearWeb.userData = {
          partGroup: 0,
          basePos: gearWeb.position.clone(),
          explodeVec: new THREE.Vector3(0, -14, 0),
        };
        rootGroup.add(gearWeb);

        // Part 2: Precision Gear Teeth Ring
        const teethGroup = new THREE.Group();
        const toothMat = createPartMaterial(project.finish, 1, isSoftwareGl, wireframe);
        const toothWidth = Math.max(2.2, (2 * Math.PI * pitchR) / (teethCount * 2.1));
        const toothGeom = new THREE.BoxGeometry(toothWidth, gearH * 0.96, pitchR * 0.24);

        for (let i = 0; i < teethCount; i++) {
          const angle = (i / teethCount) * Math.PI * 2;
          const tooth = new THREE.Mesh(toothGeom, toothMat);
          tooth.position.set(
            Math.cos(angle) * (pitchR * 0.92),
            gearH / 2,
            Math.sin(angle) * (pitchR * 0.92)
          );
          tooth.rotation.y = -angle + Math.PI / 2;
          teethGroup.add(tooth);
        }
        teethGroup.userData = {
          partGroup: 1,
          basePos: new THREE.Vector3(0, 0, 0),
          explodeVec: new THREE.Vector3(0, 18, 0),
        };
        rootGroup.add(teethGroup);

        // Part 3: Raised Splined Center Hub Collar
        const hubCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(pitchR * 0.42, pitchR * 0.46, gearH * 1.45, 32),
          createPartMaterial('titanium', 2, isSoftwareGl, wireframe)
        );
        hubCollar.position.y = (gearH * 1.45) / 2;
        hubCollar.userData = {
          partGroup: 2,
          basePos: hubCollar.position.clone(),
          explodeVec: new THREE.Vector3(0, 32, 0),
        };
        rootGroup.add(hubCollar);
      } else {
        // Custom OpenSCAD primitives (cube, cylinder, sphere)
        let geom: THREE.BufferGeometry;
        if (prim.type === 'cube') {
          geom = new THREE.BoxGeometry(prim.size[0], prim.size[2], prim.size[1]);
        } else if (prim.type === 'cylinder') {
          geom = new THREE.CylinderGeometry(prim.size[0], prim.size[0], prim.size[1], 36);
        } else {
          geom = new THREE.SphereGeometry(prim.size[0], 32, 24);
        }

        const isSub = prim.operation === 'subtract';
        const mat = isSub
          ? new THREE.MeshPhysicalMaterial({
              color: 0x38bdf8,
              metalness: 0.2,
              roughness: 0.3,
              transparent: true,
              opacity: 0.45,
              wireframe: true,
            })
          : createPartMaterial(project.finish, prim.partGroup, isSoftwareGl, wireframe);

        const mesh = new THREE.Mesh(geom, mat);
        // Ground on Y if position is at origin
        const baseY =
          prim.type === 'cube'
            ? prim.size[2] / 2
            : prim.type === 'cylinder'
            ? prim.size[1] / 2
            : prim.size[0];
        mesh.position.set(prim.position[0], prim.position[2] + baseY, prim.position[1]);
        mesh.rotation.set(
          THREE.MathUtils.degToRad(prim.rotation[0]),
          THREE.MathUtils.degToRad(prim.rotation[2]),
          THREE.MathUtils.degToRad(prim.rotation[1])
        );
        const dirAngle = (prim.partGroup * 1.7) % (Math.PI * 2);
        mesh.userData = {
          partGroup: prim.partGroup,
          isSubtractPreview: isSub,
          basePos: mesh.position.clone(),
          explodeVec: new THREE.Vector3(
            Math.cos(dirAngle) * 14,
            prim.partGroup * 8,
            Math.sin(dirAngle) * 14
          ),
        };
        rootGroup.add(mesh);
      }
    }
  }

  // Enable shadows and compute overall metrics
  const box = new THREE.Box3();
  let triangleCount = 0;
  const vertexChunks: number[] = [];
  const solidVertexChunks: number[] = [];
  const tempVec = new THREE.Vector3();

  rootGroup.updateMatrixWorld(true);
  rootGroup.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = !isSoftwareGl;
      mesh.receiveShadow = !isSoftwareGl;
      const isSubtractPreview = Boolean(mesh.userData?.isSubtractPreview);
      const geom = mesh.geometry;
      const posAttr = geom.attributes.position;
      if (posAttr) {
        const indexAttr = geom.index;
        if (indexAttr) {
          triangleCount += indexAttr.count / 3;
          for (let i = 0; i < indexAttr.count; i++) {
            tempVec.fromBufferAttribute(posAttr, indexAttr.getX(i));
            tempVec.applyMatrix4(mesh.matrixWorld);
            vertexChunks.push(tempVec.x, tempVec.y, tempVec.z);
            if (!isSubtractPreview) {
              solidVertexChunks.push(tempVec.x, tempVec.y, tempVec.z);
            }
          }
        } else {
          triangleCount += posAttr.count / 3;
          for (let i = 0; i < posAttr.count; i++) {
            tempVec.fromBufferAttribute(posAttr, i);
            tempVec.applyMatrix4(mesh.matrixWorld);
            vertexChunks.push(tempVec.x, tempVec.y, tempVec.z);
            if (!isSubtractPreview) {
              solidVertexChunks.push(tempVec.x, tempVec.y, tempVec.z);
            }
          }
        }
      }
    }
  });

  box.setFromObject(rootGroup);
  const size = new THREE.Vector3();
  box.getSize(size);
  const assemblyCenter = new THREE.Vector3();
  box.getCenter(assemblyCenter);

  // Ensure every nested component has a calculated separation vector, base position, and bounding center
  const partBox = new THREE.Box3();
  const partCenter = new THREE.Vector3();
  const totalParts = rootGroup.children.length;
  rootGroup.children.forEach((child, idx) => {
    partBox.setFromObject(child);
    partBox.getCenter(partCenter);
    const basePos = (child.userData.basePos as THREE.Vector3 | undefined) || child.position.clone();
    const calcVec = calculateSeparationVector(
      { x: partCenter.x, y: partCenter.y, z: partCenter.z },
      { x: assemblyCenter.x, y: assemblyCenter.y, z: assemblyCenter.z },
      idx,
      totalParts,
      36
    );
    const existingVec = child.userData.explodeVec as THREE.Vector3 | undefined;
    const finalVec =
      existingVec && existingVec.lengthSq() > 1
        ? existingVec
        : new THREE.Vector3(calcVec.x, calcVec.y, calcVec.z);

    child.userData = {
      ...child.userData,
      partGroup: idx,
      partName: child.userData.partName || `Komponente #${idx + 1}`,
      basePos: basePos.clone(),
      partCenter: partCenter.clone(),
      explodeVec: finalVec,
    };
  });

  const hasGeometry = !box.isEmpty() && triangleCount > 0;
  const width = hasGeometry ? Number(Math.max(0.1, size.x).toFixed(1)) : 0;
  const height = hasGeometry ? Number(Math.max(0.1, size.y).toFixed(1)) : 0;
  const depth = hasGeometry ? Number(Math.max(0.1, size.z).toFixed(1)) : 0;

  // Compute exact mesh-integrated physical properties (volume, surface area, mass, CoM, inertia tensor)
  const solidPositions = new Float32Array(solidVertexChunks.length > 0 ? solidVertexChunks : vertexChunks);
  const physical = computeMeshPhysicalProperties(solidPositions, project.finish);

  return {
    group: rootGroup,
    dimensions: {
      width,
      height,
      depth,
      volumeCm3: physical.volumeCm3,
      surfaceAreaCm2: physical.surfaceAreaCm2,
      triangleCount: Math.round(triangleCount),
      physical,
      scadWarnings: scadWarnings.length > 0 ? scadWarnings : undefined,
    },
    exportPositions: new Float32Array(vertexChunks),
  };
}
