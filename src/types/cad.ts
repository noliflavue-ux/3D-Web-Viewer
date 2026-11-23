export type CADFormat = 'scad' | 'stl' | 'step';

export type MaterialFinish =
  | 'titanium'
  | 'anodized_blue'
  | 'frosted_glass'
  | 'matte_polymer'
  | 'brushed_gold';

export type CameraPreset = 'iso' | 'front' | 'top' | 'right';

export type ToolMode = 'orbit' | 'measure' | 'annotate';

export type CADFolderColor = 'sky' | 'emerald' | 'amber' | 'indigo' | 'rose';

export type ModelSortOption =
  | 'updated'
  | 'name_asc'
  | 'format'
  | 'comments_desc'
  | 'version_desc';

export interface CADFolder {
  id: string;
  name: string;
  description: string;
  colorAccent: CADFolderColor;
  createdAt: string;
}

export interface Vector3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface BoundingDimensions {
  width: number;
  height: number;
  depth: number;
  volumeCm3: number;
  surfaceAreaCm2: number;
  triangleCount: number;
}

export interface SpatialComment {
  id: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  text: string;
  position: Vector3Tuple;
  normal: Vector3Tuple;
  resolved: boolean;
  versionNumber: number;
}

export interface MeasurementRecord {
  id: string;
  label: string;
  pointA: Vector3Tuple;
  pointB: Vector3Tuple;
  distanceMm: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
}

export interface ModelVersion {
  versionNumber: number;
  createdAt: string;
  author: string;
  changelog: string;
  scadCode?: string;
  parameters: Record<string, number>;
  finish: MaterialFinish;
}

export interface SecurityScanReport {
  passed: boolean;
  fileName: string;
  fileSizeBytes: number;
  detectedFormat: CADFormat | 'unknown';
  sha256Preview: string;
  checks: {
    extensionAllowed: boolean;
    magicBytesValid: boolean;
    noExecutableSignatures: boolean;
    noScriptInjection: boolean;
    sizeWithinQuota: boolean;
  };
  threatSummary: string;
  timestamp: string;
}

export type ShareDurationPreset = '1h' | '24h' | '7d' | '30d';

export type StudioTheme = 'vision_spatial' | 'titanium_dark' | 'blueprint_cryo';

export interface ShareLinkConfig {
  durationPreset: ShareDurationPreset;
  expiresAtMs: number;
  allowGuestComments: boolean;
  allowGuestMeasurements: boolean;
  allowGuestDownload: boolean;
}

export interface WorkspaceSettings {
  unitSystem: 'mm' | 'inch';
  defaultShareDuration: ShareDurationPreset;
  soundEffectsEnabled: boolean;
  showGridFloor: boolean;
  autoBoundingBoxOnLoad: boolean;
  strictZeroTrustUpload: boolean;
  defaultMaterialFinish: MaterialFinish;
  studioTheme?: StudioTheme;
  autoTurntable?: boolean;
}

export interface CADModelProject {
  id: string;
  folderId?: string;
  name: string;
  category: string;
  format: CADFormat;
  updatedAt: string;
  author: string;
  shareToken: string;
  isPublicShareEnabled: boolean;
  shareConfig?: ShareLinkConfig;
  currentVersion: number;
  scadCode: string;
  stlBufferBase64?: string;
  stepSourceText?: string;
  parameters: Record<string, number>;
  finish: MaterialFinish;
  explodedFactor: number;
  versions: ModelVersion[];
  comments: SpatialComment[];
  measurements: MeasurementRecord[];
  lastSecurityReport?: SecurityScanReport;
}

export interface UserSession {
  email: string;
  name: string;
  role: string;
  authenticatedAt: string;
}
