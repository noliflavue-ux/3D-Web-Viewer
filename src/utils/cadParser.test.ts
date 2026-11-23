import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePointToPointMetrics,
  calculateSeparationVector,
  computeShareExpiryTimestamp,
  evaluateShareLinkValidity,
  extractScadParameters,
  updateScadParameterInCode,
  parseScadCode,
  exportPositionsToAsciiSTL,
  exportPositionsToOBJ,
  exportMetadataToSTEP,
  parseStepFileMetrics,
  filterAndSortProjects,
  getProjectMetadataMatches,
  moveProjectToFolder,
  analyzeScadCodeStructure,
  createProjectFromScadCode,
} from './cadParser';
import { INITIAL_CAD_FOLDERS, INITIAL_CAD_PROJECTS } from './defaultProjects';
import { validateCADUpload, sanitizeUserText } from './securityScanner';

test('calculatePointToPointMetrics computes exact 3D Euclidean distance and deltas', () => {
  const res = calculatePointToPointMetrics({ x: 0, y: 0, z: 0 }, { x: 30, y: 40, z: 0 });
  assert.equal(res.distanceMm, 50);
  assert.equal(res.deltaX, 30);
  assert.equal(res.deltaY, 40);
  assert.equal(res.deltaZ, 0);
});

test('computeShareExpiryTimestamp and evaluateShareLinkValidity enforce mandatory time limits', () => {
  const fixedNow = 1_700_000_000_000;
  const exp24h = computeShareExpiryTimestamp('24h', fixedNow);
  assert.equal(exp24h, fixedNow + 24 * 60 * 60 * 1000);

  const validCheck = evaluateShareLinkValidity(exp24h, fixedNow + 60 * 60 * 1000);
  assert.equal(validCheck.isValid, true);
  assert.ok(validCheck.remainingLabel.includes('23h'));

  const expiredCheck = evaluateShareLinkValidity(exp24h, exp24h + 1000);
  assert.equal(expiredCheck.isValid, false);
  assert.equal(expiredCheck.remainingLabel, 'Abgelaufen');
});

test('calculateSeparationVector computes outward and axial separation vectors for nested parts', () => {
  // Coaxial parts separate along Y axis
  const bottomVec = calculateSeparationVector({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }, 0, 4, 30);
  const topVec = calculateSeparationVector({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }, 3, 4, 30);
  assert.ok(bottomVec.y < 0);
  assert.ok(topVec.y > 0);

  // Radially offset parts separate outward
  const sideRibVec = calculateSeparationVector({ x: 25, y: 15, z: 0 }, { x: 0, y: 10, z: 0 }, 2, 5, 36);
  assert.ok(sideRibVec.x > 15);
  assert.ok(sideRibVec.y > 0);
});

test('extractScadParameters and updateScadParameterInCode preserve and mutate parameters cleanly', () => {
  const scad = `
    // Precision Turbo Impeller
    outer_radius = 42;
    blade_count = 9;
    hub_height = 28.5;
    module aero_turbine_impeller() {
      cylinder(h = hub_height, r = outer_radius);
    }
  `;
  const params = extractScadParameters(scad);
  assert.equal(params.outer_radius, 42);
  assert.equal(params.blade_count, 9);
  assert.equal(params.hub_height, 28.5);

  const updated = updateScadParameterInCode(scad, 'blade_count', 12);
  const nextParams = extractScadParameters(updated);
  assert.equal(nextParams.blade_count, 12);
  assert.equal(nextParams.outer_radius, 42);
});

test('parseScadCode generates primitives from custom OpenSCAD statements', () => {
  const scad = `
    box_w = 50;
    translate([10, 5, 0]) cube([box_w, 30, 15]);
    cylinder(h = 40, r = 12);
  `;
  const parsed = parseScadCode(scad);
  assert.equal(parsed.primitives.length, 2);
  assert.equal(parsed.primitives[0].type, 'cube');
  assert.deepEqual(parsed.primitives[0].size, [50, 30, 15]);
  assert.deepEqual(parsed.primitives[0].position, [10, 5, 0]);
});

test('exportPositionsToAsciiSTL, OBJ and STEP format valid CAD output', () => {
  const tris = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  const stl = exportPositionsToAsciiSTL(tris, 'TestBracket');
  assert.ok(stl.startsWith('solid TestBracket'));
  assert.ok(stl.includes('facet normal 0.0000 0.0000 1.0000'));
  assert.ok(stl.endsWith('endsolid TestBracket'));

  const obj = exportPositionsToOBJ(tris, 'TestBracket');
  assert.ok(obj.includes('v 10.0000 0.0000 0.0000'));
  assert.ok(obj.includes('f 1 2 3'));

  const step = exportMetadataToSTEP('TestBracket', {
    width: 60,
    height: 40,
    depth: 20,
    volumeCm3: 48,
    surfaceAreaCm2: 88,
    triangleCount: 120,
  });
  assert.ok(step.includes('ISO-10303-21;'));
  assert.ok(step.includes('MANIFOLD_SOLID_BREP'));
});

test('validateCADUpload blocks executable MZ headers and script injections while allowing valid CAD files', () => {
  // 1. Valid SCAD file
  const validScadText = 'wall = 5;\ncube([20, 20, 10]);\ncylinder(h=15, r=5);';
  const validScadBytes = new TextEncoder().encode(validScadText);
  const report1 = validateCADUpload('housing.scad', validScadBytes, validScadText);
  assert.equal(report1.passed, true);
  assert.equal(report1.detectedFormat, 'scad');

  // 2. Malicious EXE disguised as .stl
  const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
  const report2 = validateCADUpload('malware.stl', exeBytes);
  assert.equal(report2.passed, false);
  assert.equal(report2.checks.noExecutableSignatures, false);

  // 3. Script injection inside .scad
  const xssScad = 'cube([10,10,10]); <script>fetch("http://evil.tld")</script>';
  const xssBytes = new TextEncoder().encode(xssScad);
  const report3 = validateCADUpload('exploit.scad', xssBytes, xssScad);
  assert.equal(report3.passed, false);
  assert.equal(report3.checks.noScriptInjection, false);

  // 4. Valid STEP file
  const validStep = `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#10=CARTESIAN_POINT('Origin',(0.0,15.0,42.0));\n#20=CIRCLE('',$,28.5);\nENDSEC;\nEND-ISO-10303-21;`;
  const stepBytes = new TextEncoder().encode(validStep);
  const report4 = validateCADUpload('flange.step', stepBytes, validStep);
  assert.equal(report4.passed, true);
  const stepMetrics = parseStepFileMetrics(validStep);
  assert.equal(stepMetrics.detectedRadius, 28.5);
  assert.equal(stepMetrics.cartesianPoints.length, 1);

  // 5. Sanitize user text strips HTML tags
  assert.equal(sanitizeUserText('<b>Bohrung +0.2mm</b><script>alert(1)</script>'), 'Bohrung +0.2mmalert(1)');
});

test('filterAndSortProjects filters by Ablage (folderId), format, search and sorts cleanly', () => {
  const turboOnly = filterAndSortProjects(INITIAL_CAD_PROJECTS, {
    folderId: 'folder-turbomachinery',
    format: 'all',
    searchQuery: '',
    sortBy: 'name_asc',
  });
  assert.equal(turboOnly.length, 2);
  assert.equal(turboOnly[0].id, 'proj-turbine-impeller');

  const sortedByComments = filterAndSortProjects(INITIAL_CAD_PROJECTS, {
    folderId: 'all',
    format: 'all',
    searchQuery: '',
    sortBy: 'comments_desc',
  });
  assert.equal(sortedByComments[0].id, 'proj-turbine-impeller');
});

test('moveProjectToFolder moves a project to a target Ablage and detects no-op drops on the same Ablage', () => {
  const resultMoved = moveProjectToFolder(
    INITIAL_CAD_PROJECTS,
    'proj-turbine-impeller',
    'folder-robotics'
  );
  assert.equal(resultMoved.moved, true);
  assert.equal(resultMoved.previousFolderId, 'folder-turbomachinery');
  const updatedImpeller = resultMoved.updatedProjects.find((p) => p.id === 'proj-turbine-impeller');
  assert.equal(updatedImpeller?.folderId, 'folder-robotics');

  // Dropping onto the same folder should be a clean no-op
  const resultNoOp = moveProjectToFolder(
    resultMoved.updatedProjects,
    'proj-turbine-impeller',
    'folder-robotics'
  );
  assert.equal(resultNoOp.moved, false);
});

test('getProjectMetadataMatches and filterAndSortProjects search across names and deep CAD metadata globally', () => {
  // 1. Search by OpenSCAD parameter name ('blade_count')
  const paramSearch = filterAndSortProjects(INITIAL_CAD_PROJECTS, {
    folderId: 'folder-robotics', // even when inside another folder
    format: 'all',
    searchQuery: 'blade_count',
    sortBy: 'updated',
    folders: INITIAL_CAD_FOLDERS,
    globalSearchAcrossFolders: true,
  });
  assert.equal(paramSearch.length, 2); // Impeller RX-9 and Venturi DN-52 both have blade_count

  // 2. Search by 3D comment text ('Kavitation') and check matchedFields badge
  const matchInfo = getProjectMetadataMatches(
    INITIAL_CAD_PROJECTS[0],
    'Titan Kavitation blade_count',
    INITIAL_CAD_FOLDERS
  );
  assert.equal(matchInfo.matches, true);
  assert.ok(matchInfo.matchedFields.some((f) => f.startsWith('Werkstoff')));
  assert.ok(matchInfo.matchedFields.includes('3D-Kommentar'));
  assert.ok(matchInfo.matchedFields.includes('Parameter (blade_count)'));

  // 3. Search by version changelog ('SolidWorks')
  const changelogSearch = filterAndSortProjects(INITIAL_CAD_PROJECTS, {
    folderId: 'all',
    format: 'all',
    searchQuery: 'SolidWorks',
    sortBy: 'updated',
    folders: INITIAL_CAD_FOLDERS,
  });
  assert.equal(changelogSearch.length, 1);
  assert.equal(changelogSearch[0].id, 'proj-planetary-step');
});

test('analyzeScadCodeStructure and createProjectFromScadCode produce valid CADModelProject with parameters and primitives', () => {
  const customScad = `
    // Titel: Sensor-Gehäuse Aluminium
    wall_thickness = 4.2;
    housing_len = 65;
    housing_height = 28;

    difference() {
      cube([housing_len, 45, housing_height]);
      translate([wall_thickness, wall_thickness, 2]) {
        cube([housing_len - 8, 37, housing_height]);
      }
      cylinder(h = 30, r = 6);
    }
  `;

  const analysis = analyzeScadCodeStructure(customScad);
  assert.equal(analysis.primitiveCount >= 3, true);
  assert.equal(analysis.hasDifference, true);
  assert.equal(analysis.parameterCount, 3);
  assert.equal(analysis.parameters.wall_thickness, 4.2);
  assert.equal(analysis.suggestedName, 'Sensor-Gehäuse Aluminium');

  const project = createProjectFromScadCode({
    name: 'Mein Sensor-Gehäuse',
    scadCode: customScad,
    folderId: 'folder-robotics',
    author: 'Dr. Lukas Weber',
    finish: 'anodized_blue',
  });

  assert.equal(project.format, 'scad');
  assert.equal(project.name, 'Mein Sensor-Gehäuse');
  assert.equal(project.folderId, 'folder-robotics');
  assert.equal(project.finish, 'anodized_blue');
  assert.equal(project.parameters.wall_thickness, 4.2);
  assert.equal(project.versions.length, 1);
  assert.equal(project.currentVersion, 1);
  assert.ok((project.shareConfig?.expiresAtMs ?? 0) > Date.now());
});




