import { CADFolder, CADModelProject, ShareLinkConfig } from '../types/cad';
import { computeShareExpiryTimestamp } from './cadParser';

export const DEFAULT_SHARE_CONFIG: ShareLinkConfig = {
  durationPreset: '24h',
  expiresAtMs: computeShareExpiryTimestamp('24h'),
  allowGuestComments: true,
  allowGuestMeasurements: true,
  allowGuestDownload: false,
};

export const INITIAL_CAD_FOLDERS: CADFolder[] = [
  {
    id: 'folder-turbomachinery',
    name: 'Strömungsmechanik & Turbinen',
    description: 'Verdichterräder, Leitapparate & Venturi-Prüfstände',
    colorAccent: 'sky',
    createdAt: '01.11.2026',
  },
  {
    id: 'folder-robotics',
    name: 'Robotik & Aktuatoren',
    description: 'Flanschträger, Gelenkarme & Sensor-Aufnahmen',
    colorAccent: 'indigo',
    createdAt: '01.11.2026',
  },
  {
    id: 'folder-drivetrain',
    name: 'Getriebe & ISO-Normteile',
    description: 'Planetenradsätze, Wellen & STEP-AP214 Baugruppen',
    colorAccent: 'amber',
    createdAt: '02.11.2026',
  },
  {
    id: 'folder-prototypes',
    name: 'Prototypen & Prüflehren',
    description: 'Schnellmuster, 3D-Druck-Gehäuse & Kundenfreigaben',
    colorAccent: 'emerald',
    createdAt: '03.11.2026',
  },
];

export const INITIAL_CAD_PROJECTS: CADModelProject[] = [
  {
    id: 'proj-turbine-impeller',
    folderId: 'folder-turbomachinery',
    name: 'Aero-Radialverdichter Impeller RX-9',
    category: 'Strömungsmechanik · SCAD Parametrisch',
    format: 'scad',
    updatedAt: 'Vor 14 Min.',
    author: 'Dr. Lukas Weber',
    shareToken: 'rx9-impeller-public-token',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '24h',
      expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: false,
    },
    currentVersion: 3,
    finish: 'titanium',
    explodedFactor: 0,
    scadCode: `// AetherCAD Parametric OpenSCAD Script
// Bauteil: Aero-Radialverdichter Impeller RX-9
outer_radius = 42;
hub_height = 28;
blade_count = 9;
bore_diameter = 16;

module aero_turbine_impeller() {
  difference() {
    union() {
      cylinder(h = hub_height, r = outer_radius);
    }
    cylinder(h = hub_height + 4, d = bore_diameter);
  }
}

aero_turbine_impeller();`,
    parameters: {
      outer_radius: 42,
      hub_height: 28,
      blade_count: 9,
      bore_diameter: 16,
    },
    versions: [
      {
        versionNumber: 1,
        createdAt: '03.11.2026 · 09:15',
        author: 'Dr. Lukas Weber',
        changelog: 'Initialer 7-Schaufel Grundkörper mit 14mm Wellenbohrung',
        parameters: { outer_radius: 38, hub_height: 24, blade_count: 7, bore_diameter: 14 },
        finish: 'matte_polymer',
        scadCode: `outer_radius = 38;\nhub_height = 24;\nblade_count = 7;\nbore_diameter = 14;\nmodule aero_turbine_impeller() {\n  cylinder(h = hub_height, r = outer_radius);\n}`,
      },
      {
        versionNumber: 2,
        createdAt: '04.11.2026 · 16:40',
        author: 'Elena Rostova',
        changelog: 'Außendurchmesser auf 84mm (r=42) erhöht, Anodized Finish für thermische Prüfung',
        parameters: { outer_radius: 42, hub_height: 26, blade_count: 8, bore_diameter: 16 },
        finish: 'anodized_blue',
        scadCode: `outer_radius = 42;\nhub_height = 26;\nblade_count = 8;\nbore_diameter = 16;\nmodule aero_turbine_impeller() {\n  cylinder(h = hub_height, r = outer_radius);\n}`,
      },
      {
        versionNumber: 3,
        createdAt: '05.11.2026 · 11:20',
        author: 'Dr. Lukas Weber',
        changelog: 'Optimierte 9-Schaufel-Geometrie in Titan Grade 5 mit 28mm Nabenhöhe',
        parameters: { outer_radius: 42, hub_height: 28, blade_count: 9, bore_diameter: 16 },
        finish: 'titanium',
        scadCode: `// AetherCAD Parametric OpenSCAD Script\n// Bauteil: Aero-Radialverdichter Impeller RX-9\nouter_radius = 42;\nhub_height = 28;\nblade_count = 9;\nbore_diameter = 16;\n\nmodule aero_turbine_impeller() {\n  difference() {\n    union() {\n      cylinder(h = hub_height, r = outer_radius);\n    }\n    cylinder(h = hub_height + 4, d = bore_diameter);\n  }\n}\n\naero_turbine_impeller();`,
      },
    ],
    comments: [
      {
        id: 'cmt-101',
        authorName: 'Elena Rostova',
        authorRole: 'Lead CFD Engineer',
        createdAt: 'Heute · 10:42',
        text: 'Schaufelkante hier auf 0.4mm Radius verrunden, um Kavitation bei 45.000 U/min zu minimieren.',
        position: { x: 24.5, y: 14.0, z: 18.2 },
        normal: { x: 0.6, y: 0.5, z: 0.6 },
        resolved: false,
        versionNumber: 3,
      },
      {
        id: 'cmt-102',
        authorName: 'Markus Vance',
        authorRole: 'CNC Fertigung',
        createdAt: 'Heute · 11:05',
        text: 'Passfedernut und 16mm H7-Wellenbohrung für 5-Achs-Fräszentrum freigegeben.',
        position: { x: 0.0, y: 26.0, z: 7.5 },
        normal: { x: 0, y: 1, z: 0 },
        resolved: false,
        versionNumber: 3,
      },
    ],
    measurements: [
      {
        id: 'meas-1',
        label: 'Außendurchmesser Spannweite',
        pointA: { x: -42, y: 4, z: 0 },
        pointB: { x: 42, y: 4, z: 0 },
        distanceMm: 84.0,
        deltaX: 84.0,
        deltaY: 0,
        deltaZ: 0,
      },
    ],
    lastSecurityReport: {
      passed: true,
      fileName: 'rx9_impeller_v3.scad',
      fileSizeBytes: 4280,
      detectedFormat: 'scad',
      sha256Preview: '8f94e2c1a047d3b9',
      checks: {
        extensionAllowed: true,
        magicBytesValid: true,
        noExecutableSignatures: true,
        noScriptInjection: true,
        sizeWithinQuota: true,
      },
      threatSummary: 'Datei verifiziert: Keine ausführbaren Signaturen oder Skript-Injektionen erkannt.',
      timestamp: '11:20:04',
    },
  },
  {
    id: 'proj-servo-bracket',
    folderId: 'folder-robotics',
    name: 'Robotik-Aktuator Flanschträger MK4',
    category: 'Mechatronik · STL & SCAD Hybrid',
    format: 'stl',
    updatedAt: 'Gestern · 18:10',
    author: 'Elena Rostova',
    shareToken: 'mk4-servo-flange-share',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '7d',
      expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: true,
    },
    currentVersion: 2,
    finish: 'anodized_blue',
    explodedFactor: 0,
    scadCode: `// Robotik-Aktuator Flanschträger MK4
flange_width = 68;
bracket_height = 44;
wall_thickness = 8;
mount_bore = 14;

module precision_servo_bracket() {
  difference() {
    cube([flange_width, bracket_height, wall_thickness]);
    cylinder(h = wall_thickness + 2, d = mount_bore);
  }
}

precision_servo_bracket();`,
    parameters: {
      flange_width: 68,
      bracket_height: 44,
      wall_thickness: 8,
      mount_bore: 14,
    },
    versions: [
      {
        versionNumber: 1,
        createdAt: '01.11.2026 · 14:00',
        author: 'Elena Rostova',
        changelog: 'Basis-Flansch 60mm Breite aus Aluminium 7075',
        parameters: { flange_width: 60, bracket_height: 40, wall_thickness: 6, mount_bore: 12 },
        finish: 'titanium',
      },
      {
        versionNumber: 2,
        createdAt: '04.11.2026 · 18:10',
        author: 'Elena Rostova',
        changelog: 'Verstärkte 8mm Wandstärke und 68mm Flanschbreite für NEMA-23 Aufnahme',
        parameters: { flange_width: 68, bracket_height: 44, wall_thickness: 8, mount_bore: 14 },
        finish: 'anodized_blue',
      },
    ],
    comments: [
      {
        id: 'cmt-201',
        authorName: 'Dr. Lukas Weber',
        authorRole: 'Strukturanalyse',
        createdAt: 'Gestern · 19:00',
        text: 'FEM-Spannungsspitze am Übergangsradius unter 85 MPa – Sicherheitsfaktor 2.8 erreicht.',
        position: { x: 22.0, y: 18.0, z: 6.0 },
        normal: { x: 0, y: 1, z: 0 },
        resolved: false,
        versionNumber: 2,
      },
    ],
    measurements: [],
  },
  {
    id: 'proj-planetary-step',
    folderId: 'folder-drivetrain',
    name: 'Planetengetriebe Sonnenrad ISO-10303',
    category: 'Antriebstechnik · STEP AP214',
    format: 'step',
    updatedAt: '02.11.2026',
    author: 'Markus Vance',
    shareToken: 'step-planetary-gear-link',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '1h',
      expiresAtMs: Date.now() + 60 * 60 * 1000,
      allowGuestComments: false,
      allowGuestMeasurements: true,
      allowGuestDownload: false,
    },
    currentVersion: 1,
    finish: 'brushed_gold',
    explodedFactor: 0,
    scadCode: `// STEP AP214 Parametric Twin Representation
pitch_radius = 38;
gear_thickness = 18;
teeth_count = 18;

module planetary_helical_gear() {
  cylinder(h = gear_thickness, r = pitch_radius);
}

planetary_helical_gear();`,
    stepSourceText: `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Planetary Sun Gear AP214'),'2;1');\nENDSEC;\nDATA;\n#10=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));\n#20=CARTESIAN_POINT('Rim',(38.0,18.0,0.0));\n#30=CIRCLE('PitchCircle',#10,38.0);\nENDSEC;\nEND-ISO-10303-21;`,
    parameters: {
      pitch_radius: 38,
      gear_thickness: 18,
      teeth_count: 18,
    },
    versions: [
      {
        versionNumber: 1,
        createdAt: '02.11.2026 · 15:30',
        author: 'Markus Vance',
        changelog: 'STEP AP214 Import aus SolidWorks inkl. 18 Evolventenzähnen',
        parameters: { pitch_radius: 38, gear_thickness: 18, teeth_count: 18 },
        finish: 'brushed_gold',
      },
    ],
    comments: [
      {
        id: 'cmt-301',
        authorName: 'Markus Vance',
        authorRole: 'Qualitätssicherung',
        createdAt: '02.11.2026 · 16:12',
        text: 'Zahnflankenspiel nach DIN 3967 auf 0.03mm geprüft.',
        position: { x: 32.0, y: 10.0, z: 12.0 },
        normal: { x: 1, y: 0, z: 0 },
        resolved: false,
        versionNumber: 1,
      },
    ],
    measurements: [],
  },
  {
    id: 'proj-venturi-nozzle',
    folderId: 'folder-turbomachinery',
    name: 'Venturi-Kühlkanal Leitrad DN-52',
    category: 'Strömungsmechanik · SCAD Parametrisch',
    format: 'scad',
    updatedAt: '01.11.2026',
    author: 'Dr. Lukas Weber',
    shareToken: 'venturi-dn52-share',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '7d',
      expiresAtMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: false,
    },
    currentVersion: 2,
    finish: 'frosted_glass',
    explodedFactor: 0,
    scadCode: `// Venturi-Kühlkanal Leitrad DN-52
outer_radius = 36;
hub_height = 32;
blade_count = 12;
bore_diameter = 18;

module aero_turbine_impeller() {
  cylinder(h = hub_height, r = outer_radius);
}

aero_turbine_impeller();`,
    parameters: {
      outer_radius: 36,
      hub_height: 32,
      blade_count: 12,
      bore_diameter: 18,
    },
    versions: [
      {
        versionNumber: 2,
        createdAt: '01.11.2026 · 11:00',
        author: 'Dr. Lukas Weber',
        changelog: 'Optik-Prüfung in Acrylglas für Laser-Doppler-Anemometrie',
        parameters: { outer_radius: 36, hub_height: 32, blade_count: 12, bore_diameter: 18 },
        finish: 'frosted_glass',
      },
    ],
    comments: [],
    measurements: [],
  },
  {
    id: 'proj-lidar-mount',
    folderId: 'folder-robotics',
    name: 'LiDAR Sensor-Brücke Carbon V4',
    category: 'Robotik & Sensorik · STL Mesh',
    format: 'stl',
    updatedAt: '30.10.2026',
    author: 'Elena Rostova',
    shareToken: 'lidar-carbon-v4-share',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '30d',
      expiresAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: true,
    },
    currentVersion: 4,
    finish: 'matte_polymer',
    explodedFactor: 0,
    scadCode: `// LiDAR Sensor-Brücke Carbon V4
flange_width = 76;
bracket_height = 38;
wall_thickness = 7;
mount_bore = 16;

module precision_servo_bracket() {
  cube([flange_width, bracket_height, wall_thickness]);
}

precision_servo_bracket();`,
    parameters: {
      flange_width: 76,
      bracket_height: 38,
      wall_thickness: 7,
      mount_bore: 16,
    },
    versions: [
      {
        versionNumber: 4,
        createdAt: '30.10.2026 · 17:20',
        author: 'Elena Rostova',
        changelog: 'SLS-Nylon Leichtbau-Variante für autonome Drohnen-Plattform',
        parameters: { flange_width: 76, bracket_height: 38, wall_thickness: 7, mount_bore: 16 },
        finish: 'matte_polymer',
      },
    ],
    comments: [],
    measurements: [],
  },
  {
    id: 'proj-harmonic-ring',
    folderId: 'folder-prototypes',
    name: 'Prüflehre Hohlrad-Verzahnung M2.5',
    category: 'Prüfmittel · STEP AP214',
    format: 'step',
    updatedAt: '28.10.2026',
    author: 'Markus Vance',
    shareToken: 'ring-gauge-m25-share',
    isPublicShareEnabled: true,
    shareConfig: {
      durationPreset: '24h',
      expiresAtMs: Date.now() + 24 * 60 * 60 * 1000,
      allowGuestComments: true,
      allowGuestMeasurements: true,
      allowGuestDownload: false,
    },
    currentVersion: 1,
    finish: 'titanium',
    explodedFactor: 0,
    scadCode: `// Prüflehre Hohlrad-Verzahnung M2.5
pitch_radius = 44;
gear_thickness = 22;
teeth_count = 24;

module planetary_helical_gear() {
  cylinder(h = gear_thickness, r = pitch_radius);
}

planetary_helical_gear();`,
    stepSourceText: `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Ring Gauge M2.5'),'2;1');\nENDSEC;\nDATA;\n#10=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));\n#20=CIRCLE('PitchCircle',#10,44.0);\nENDSEC;\nEND-ISO-10303-21;`,
    parameters: {
      pitch_radius: 44,
      gear_thickness: 22,
      teeth_count: 24,
    },
    versions: [
      {
        versionNumber: 1,
        createdAt: '28.10.2026 · 09:40',
        author: 'Markus Vance',
        changelog: 'Referenz-Prüflehre mit 24 Zähnen für Wareneingangsprüfung',
        parameters: { pitch_radius: 44, gear_thickness: 22, teeth_count: 24 },
        finish: 'titanium',
      },
    ],
    comments: [],
    measurements: [],
  },
];

/**
 * Encodes a lightweight share payload with a mandatory expiration timestamp (`exp`)
 * into a URL query string so time-limited public links work on static webspace.
 */
export function encodeShareUrl(project: CADModelProject): string {
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : 'https://aethercad.studio/';
  const cfg = project.shareConfig || DEFAULT_SHARE_CONFIG;
  const payload = {
    id: project.id,
    n: project.name,
    f: project.format,
    v: project.currentVersion,
    fin: project.finish,
    p: project.parameters,
    c: project.comments.slice(0, 5),
    exp: cfg.expiresAtMs,
    dur: cfg.durationPreset,
    gc: cfg.allowGuestComments,
    gm: cfg.allowGuestMeasurements,
    gd: cfg.allowGuestDownload,
  };
  try {
    const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
    return `${baseUrl}?share=${project.shareToken}&exp=${cfg.expiresAtMs}&payload=${encoded}`;
  } catch {
    return `${baseUrl}?share=${project.shareToken}&exp=${cfg.expiresAtMs}`;
  }
}
