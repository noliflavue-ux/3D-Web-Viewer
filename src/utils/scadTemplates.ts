export interface ScadTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  code: string;
}

export const SCAD_TEMPLATES: ScadTemplate[] = [
  {
    id: 'flange_cylinder',
    title: 'Flansch-Hohlzylinder mit Bohrungskranz',
    category: 'Präzisions-Drehteil',
    description: 'Machined Hollow Cylinder mit Montage-Flansch und 4 Bohrungen',
    code: `// Flansch-Hohlzylinder mit 4-Punkt Montagebohrungen
flange_dia = 56;
flange_thick = 8;
tube_height = 48;
inner_bore = 18;
outer_tube_dia = 32;

// Haupt-Zylinder mit Innenbohrung
difference() {
  // Grundkörper
  union() {
    cylinder(h = tube_height, r = outer_tube_dia / 2);
    cylinder(h = flange_thick, r = flange_dia / 2);
  }
  // Durchgehende Zentrierbohrung
  translate([0, 0, -2]) {
    cylinder(h = tube_height + 4, r = inner_bore / 2);
  }
  // 4x Flansch-Schraubenbohrungen M5
  translate([18, 0, -2]) cylinder(h = flange_thick + 4, r = 2.7);
  translate([-18, 0, -2]) cylinder(h = flange_thick + 4, r = 2.7);
  translate([0, 18, -2]) cylinder(h = flange_thick + 4, r = 2.7);
  translate([0, -18, -2]) cylinder(h = flange_thick + 4, r = 2.7);
}
`,
  },
  {
    id: 'csg_block',
    title: 'CSG Differenz-Prismenblock',
    category: 'Gehäuse & Mechanik',
    description: 'Präziser Kubus mit zylindrischer Passungsbohrung und Quer-Aussparung',
    code: `// CSG Differenz-Block
block_width = 44;
block_depth = 44;
block_height = 24;
center_bore = 16;
slot_width = 12;

difference() {
  // Massiver Basiskubus
  translate([0, 0, 0]) {
    cube([block_width, block_depth, block_height]);
  }
  // Vertikale Durchgangsbohrung
  translate([block_width / 2, block_depth / 2, -2]) {
    cylinder(h = block_height + 4, r = center_bore / 2);
  }
  // Horizontale Führungsnut
  translate([-2, (block_depth - slot_width) / 2, block_height - 6]) {
    cube([block_width + 4, slot_width, 8]);
  }
}
`,
  },
  {
    id: 'radial_impeller',
    title: 'Parametrisches Radial-Laufrad',
    category: 'Strömungsmechanik',
    description: 'Aero-Impeller mit Schaufelkranz, Nabenkonus und Wellenbohrung',
    code: `// Parametrischer Radialverdichter Impeller
blade_count = 11;
outer_radius = 44;
hub_height = 30;
bore_diameter = 15;

module aero_turbine_impeller() {
  // Integrierter Strömungskörper
  cylinder(h = hub_height, r = outer_radius);
}

aero_turbine_impeller();
`,
  },
  {
    id: 'planetary_gear',
    title: 'Planetenrad mit Evolventenprofil',
    category: 'Getriebetechnik',
    description: 'Präzisions-Zahnrad mit anpassbarer Zähnezahl und Nabeneinsatz',
    code: `// Parametrisches Stirnzahnrad DIN 3967
teeth_count = 18;
pitch_radius = 38;
gear_thickness = 16;
hub_bore = 12;

module planetary_helical_gear() {
  cylinder(h = gear_thickness, r = pitch_radius);
}

planetary_helical_gear();
`,
  },
  {
    id: 'sensor_enclosure',
    title: 'Elektronik- & Sensor-Gehäuse',
    category: 'Prototyping',
    description: 'Gehäusebox mit Wandstärke, Kabeleinlass und Deckelfalz',
    code: `// Sensor- und Controllergehäuse
case_len = 62;
case_width = 46;
case_height = 26;
wall_thickness = 3.5;
cable_port = 8;

difference() {
  // Außenkontur
  cube([case_len, case_width, case_height]);
  // Innenkammer
  translate([wall_thickness, wall_thickness, wall_thickness]) {
    cube([case_len - 2 * wall_thickness, case_width - 2 * wall_thickness, case_height]);
  }
  // Seitliche Kabeldurchführung
  translate([-2, case_width / 2, case_height / 2]) {
    rotate([0, 90, 0]) {
      cylinder(h = wall_thickness + 4, r = cable_port / 2);
    }
  }
}
`,
  },
];
