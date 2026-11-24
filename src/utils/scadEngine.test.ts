import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { evaluateOpenScadToGeometries } from './scadEngine';
import { buildCADAssemblyGroup } from './cadGeometryBuilder';
import { createProjectFromScadCode } from './cadParser';
import { validateCADUpload } from './securityScanner';

function getCombinedBox(parts: { geometry: THREE.BufferGeometry }[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    if (p.geometry.boundingBox) {
      box.union(p.geometry.boundingBox);
    }
  }
  return box;
}

test('scadEngine evaluates real 3D CSG difference() with exact outer dimensions and subtracted volume', () => {
  // 50 x 30 x 10 plate with a 12 mm diameter through-hole
  const scad = `
    $fn = 48;
    plate_x = 50;
    plate_y = 30;
    plate_z = 10;
    hole_d = 12;

    difference() {
      cube([plate_x, plate_y, plate_z], center = true);
      cylinder(h = plate_z + 4, d = hole_d, center = true);
    }
  `;

  const proj = createProjectFromScadCode({
    name: 'Lochplatte',
    scadCode: scad,
    finish: 'titanium',
  });
  const built = buildCADAssemblyGroup(proj, true, false);

  // OpenSCAD X -> Three X (50), OpenSCAD Z -> Three Y (10), OpenSCAD Y -> Three Z (30)
  assert.equal(built.dimensions.width, 50);
  assert.equal(built.dimensions.height, 10);
  assert.equal(built.dimensions.depth, 30);

  // Analytical volume = (50 * 30 * 10 - pi * 6^2 * 10) / 1000 = 15.0 - 1.13097 = 13.869 cm³
  assert.ok(
    Math.abs(built.dimensions.volumeCm3 - 13.87) < 0.15,
    `Expected subtracted volume ~13.87 cm³, got ${built.dimensions.volumeCm3}`
  );
});

test('scadEngine does NOT hijack user .scad files containing flange_width, blade_count, or teeth_count', () => {
  const scad = `
    flange_width = 92;
    blade_count = 4;
    teeth_count = 12;
    cube([flange_width, 20, 6]);
  `;
  const proj = createProjectFromScadCode({
    name: 'Custom Bar',
    scadCode: scad,
    finish: 'titanium',
  });
  const built = buildCADAssemblyGroup(proj, true, false);

  // Must match user's exact 92 x 6 (height) x 20 (depth) bar, NOT the 68x44 servo bracket!
  assert.equal(built.dimensions.width, 92);
  assert.equal(built.dimensions.height, 6);
  assert.equal(built.dimensions.depth, 20);
  assert.ok(Math.abs(built.dimensions.volumeCm3 - (92 * 20 * 6) / 1000) < 0.05);
});

test('scadEngine handles user modules, for loops, trig expressions (degrees), and nested transforms', () => {
  const scad = `
    $fn = 36;
    outer_r = 35;
    thick = 8;
    bolt_r = 25;
    bolt_d = 6;
    holes = 6;

    module bolt_pattern(n, rad) {
      for (i = [0 : n - 1]) {
        ang = i * (360 / n);
        translate([cos(ang) * rad, sin(ang) * rad, -1])
          cylinder(h = thick + 2, d = bolt_d);
      }
    }

    difference() {
      cylinder(h = thick, r = outer_r);
      translate([0, 0, -1]) cylinder(h = thick + 2, r = 10);
      bolt_pattern(holes, bolt_r);
    }
  `;

  const proj = createProjectFromScadCode({
    name: 'Flanschscheibe',
    scadCode: scad,
    finish: 'anodized_blue',
  });
  const built = buildCADAssemblyGroup(proj, true, false);

  // Outer diameter ~70 mm, height 8 mm
  assert.ok(Math.abs(built.dimensions.width - 70) < 0.5);
  assert.equal(built.dimensions.height, 8);
  assert.ok(Math.abs(built.dimensions.depth - 70) < 0.5);

  // Analytical volume: pi * (35^2 - 10^2 - 6*3^2) * 8 / 1000 = pi * (1225 - 100 - 54) * 8 / 1000 ≈ 26.917 cm³
  assert.ok(
    Math.abs(built.dimensions.volumeCm3 - 26.92) < 0.6,
    `Expected flange volume ~26.92 cm³, got ${built.dimensions.volumeCm3}`
  );
});

test('scadEngine extrudes 2D difference() with linear_extrude accurately', () => {
  const scad = `
    $fn = 48;
    linear_extrude(height = 15) {
      difference() {
        square([40, 40], center = true);
        circle(r = 10);
      }
    }
  `;

  const proj = createProjectFromScadCode({
    name: 'Extruded Frame',
    scadCode: scad,
  });
  const built = buildCADAssemblyGroup(proj, true, false);

  assert.equal(built.dimensions.width, 40);
  assert.equal(built.dimensions.height, 15);
  assert.equal(built.dimensions.depth, 40);

  // Analytical volume = (40*40 - pi*10^2) * 15 / 1000 ≈ 19.288 cm³
  assert.ok(
    Math.abs(built.dimensions.volumeCm3 - 19.29) < 0.35,
    `Expected extruded volume ~19.29 cm³, got ${built.dimensions.volumeCm3}`
  );
});

test('scadEngine handles rotate_extrude() with 2D polygon profile', () => {
  const scad = `
    $fn = 48;
    rotate_extrude() {
      polygon(points = [[10, 0], [20, 0], [20, 12], [10, 12]]);
    }
  `;
  const res = evaluateOpenScadToGeometries(scad);
  assert.equal(res.parts.length, 1);
  const box = getCombinedBox(res.parts);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Ring of outer radius 20 (diameter 40) and Z height 12
  assert.ok(Math.abs(size.x - 40) < 0.6, `Expected X~40, got ${size.x}`);
  assert.ok(Math.abs(size.y - 40) < 0.6, `Expected Y~40, got ${size.y}`);
  assert.ok(Math.abs(size.z - 12) < 0.3, `Expected Z~12, got ${size.z}`);
});

test('scadEngine handles hull() and polyhedron() accurately', () => {
  const hullScad = `
    hull() {
      translate([0, 0, 0]) cylinder(h = 10, r = 8);
      translate([40, 0, 0]) cylinder(h = 10, r = 8);
    }
  `;
  const hullRes = evaluateOpenScadToGeometries(hullScad);
  assert.equal(hullRes.parts.length, 1);
  const hullSize = new THREE.Vector3();
  getCombinedBox(hullRes.parts).getSize(hullSize);
  // Spans x from -8 to +48 -> width 56, depth 16, height 10
  assert.ok(Math.abs(hullSize.x - 56) < 0.5);
  assert.ok(Math.abs(hullSize.y - 16) < 0.5);
  assert.ok(Math.abs(hullSize.z - 10) < 0.3);

  const polyScad = `
    polyhedron(
      points = [[0,0,0], [20,0,0], [20,20,0], [0,20,0], [10,10,30]],
      faces = [[0,1,2,3], [0,4,1], [1,4,2], [2,4,3], [3,4,0]]
    );
  `;
  const polyProj = createProjectFromScadCode({ name: 'Pyramide', scadCode: polyScad });
  const polyBuilt = buildCADAssemblyGroup(polyProj, true, false);
  assert.equal(polyBuilt.dimensions.width, 20);
  assert.equal(polyBuilt.dimensions.height, 30);
  assert.equal(polyBuilt.dimensions.depth, 20);
  // Pyramid volume = (1/3) * 20 * 20 * 30 / 1000 = 4.0 cm³
  assert.ok(Math.abs(polyBuilt.dimensions.volumeCm3 - 4.0) < 0.1);
});

test('securityScanner accepts valid 2D/extrusion/rotate_extrude and pure config.scad uploads', () => {
  const scad2D = `$fn = 64;\nrotate_extrude() translate([12, 0]) circle(r = 4);`;
  const bytes = new TextEncoder().encode(scad2D);
  const report = validateCADUpload('o_ring.scad', bytes, scad2D);
  assert.equal(report.passed, true);
  assert.equal(report.detectedFormat, 'scad');

  // Pure parameter config.scad with zero geometry keywords must ALSO pass security validation
  const configScad = `// Gemeinsame Parameter\nplatte_breite = 120;\nplatte_tiefe = 60;\nplatte_dicke = 5;\nloch_durchmesser = 8;\n`;
  const cfgBytes = new TextEncoder().encode(configScad);
  const cfgReport = validateCADUpload('config.scad', cfgBytes, configScad);
  assert.equal(cfgReport.passed, true);
  assert.equal(cfgReport.detectedFormat, 'scad');
});

test('scadEngine resolves include <config.scad> (vars, functions, modules, relative paths) and reports missing includes', () => {
  const configScad = `
    $fn = 48;
    platte_b = 120;
    platte_t = 60;
    platte_h = 5;
    loch_d = 10;
    function loch_abstand() = platte_b / 2 - 20;
  `;
  const lochschabloneScad = `
    include <config.scad>

    difference() {
      cube([platte_b, platte_t, platte_h], center = true);
      for (sx = [-1, 1]) {
        translate([sx * loch_abstand(), 0, 0])
          cylinder(h = platte_h + 4, d = loch_d, center = true);
      }
    }
  `;

  // 1. Without config.scad: reports missingIncludes cleanly and does NOT crash or produce NaN
  const missingRes = evaluateOpenScadToGeometries(lochschabloneScad);
  assert.deepEqual(missingRes.missingIncludes, ['config.scad']);
  assert.equal(missingRes.parts.length, 0);

  // 2. With config.scad provided in libraries: builds exact 120 x 5 x 60 Lochschablone with 2 real CSG holes!
  const proj = createProjectFromScadCode({
    name: '02_lochschablone',
    scadCode: lochschabloneScad,
    finish: 'titanium',
  });
  proj.scadLibraries = { 'config.scad': configScad };

  const built = buildCADAssemblyGroup(proj, true, false);
  assert.equal(built.dimensions.missingScadIncludes, undefined);
  assert.deepEqual(built.dimensions.resolvedScadIncludes, ['config.scad']);
  assert.equal(built.dimensions.width, 120);
  assert.equal(built.dimensions.height, 5);
  assert.equal(built.dimensions.depth, 60);

  // Analytical volume = (120*60*5 - 2 * pi * 5^2 * 5) / 1000 = 36.0 - 0.7854 ≈ 35.21 cm³
  assert.ok(
    Math.abs(built.dimensions.volumeCm3 - 35.21) < 0.25,
    `Expected Lochschablone volume ~35.21 cm³, got ${built.dimensions.volumeCm3}`
  );
});

test('scadEngine respects use <lib.scad> semantics (imports modules/functions without top-level geometry) and guards circular includes', () => {
  const libScad = `
    lib_height = 12;
    module helper_boss(r) {
      cylinder(h = lib_height, r = r);
    }
    // Top-level demo cube inside lib.scad MUST NOT render when imported via use <...>
    translate([500, 500, 0]) cube([200, 200, 200]);
  `;
  const mainScad = `
    use <../libs/helpers.scad>
    helper_boss(15);
  `;

  const res = evaluateOpenScadToGeometries(mainScad, {}, { 'helpers.scad': libScad });
  assert.equal(res.missingIncludes.length, 0);
  assert.equal(res.parts.length, 1);

  const box = getCombinedBox(res.parts);
  const size = new THREE.Vector3();
  box.getSize(size);
  // Only the 30x30x12 boss cylinder should exist (NOT the 200x200x200 top-level cube!)
  assert.ok(Math.abs(size.x - 30) < 0.6);
  assert.ok(Math.abs(size.y - 30) < 0.6);
  assert.ok(Math.abs(size.z - 12) < 0.3);

  // Circular include guard: a.scad -> b.scad -> a.scad must terminate safely
  const circA = `include <b.scad>\ncube([20, 20, 10]);`;
  const circB = `include <a.scad>\nsize_b = 10;`;
  const circRes = evaluateOpenScadToGeometries(circA, {}, { 'a.scad': circA, 'b.scad': circB });
  assert.equal(circRes.parts.length, 1);
});
