import {
  BoundingDimensions,
  CADFolder,
  CADFormat,
  CADModelProject,
  MaterialFinish,
  ModelSortOption,
  ShareDurationPreset,
  Vector3Tuple,
} from '../types/cad';

const DURATION_TO_MS: Record<ShareDurationPreset, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * Calculates the mandatory expiration timestamp (ms) from a selected duration preset.
 */
export function computeShareExpiryTimestamp(
  durationPreset: ShareDurationPreset,
  nowMs: number = Date.now()
): number {
  const delta = DURATION_TO_MS[durationPreset] ?? DURATION_TO_MS['24h'];
  return nowMs + delta;
}

/**
 * Evaluates whether a time-limited share link is still valid and returns a human-readable German countdown.
 */
export function evaluateShareLinkValidity(
  expiresAtMs: number | undefined,
  nowMs: number = Date.now()
): {
  isValid: boolean;
  remainingMs: number;
  remainingLabel: string;
} {
  if (!expiresAtMs || Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) {
    return {
      isValid: false,
      remainingMs: 0,
      remainingLabel: 'Abgelaufen',
    };
  }
  const remainingMs = expiresAtMs - nowMs;
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;

  let remainingLabel = '';
  if (days > 0) {
    remainingLabel = `${days}d ${hours}h gültig`;
  } else if (hours > 0) {
    remainingLabel = `${hours}h ${mins}m gültig`;
  } else {
    remainingLabel = `${mins} Min. gültig`;
  }

  return {
    isValid: true,
    remainingMs,
    remainingLabel,
  };
}

export interface ParsedScadPrimitive {
  type: 'cube' | 'cylinder' | 'sphere' | 'torus' | 'gear' | 'bracket_assembly' | 'turbine_impeller';
  operation: 'add' | 'subtract';
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  partGroup: number; // Used for smooth exploded view separation
  roughnessOffset: number;
}

export interface ParsedScadScene {
  primitives: ParsedScadPrimitive[];
  extractedParameters: Record<string, number>;
}

/**
 * Pure Euclidean distance & axis delta calculation in millimeters.
 */
export function calculatePointToPointMetrics(a: Vector3Tuple, b: Vector3Tuple) {
  const deltaX = Number((b.x - a.x).toFixed(2));
  const deltaY = Number((b.y - a.y).toFixed(2));
  const deltaZ = Number((b.z - a.z).toFixed(2));
  const distanceMm = Number(
    Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ).toFixed(2)
  );
  return {
    distanceMm,
    deltaX: Math.abs(deltaX),
    deltaY: Math.abs(deltaY),
    deltaZ: Math.abs(deltaZ),
  };
}

/**
 * Calculates a deterministic 3D separation vector for exploded-view animation
 * from a sub-component's bounding center relative to the assembly centroid and part index.
 */
export function calculateSeparationVector(
  partCenter: Vector3Tuple,
  assemblyCenter: Vector3Tuple,
  partIndex: number,
  totalParts: number,
  maxDisplacementMm = 36
): Vector3Tuple {
  const dx = partCenter.x - assemblyCenter.x;
  const dy = partCenter.y - assemblyCenter.y;
  const dz = partCenter.z - assemblyCenter.z;
  const radialLen = Math.hypot(dx, dz);
  const fullLen = Math.hypot(dx, dy, dz);

  // If the part has a distinct radial or axial offset from the assembly centroid, amplify it
  if (fullLen > 1.5) {
    const scale = maxDisplacementMm / fullLen;
    const tierBoost = 1 + (partIndex / Math.max(1, totalParts - 1)) * 0.45;
    return {
      x: Number((dx * scale * 0.85).toFixed(2)),
      y: Number((dy * scale * tierBoost).toFixed(2)),
      z: Number((dz * scale * 0.85).toFixed(2)),
    };
  }

  // Coaxial / nested parts sharing the same centroid separate cleanly along axial tiers
  if (radialLen < 1.5 && totalParts > 1) {
    const normalizedRank = partIndex / (totalParts - 1) - 0.5; // [-0.5, +0.5]
    return {
      x: 0,
      y: Number((normalizedRank * maxDisplacementMm * 1.6).toFixed(2)),
      z: 0,
    };
  }

  return { x: 0, y: maxDisplacementMm * 0.5, z: 0 };
}

/**
 * Extracts top-level numeric variables from OpenSCAD code: e.g. `wall_thickness = 4.5;`
 */
export function extractScadParameters(scadCode: string): Record<string, number> {
  const params: Record<string, number> = {};
  const lines = scadCode.split('\n');
  const assignRegex = /^\s*(\$?[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/;
  for (const line of lines) {
    const cleaned = line.replace(/\/\/.*$/, '').trim();
    const match = cleaned.match(assignRegex);
    if (match) {
      const key = match[1];
      const val = parseFloat(match[2]);
      if (!Number.isNaN(val)) {
        params[key] = val;
      }
    }
  }
  return params;
}

/**
 * Updates a numeric parameter inside OpenSCAD source code while preserving comments and structure.
 */
export function updateScadParameterInCode(scadCode: string, key: string, newValue: number): string {
  const escapedKey = key.replace(/\$/g, '\\$');
  const regex = new RegExp(`(^\\s*${escapedKey}\\s*=\\s*)(-?\\d+(?:\\.\\d+)?)(\\s*;.*$)`, 'm');
  if (regex.test(scadCode)) {
    return scadCode.replace(regex, `$1${newValue}$3`);
  }
  return `${key} = ${newValue};\n` + scadCode;
}

/**
 * Parses OpenSCAD source code and parameter overrides into a multi-part 3D CSG descriptor list.
 */
export function parseScadCode(
  scadCode: string,
  paramOverrides: Record<string, number> = {}
): ParsedScadScene {
  const extractedParameters = {
    ...extractScadParameters(scadCode),
    ...paramOverrides,
  };

  const resolveExpr = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const trimmed = raw.trim();
    if (trimmed in extractedParameters) {
      return extractedParameters[trimmed];
    }
    const num = parseFloat(trimmed);
    return Number.isNaN(num) ? fallback : num;
  };

  const primitives: ParsedScadPrimitive[] = [];

  // Only match the 3 exact built-in demo studio templates via explicit module declaration
  // (Never hijack user files based on generic variable names like flange_width, blade_count, teeth_count!)
  if (/\bmodule\s+aero_turbine_impeller\b/i.test(scadCode)) {
    const outerRadius = extractedParameters.outer_radius ?? 42;
    const hubHeight = extractedParameters.hub_height ?? 28;
    const bladeCount = Math.max(3, Math.min(24, Math.round(extractedParameters.blade_count ?? 9)));
    const boreDia = extractedParameters.bore_diameter ?? 16;

    primitives.push({
      type: 'turbine_impeller',
      operation: 'add',
      size: [outerRadius, hubHeight, bladeCount],
      position: [0, 0, boreDia],
      rotation: [0, 0, 0],
      partGroup: 0,
      roughnessOffset: 0,
    });
  } else if (/\bmodule\s+precision_servo_bracket\b/i.test(scadCode)) {
    const width = extractedParameters.flange_width ?? 68;
    const height = extractedParameters.bracket_height ?? 44;
    const thickness = extractedParameters.wall_thickness ?? 8;
    const mountHole = extractedParameters.mount_bore ?? 14;

    primitives.push({
      type: 'bracket_assembly',
      operation: 'add',
      size: [width, height, thickness],
      position: [mountHole, 0, 0],
      rotation: [0, 0, 0],
      partGroup: 0,
      roughnessOffset: 0,
    });
  } else if (/\bmodule\s+planetary_helical_gear\b/i.test(scadCode)) {
    const pitchRadius = extractedParameters.pitch_radius ?? 38;
    const gearThickness = extractedParameters.gear_thickness ?? 18;
    const teethCount = Math.max(6, Math.min(48, Math.round(extractedParameters.teeth_count ?? 18)));

    primitives.push({
      type: 'gear',
      operation: 'add',
      size: [pitchRadius, gearThickness, teethCount],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      partGroup: 0,
      roughnessOffset: 0,
    });
  }

  // Also parse explicit OpenSCAD statements line by line when writing custom user code
  if (primitives.length === 0) {
    const lines = scadCode.split('\n');
    let currentTranslation: [number, number, number] = [0, 0, 0];
    let currentRotation: [number, number, number] = [0, 0, 0];
    let inDifferenceBlock = false;
    let differenceChildIndex = 0;
    let partCounter = 1;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;

    if (/\bdifference\s*\(\s*\)/.test(line)) {
      inDifferenceBlock = true;
      differenceChildIndex = 0;
    }

    const transMatch = line.match(/translate\s*\(\s*\[\s*([^,]+),\s*([^,]+),\s*([^\]]+)\]\s*\)/);
    if (transMatch) {
      currentTranslation = [
        resolveExpr(transMatch[1], 0),
        resolveExpr(transMatch[2], 0),
        resolveExpr(transMatch[3], 0),
      ];
    }

    const rotMatch = line.match(/rotate\s*\(\s*\[\s*([^,]+),\s*([^,]+),\s*([^\]]+)\]\s*\)/);
    if (rotMatch) {
      currentRotation = [
        resolveExpr(rotMatch[1], 0),
        resolveExpr(rotMatch[2], 0),
        resolveExpr(rotMatch[3], 0),
      ];
    }

    const cubeVecMatch = line.match(/cube\s*\(\s*\[\s*([^,]+),\s*([^,]+),\s*([^\]]+)\]/);
    const cubeSingleMatch = !cubeVecMatch ? line.match(/cube\s*\(\s*([a-zA-Z0-9_.]+)/) : null;
    if (cubeVecMatch || cubeSingleMatch) {
      const sx = cubeVecMatch ? resolveExpr(cubeVecMatch[1], 20) : resolveExpr(cubeSingleMatch?.[1], 20);
      const sy = cubeVecMatch ? resolveExpr(cubeVecMatch[2], 20) : sx;
      const sz = cubeVecMatch ? resolveExpr(cubeVecMatch[3], 20) : sx;
      const isSub = inDifferenceBlock && differenceChildIndex > 0;
      primitives.push({
        type: 'cube',
        operation: isSub ? 'subtract' : 'add',
        size: [sx, sy, sz],
        position: [...currentTranslation],
        rotation: [...currentRotation],
        partGroup: partCounter++,
        roughnessOffset: (partCounter % 3) * 0.12,
      });
      if (inDifferenceBlock) differenceChildIndex++;
      currentTranslation = [0, 0, 0];
      currentRotation = [0, 0, 0];
    }

    const cylMatch = line.match(/cylinder\s*\(([^)]*)\)/);
    if (cylMatch) {
      const args = cylMatch[1];
      const hMatch = args.match(/h\s*=\s*([a-zA-Z0-9_.]+)/);
      const rMatch = args.match(/r\s*=\s*([a-zA-Z0-9_.]+)/);
      const dMatch = args.match(/d\s*=\s*([a-zA-Z0-9_.]+)/);
      const h = hMatch ? resolveExpr(hMatch[1], 24) : 24;
      const r = rMatch
        ? resolveExpr(rMatch[1], 10)
        : dMatch
        ? resolveExpr(dMatch[1], 20) / 2
        : 10;
      const isSub = inDifferenceBlock && differenceChildIndex > 0;
      primitives.push({
        type: 'cylinder',
        operation: isSub ? 'subtract' : 'add',
        size: [r, h, r],
        position: [...currentTranslation],
        rotation: [...currentRotation],
        partGroup: partCounter++,
        roughnessOffset: (partCounter % 3) * 0.15,
      });
      if (inDifferenceBlock) differenceChildIndex++;
      currentTranslation = [0, 0, 0];
      currentRotation = [0, 0, 0];
    }

    const sphereMatch = line.match(/sphere\s*\(\s*(?:r\s*=\s*)?([a-zA-Z0-9_.]+)/);
    if (sphereMatch) {
      const r = resolveExpr(sphereMatch[1], 14);
      const isSub = inDifferenceBlock && differenceChildIndex > 0;
      primitives.push({
        type: 'sphere',
        operation: isSub ? 'subtract' : 'add',
        size: [r, r, r],
        position: [...currentTranslation],
        rotation: [...currentRotation],
        partGroup: partCounter++,
        roughnessOffset: 0.1,
      });
      if (inDifferenceBlock) differenceChildIndex++;
      currentTranslation = [0, 0, 0];
      currentRotation = [0, 0, 0];
    }

      if (line.includes('}') && inDifferenceBlock) {
        inDifferenceBlock = false;
      }
    }
  }

  return {
    primitives,
    extractedParameters,
  };
}

/**
 * Generates an ASCII STL file string from triangle vertex positions (Float32Array).
 */
export function exportPositionsToAsciiSTL(positions: Float32Array, modelName = 'AetherCAD_Part'): string {
  const safeName = modelName.replace(/\s+/g, '_');
  const lines: string[] = [`solid ${safeName}`];
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];

    // Compute face normal
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    lines.push(`  facet normal ${nx.toFixed(4)} ${ny.toFixed(4)} ${nz.toFixed(4)}`);
    lines.push('    outer loop');
    lines.push(`      vertex ${ax.toFixed(4)} ${ay.toFixed(4)} ${az.toFixed(4)}`);
    lines.push(`      vertex ${bx.toFixed(4)} ${by.toFixed(4)} ${bz.toFixed(4)}`);
    lines.push(`      vertex ${cx.toFixed(4)} ${cy.toFixed(4)} ${cz.toFixed(4)}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${safeName}`);
  return lines.join('\n');
}

/**
 * Generates Wavefront OBJ format string from triangle vertex positions.
 */
export function exportPositionsToOBJ(positions: Float32Array, modelName = 'AetherCAD_Part'): string {
  const lines: string[] = [
    `# AetherCAD Studio Export`,
    `o ${modelName.replace(/\s+/g, '_')}`,
  ];
  const vertexCount = positions.length / 3;
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i].toFixed(4)} ${positions[i + 1].toFixed(4)} ${positions[i + 2].toFixed(4)}`);
  }
  for (let f = 1; f <= vertexCount; f += 3) {
    lines.push(`f ${f} ${f + 1} ${f + 2}`);
  }
  return lines.join('\n');
}

/**
 * Generates ISO-10303-21 STEP AP214 exchange file representation from bounding & vertex data.
 */
export function exportMetadataToSTEP(
  modelName: string,
  dims: BoundingDimensions,
  author = 'AetherCAD Engineer'
): string {
  const isoDate = new Date().toISOString().split('.')[0];
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('AetherCAD Studio B-Rep STEP Exchange','Bounding ${dims.width}x${dims.height}x${dims.depth}mm'),'2;1');`,
    `FILE_NAME('${modelName.replace(/\s+/g, '_')}.step','${isoDate}',('${author}'),('AetherCAD Precision Division'),'AetherCAD Kernel 2.4','AetherCAD Studio','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    `#10 = APPLICATION_CONTEXT('core data for automotive mechanical design processes');`,
    `#20 = PRODUCT_DEFINITION_CONTEXT('part definition',#10,'design');`,
    `#30 = PRODUCT('${modelName}','${modelName}','',(#40));`,
    `#40 = PRODUCT_CONTEXT('',#10,'mechanical');`,
    `#50 = CARTESIAN_POINT('Origin',(0.0,0.0,0.0));`,
    `#60 = CARTESIAN_POINT('BoundingMax',(${dims.width.toFixed(3)},${dims.height.toFixed(3)},${dims.depth.toFixed(3)}));`,
    `#70 = MANIFOLD_SOLID_BREP('${modelName}_Solid',#80);`,
    'ENDSEC;',
    'END-ISO-10303-21;',
  ].join('\n');
}

/**
 * Parses ISO-10303-21 STEP file CARTESIAN_POINT coordinates and Cylinder/Extrusion directives
 * so uploaded .step / .stp files render authentic 3D CAD geometry in the browser.
 */
export function parseStepFileMetrics(stepText: string): {
  cartesianPoints: Vector3Tuple[];
  detectedRadius: number;
  detectedHeight: number;
} {
  const cartesianPoints: Vector3Tuple[] = [];
  const ptRegex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = ptRegex.exec(stepText)) !== null) {
    cartesianPoints.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3]),
    });
    if (cartesianPoints.length > 500) break;
  }

  const circleMatch = stepText.match(/CIRCLE\s*\([^,]+,[^,]+,\s*(\d+(?:\.\d+)?)\s*\)/i);
  const detectedRadius = circleMatch ? Math.min(80, Math.max(8, parseFloat(circleMatch[1]))) : 32;

  let detectedHeight = 36;
  if (cartesianPoints.length >= 2) {
    let maxSpan = 0;
    for (const pt of cartesianPoints) {
      maxSpan = Math.max(maxSpan, Math.abs(pt.x), Math.abs(pt.y), Math.abs(pt.z));
    }
    if (maxSpan > 5 && maxSpan < 250) {
      detectedHeight = maxSpan;
    }
  }

  return {
    cartesianPoints,
    detectedRadius,
    detectedHeight,
  };
}

const FINISH_SEARCH_LABELS: Record<MaterialFinish, string> = {
  titanium: 'Titan Grade 5 Gebürstet Titanium',
  anodized_blue: 'Eloxal Blau Aluminium Anodized',
  frosted_glass: 'Acrylglas Optik Frosted Glass',
  matte_polymer: 'SLS Polymer Nylon Carbon Matte',
  brushed_gold: 'Messing CuZn Bronze Gold',
};

/**
 * Evaluates a tokenized search query against all project names and deep CAD metadata
 * (category, format, author, material finish, folder/Ablage name, OpenSCAD parameters,
 * 3D comments, version changelogs, and share duration), returning matched field labels.
 */
export function getProjectMetadataMatches(
  proj: CADModelProject,
  rawQuery: string,
  folders: CADFolder[] = []
): {
  matches: boolean;
  matchedFields: string[];
} {
  const trimmed = rawQuery.trim().toLowerCase();
  if (!trimmed) {
    return { matches: true, matchedFields: [] };
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const matchedSet = new Set<string>();

  const folderObj = folders.find(
    (f) => f.id === (proj.folderId || 'folder-prototypes')
  );
  const finishLabel = FINISH_SEARCH_LABELS[proj.finish] || proj.finish;
  const paramKeys = Object.keys(proj.parameters);
  const versionLabel = `v${proj.currentVersion} v${proj.currentVersion}.0 revision ${proj.currentVersion}`;

  for (const token of tokens) {
    let tokenMatched = false;

    if (proj.name.toLowerCase().includes(token)) {
      matchedSet.add('Name');
      tokenMatched = true;
    }
    if (proj.category.toLowerCase().includes(token)) {
      matchedSet.add('Kategorie');
      tokenMatched = true;
    }
    if (proj.format.toLowerCase().includes(token)) {
      matchedSet.add(`Format (${proj.format.toUpperCase()})`);
      tokenMatched = true;
    }
    if (proj.author.toLowerCase().includes(token)) {
      matchedSet.add(`Autor (${proj.author})`);
      tokenMatched = true;
    }
    if (
      proj.finish.toLowerCase().includes(token) ||
      finishLabel.toLowerCase().includes(token)
    ) {
      matchedSet.add(`Werkstoff (${finishLabel.split(' ').slice(0, 2).join(' ')})`);
      tokenMatched = true;
    }
    if (
      folderObj &&
      (folderObj.name.toLowerCase().includes(token) ||
        folderObj.description.toLowerCase().includes(token))
    ) {
      matchedSet.add(`Ablage (${folderObj.name})`);
      tokenMatched = true;
    }
    if (versionLabel.includes(token)) {
      matchedSet.add(`Revision (v${proj.currentVersion}.0)`);
      tokenMatched = true;
    }

    const matchedParam = paramKeys.find(
      (k) =>
        k.toLowerCase().includes(token) ||
        `${k}=${proj.parameters[k]}`.toLowerCase().includes(token)
    );
    if (matchedParam) {
      matchedSet.add(`Parameter (${matchedParam})`);
      tokenMatched = true;
    }

    const matchedComment = proj.comments.find(
      (c) =>
        c.text.toLowerCase().includes(token) ||
        c.authorName.toLowerCase().includes(token) ||
        c.authorRole.toLowerCase().includes(token)
    );
    if (matchedComment) {
      matchedSet.add('3D-Kommentar');
      tokenMatched = true;
    }

    const matchedVersion = proj.versions.find(
      (v) =>
        v.changelog.toLowerCase().includes(token) ||
        v.author.toLowerCase().includes(token)
    );
    if (matchedVersion) {
      matchedSet.add('Versions-Historie');
      tokenMatched = true;
    }

    if (
      proj.shareConfig?.durationPreset &&
      proj.shareConfig.durationPreset.toLowerCase().includes(token)
    ) {
      matchedSet.add(`Link-Limit (${proj.shareConfig.durationPreset})`);
      tokenMatched = true;
    }

    if (!tokenMatched) {
      return { matches: false, matchedFields: [] };
    }
  }

  return {
    matches: true,
    matchedFields: Array.from(matchedSet),
  };
}

/**
 * Pure helper to filter and sort CAD projects across Ablagen (folders), formats, deep metadata search queries, and sort modes.
 */
export function filterAndSortProjects(
  projects: CADModelProject[],
  options: {
    folderId: string | 'all';
    format: CADFormat | 'all';
    searchQuery: string;
    sortBy: ModelSortOption;
    folders?: CADFolder[];
    globalSearchAcrossFolders?: boolean;
  }
): CADModelProject[] {
  const hasSearch = options.searchQuery.trim().length > 0;
  const ignoreFolderFilter = Boolean(hasSearch && options.globalSearchAcrossFolders);

  const filtered = projects.filter((proj) => {
    const projFolder = proj.folderId || 'folder-prototypes';
    const matchesFolder =
      ignoreFolderFilter ||
      options.folderId === 'all' ||
      projFolder === options.folderId;
    const matchesFormat = options.format === 'all' || proj.format === options.format;
    const { matches: matchesSearch } = getProjectMetadataMatches(
      proj,
      options.searchQuery,
      options.folders || []
    );
    return matchesFolder && matchesFormat && matchesSearch;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (options.sortBy === 'name_asc') {
      return a.name.localeCompare(b.name, 'de');
    }
    if (options.sortBy === 'format') {
      return a.format.localeCompare(b.format) || a.name.localeCompare(b.name, 'de');
    }
    if (options.sortBy === 'comments_desc') {
      return b.comments.length - a.comments.length;
    }
    if (options.sortBy === 'version_desc') {
      return b.currentVersion - a.currentVersion;
    }
    // 'updated' preserves newest-first order
    return 0;
  });

  return sorted;
}

/**
 * Pure helper to move a CAD project into a target Ablage (folder), returning the updated project list
 * and whether a folder change actually occurred.
 */
export function moveProjectToFolder(
  projects: CADModelProject[],
  projectId: string,
  targetFolderId: string
): {
  updatedProjects: CADModelProject[];
  moved: boolean;
  previousFolderId?: string;
} {
  if (!projectId || !targetFolderId) {
    return { updatedProjects: projects, moved: false };
  }

  const targetProj = projects.find((p) => p.id === projectId);
  if (!targetProj) {
    return { updatedProjects: projects, moved: false };
  }

  const previousFolderId = targetProj.folderId || 'folder-prototypes';
  if (previousFolderId === targetFolderId) {
    return { updatedProjects: projects, moved: false, previousFolderId };
  }

  const updatedProjects = projects.map((p) =>
    p.id === projectId
      ? {
          ...p,
          folderId: targetFolderId,
          updatedAt: 'Gerade eben',
        }
      : p
  );

  return {
    updatedProjects,
    moved: true,
    previousFolderId,
  };
}

export interface ScadAnalysisResult {
  primitiveCount: number;
  parameterCount: number;
  hasDifference: boolean;
  hasUnion: boolean;
  moduleNames: string[];
  suggestedName: string;
  parameters: Record<string, number>;
  detectedPrimitivesSummary: string[];
}

/**
 * Fast static analyzer for OpenSCAD source code to preview primitives, variables, and structure.
 */
export function analyzeScadCodeStructure(scadCode: string): ScadAnalysisResult {
  const parameters = extractScadParameters(scadCode);
  const lines = scadCode.split('\n');
  const moduleNames: string[] = [];
  const detectedPrimitivesSummary: string[] = [];

  let cubeCount = 0;
  let cylinderCount = 0;
  let sphereCount = 0;
  let polyhedronCount = 0;
  let extrudeCount = 0;
  let shape2DCount = 0;
  let hullCount = 0;
  let hasDifference = false;
  let hasUnion = false;
  let explicitNameMatch = '';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Check for comment-based name hint: // Name: ... or // Titel: ... or // Title: ...
    if (!explicitNameMatch) {
      const nameComment = trimmed.match(/^\/\/\s*(?:Name|Title|Titel|Modell|Bauteil)\s*:\s*(.+)$/i);
      if (nameComment && nameComment[1].trim()) {
        explicitNameMatch = nameComment[1].trim();
      } else if (trimmed.startsWith('//') && trimmed.length > 4 && !trimmed.includes('{')) {
        const potential = trimmed.replace(/^\/\/\s*(?:Titel|Title|Name)?\s*:?\s*/i, '').trim();
        if (potential.length >= 3 && potential.length <= 40 && !explicitNameMatch) {
          explicitNameMatch = potential;
        }
      }
    }

    const modMatch = trimmed.match(/^module\s+([a-zA-Z0-9_]+)/);
    if (modMatch && !moduleNames.includes(modMatch[1])) {
      moduleNames.push(modMatch[1]);
    }

    const codeOnly = trimmed.replace(/\/\/.*$/, '');
    if (!codeOnly) continue;

    if (/\bdifference\s*\(/.test(codeOnly)) hasDifference = true;
    if (/\bunion\s*\(/.test(codeOnly)) hasUnion = true;
    cubeCount += (codeOnly.match(/\bcube\s*\(/g) || []).length;
    cylinderCount += (codeOnly.match(/\bcylinder\s*\(/g) || []).length;
    sphereCount += (codeOnly.match(/\bsphere\s*\(/g) || []).length;
    polyhedronCount += (codeOnly.match(/\bpolyhedron\s*\(/g) || []).length;
    extrudeCount += (codeOnly.match(/\b(?:linear_extrude|rotate_extrude)\s*\(/g) || []).length;
    shape2DCount += (codeOnly.match(/\b(?:square|circle|polygon)\s*\(/g) || []).length;
    hullCount += (codeOnly.match(/\b(?:hull|minkowski)\s*\(/g) || []).length;
  }

  // Only recognize explicit built-in demo studio module declarations
  if (/\bmodule\s+aero_turbine_impeller\b/i.test(scadCode)) {
    detectedPrimitivesSummary.push('Aero-Impeller Schaufelkranz (Parametrisch)');
  } else if (/\bmodule\s+planetary_helical_gear\b/i.test(scadCode)) {
    detectedPrimitivesSummary.push('Stirnzahnrad mit Evolventenflanke');
  } else if (/\bmodule\s+precision_servo_bracket\b/i.test(scadCode)) {
    detectedPrimitivesSummary.push('CNC Halterung & Flansch');
  }

  if (cubeCount > 0) detectedPrimitivesSummary.push(`${cubeCount}x Quader (cube)`);
  if (cylinderCount > 0) detectedPrimitivesSummary.push(`${cylinderCount}x Zylinder / Bohrung (cylinder)`);
  if (sphereCount > 0) detectedPrimitivesSummary.push(`${sphereCount}x Kugel (sphere)`);
  if (polyhedronCount > 0) detectedPrimitivesSummary.push(`${polyhedronCount}x Polyeder (polyhedron)`);
  if (extrudeCount > 0) detectedPrimitivesSummary.push(`${extrudeCount}x Extrusion (2D→3D)`);
  if (shape2DCount > 0) detectedPrimitivesSummary.push(`${shape2DCount}x 2D-Profil (square/circle/polygon)`);
  if (hullCount > 0) detectedPrimitivesSummary.push(`${hullCount}x Hüllkörper (hull/minkowski)`);

  const primitiveCount = Math.max(
    detectedPrimitivesSummary.length,
    cubeCount + cylinderCount + sphereCount + polyhedronCount + extrudeCount + shape2DCount
  );

  let suggestedName = explicitNameMatch;
  if (!suggestedName && moduleNames.length > 0) {
    suggestedName = moduleNames[0]
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (!suggestedName) {
    suggestedName = 'Neues OpenSCAD Bauteil';
  }

  return {
    primitiveCount,
    parameterCount: Object.keys(parameters).length,
    hasDifference,
    hasUnion,
    moduleNames,
    suggestedName,
    parameters,
    detectedPrimitivesSummary,
  };
}

/**
 * Creates a complete CADModelProject from raw user-provided OpenSCAD code.
 */
export function createProjectFromScadCode(params: {
  name?: string;
  scadCode: string;
  folderId?: string;
  author?: string;
  finish?: MaterialFinish;
  shareDuration?: ShareDurationPreset;
}): CADModelProject {
  const analysis = analyzeScadCodeStructure(params.scadCode);
  const cleanName = (params.name?.trim() || analysis.suggestedName || 'Neues OpenSCAD Modell').slice(0, 60);
  const targetFolderId = params.folderId || 'folder-prototypes';
  const author = params.author || 'CAD Ingenieur';
  const finish: MaterialFinish = params.finish || 'titanium';
  const duration: ShareDurationPreset = params.shareDuration || '24h';
  const id = `proj-scad-${Date.now()}`;
  const extractedParams = Object.keys(analysis.parameters).length > 0
    ? analysis.parameters
    : { scale: 100 };

  const project: CADModelProject = {
    id,
    folderId: targetFolderId,
    name: cleanName,
    category: analysis.moduleNames.length > 0
      ? `OpenSCAD · ${analysis.moduleNames[0]}`
      : 'OpenSCAD Parametrik · Eigener Entwurf',
    format: 'scad',
    updatedAt: 'Gerade eben',
    author,
    shareToken: `share-${Date.now().toString(36)}`,
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: duration,
      expiresAtMs: computeShareExpiryTimestamp(duration),
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: true,
    },
    currentVersion: 1,
    scadCode: params.scadCode.trim(),
    parameters: extractedParams,
    finish,
    explodedFactor: 0,
    versions: [
      {
        versionNumber: 1,
        createdAt: 'Gerade eben',
        author,
        changelog: `Initialer OpenSCAD Quelltext-Import (${params.scadCode.length} Zeichen, ${analysis.primitiveCount} Primitives)`,
        parameters: extractedParams,
        finish,
        scadCode: params.scadCode.trim(),
      },
    ],
    comments: [],
    measurements: [],
  };

  return project;
}



