import React, { useEffect, useRef, useState } from 'react';
import {
  BoundingDimensions,
  CADFolder,
  CADFolderColor,
  CADModelProject,
  CameraPreset,
  MaterialFinish,
  MeasurementRecord,
  SecurityScanReport,
  ShareDurationPreset,
  ShareLinkConfig,
  SpatialComment,
  StudioTheme,
  ToolMode,
  UserSession,
  Vector3Tuple,
  WorkspaceSettings,
} from './types/cad';
import {
  DEFAULT_SHARE_CONFIG,
  INITIAL_CAD_FOLDERS,
  INITIAL_CAD_PROJECTS,
  encodeShareUrl,
} from './utils/defaultProjects';
import {
  calculatePointToPointMetrics,
  computeShareExpiryTimestamp,
  evaluateShareLinkValidity,
  exportMetadataToSTEP,
  exportPositionsToAsciiSTL,
  exportPositionsToOBJ,
  extractScadParameters,
  moveProjectToFolder,
  updateScadParameterInCode,
} from './utils/cadParser';
import { sanitizeUserText, validateCADUpload } from './utils/securityScanner';
import { soundEngine } from './utils/soundEngine';
import { MATERIAL_SPECS, formatMassDisplay } from './utils/physicalProperties';
import { CADViewport } from './components/CADViewport';
import { ActiveDrawerTab, BottomGlassDock } from './components/BottomGlassDock';
import { AuthGateModal } from './components/AuthGateModal';
import { ShareLinkModal } from './components/ShareLinkModal';
import { ModelsOverviewModal } from './components/ModelsOverviewModal';
import { SettingsModal } from './components/SettingsModal';
import { ScadCodeEditorModal } from './components/ScadCodeEditorModal';
import {
  Upload,
  Lock,
  Unlock,
  ShieldAlert,
  CheckCircle2,
  FolderKanban,
  Folder,
  Clock,
  Copy,
  Check,
  Sun,
  Scale,
  RotateCw,
  Link2,
  ChevronDown,
  ChevronUp,
  Menu,
  X,
  Code2,
} from 'lucide-react';

const STORAGE_KEY_PROJECTS = 'aethercad_projects_v3';
const STORAGE_KEY_FOLDERS = 'aethercad_folders_v1';
const STORAGE_KEY_SESSION = 'aethercad_user_session_v1';
const STORAGE_KEY_SETTINGS = 'aethercad_workspace_settings_v1';

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  unitSystem: 'mm',
  defaultShareDuration: '24h',
  soundEffectsEnabled: true,
  showGridFloor: true,
  autoBoundingBoxOnLoad: true,
  strictZeroTrustUpload: true,
  defaultMaterialFinish: 'titanium',
  studioTheme: 'vision_spatial',
  autoTurntable: false,
};

export default function App() {
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (raw) {
        return { ...DEFAULT_WORKSPACE_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_WORKSPACE_SETTINGS;
  });

  // Load persisted folders (Ablagen) from localStorage
  const [folders, setFolders] = useState<CADFolder[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_FOLDERS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_CAD_FOLDERS;
  });

  const [selectedFolderId, setSelectedFolderId] = useState<string | 'all'>('all');

  // Load persisted projects from localStorage or fall back to deterministic engineering projects
  const [projects, setProjects] = useState<CADModelProject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PROJECTS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p: CADModelProject) => ({
            ...p,
            folderId: p.folderId || 'folder-prototypes',
            shareConfig: p.shareConfig || {
              ...DEFAULT_SHARE_CONFIG,
              expiresAtMs: computeShareExpiryTimestamp('24h'),
            },
          }));
        }
      }
    } catch {
      // ignore storage errors
    }
    return INITIAL_CAD_PROJECTS;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(INITIAL_CAD_PROJECTS[0].id);

  // Check URL query parameters for ?share=token&exp=timestamp
  const [publicShareMode, setPublicShareMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const hasShare = Boolean(params.get('share'));
    if (!hasShare) return false;
    const expParam = Number(params.get('exp'));
    if (expParam && !evaluateShareLinkValidity(expParam).isValid) {
      return false;
    }
    return true;
  });

  const [userSession, setUserSession] = useState<UserSession | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      return {
        email: 'lukas.weber@aethercad.de',
        name: 'Dr. Lukas Weber',
        role: 'Lead CAD Architect',
        authenticatedAt: '11:20',
      };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return {
      email: 'lukas.weber@aethercad.de',
      name: 'Dr. Lukas Weber',
      role: 'Lead CAD Architect',
      authenticatedAt: '11:20',
    };
  });

  const [activeDrawerTab, setActiveDrawerTab] = useState<ActiveDrawerTab>('none');
  const [toolMode, setToolMode] = useState<ToolMode>('orbit');
  const [showDimensions, setShowDimensions] = useState<boolean>(
    workspaceSettings.autoBoundingBoxOnLoad
  );
  const [showCenterOfMass, setShowCenterOfMass] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);
  const [sideBySideExploded, setSideBySideExploded] = useState<boolean>(false);
  const [isAutoExploding, setIsAutoExploding] = useState<boolean>(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [cameraPresetTrigger, setCameraPresetTrigger] = useState<number>(0);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(
    workspaceSettings.soundEffectsEnabled
  );

  // Decluttered Top-Left Studio Card collapse state (collapsed by default on narrow iPhone viewports)
  const [isLeftRailExpanded, setIsLeftRailExpanded] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 640 : true
  );
  const [quickLinkCopied, setQuickLinkCopied] = useState<boolean>(false);

  // Spatial Modals for Model Overview & Ablagen, Settings Control Center, SCAD Editor, and Time-Limited Share Link Hub
  const [isModelsOverviewOpen, setIsModelsOverviewOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [isScadEditorOpen, setIsScadEditorOpen] = useState<boolean>(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const [latestSecurityReport, setLatestSecurityReport] = useState<SecurityScanReport | undefined>(
    undefined
  );
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [computedDimensions, setComputedDimensions] = useState<BoundingDimensions>({
    width: 84,
    height: 28,
    depth: 84,
    volumeCm3: 91.2,
    surfaceAreaCm2: 142.5,
    triangleCount: 1240,
  });

  const latestExportPositionsRef = useRef<Float32Array>(new Float32Array(0));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showTransientBanner = (type: 'success' | 'error', text: string) => {
    setStatusBanner({ type, text });
    setTimeout(() => {
      setStatusBanner((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Decode shared URL payload if opened via a public share link and verify mandatory time limit
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    const expParam = Number(params.get('exp'));
    const encodedPayload = params.get('payload');
    if (shareToken) {
      if (expParam && !evaluateShareLinkValidity(expParam).isValid) {
        setPublicShareMode(false);
        setUserSession(null);
        showTransientBanner(
          'error',
          'Dieser öffentliche Freigabelink ist abgelaufen. Bitte melden Sie sich an oder fordern Sie einen neuen Link an.'
        );
        return;
      }

      const found = projects.find((p) => p.shareToken === shareToken);
      if (found) {
        setActiveProjectId(found.id);
        setPublicShareMode(true);
      } else if (encodedPayload) {
        try {
          const decoded = JSON.parse(decodeURIComponent(atob(encodedPayload)));
          if (decoded && decoded.id) {
            if (decoded.exp && !evaluateShareLinkValidity(Number(decoded.exp)).isValid) {
              setPublicShareMode(false);
              setUserSession(null);
              showTransientBanner(
                'error',
                'Das Zeitlimit dieses Freigabelinks ist abgelaufen.'
              );
              return;
            }
            setActiveProjectId(decoded.id);
            setPublicShareMode(true);
          }
        } catch {
          // ignore malformed share payload
        }
      }
    }
  }, []);

  // Persist projects, folders & settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    } catch {
      // ignore quota limits
    }
  }, [projects]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_FOLDERS, JSON.stringify(folders));
    } catch {
      // ignore
    }
  }, [folders]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(workspaceSettings));
    } catch {
      // ignore
    }
  }, [workspaceSettings]);

  const activeProject =
    projects.find((p) => p.id === activeProjectId) || projects[0];

  const activeProjectFolder =
    folders.find((f) => f.id === (activeProject.folderId || 'folder-prototypes')) ||
    folders[0];

  const activeShareValidity = evaluateShareLinkValidity(
    activeProject.shareConfig?.expiresAtMs
  );

  const activeShareLinksCount = projects.filter(
    (p) => p.isPublicShareEnabled && evaluateShareLinkValidity(p.shareConfig?.expiresAtMs).isValid
  ).length;

  const updateActiveProject = (updater: (proj: CADModelProject) => CADModelProject) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? updater(p) : p))
    );
  };

  // Folder (Ablage) management handlers
  const handleCreateFolder = (
    name: string,
    description: string,
    colorAccent: CADFolderColor
  ) => {
    const cleanName = sanitizeUserText(name, 48);
    if (!cleanName) return;
    const newFolder: CADFolder = {
      id: `custom-folder-${Date.now()}`,
      name: cleanName,
      description: sanitizeUserText(description, 90) || 'Benutzerdefinierte Ablage',
      colorAccent,
      createdAt: new Date().toLocaleDateString('de-DE'),
    };
    setFolders((prev) => [...prev, newFolder]);
    setSelectedFolderId(newFolder.id);
    showTransientBanner('success', `Neue Ablage „${cleanName}“ angelegt.`);
  };

  const handleDeleteFolder = (folderId: string) => {
    const target = folders.find((f) => f.id === folderId);
    if (!target) return;
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setProjects((prev) =>
      prev.map((p) =>
        p.folderId === folderId ? { ...p, folderId: 'folder-prototypes' } : p
      )
    );
    if (selectedFolderId === folderId) {
      setSelectedFolderId('all');
    }
    showTransientBanner(
      'success',
      `Ablage „${target.name}“ entfernt (Modelle nach Prototypen verschoben).`
    );
  };

  const handleMoveProjectToFolder = (projectId: string, folderId: string) => {
    const targetFolder = folders.find((f) => f.id === folderId);
    const targetProject = projects.find((p) => p.id === projectId);
    setProjects((prev) => {
      const res = moveProjectToFolder(prev, projectId, folderId);
      return res.updatedProjects;
    });
    if (targetFolder && targetProject) {
      showTransientBanner(
        'success',
        `„${targetProject.name}“ in Ablage „${targetFolder.name}“ verschoben.`
      );
    }
  };

  // Handlers for SCAD & Parametric Editing
  const handleUpdateParameter = (key: string, value: number) => {
    updateActiveProject((proj) => {
      const nextParams = { ...proj.parameters, [key]: value };
      const nextCode = updateScadParameterInCode(proj.scadCode, key, value);
      return {
        ...proj,
        parameters: nextParams,
        scadCode: nextCode,
        updatedAt: 'Gerade eben',
      };
    });
  };

  const handleUpdateScadCode = (newCode: string) => {
    const cleanParams = extractScadParameters(newCode);
    updateActiveProject((proj) => ({
      ...proj,
      scadCode: newCode,
      parameters: { ...proj.parameters, ...cleanParams },
      updatedAt: 'Gerade eben',
    }));
  };

  // Material & Exploded View
  const handleChangeFinish = (finish: MaterialFinish) => {
    updateActiveProject((proj) => ({ ...proj, finish }));
  };

  const handleChangeExploded = (explodedFactor: number) => {
    setIsAutoExploding(false);
    updateActiveProject((proj) => ({ ...proj, explodedFactor }));
  };

  const handleToggleSideBySideExploded = () => {
    setSideBySideExploded((prev) => {
      const next = !prev;
      if (next && activeProject.explodedFactor < 0.05) {
        updateActiveProject((proj) => ({ ...proj, explodedFactor: 0.85 }));
      } else if (!next && activeProject.explodedFactor === 0.85) {
        updateActiveProject((proj) => ({ ...proj, explodedFactor: 0 }));
      }
      return next;
    });
  };

  // Spatial 3D Annotations
  const handleAddSpatialComment = (
    position: Vector3Tuple,
    normal: Vector3Tuple,
    text: string
  ) => {
    const cleanText = sanitizeUserText(text, 280);
    if (!cleanText) return;
    const newComment: SpatialComment = {
      id: `cmt-${Date.now()}`,
      authorName: userSession?.name || 'Externer Prüfer (Gast)',
      authorRole: userSession?.role || 'Public Review Link',
      createdAt: 'Gerade eben',
      text: cleanText,
      position,
      normal,
      resolved: false,
      versionNumber: activeProject.currentVersion,
    };
    updateActiveProject((proj) => ({
      ...proj,
      comments: [...proj.comments, newComment],
    }));
    setSelectedCommentId(newComment.id);
    setToolMode('orbit');
    showTransientBanner(
      'success',
      `3D-Pin #${activeProject.comments.length + 1} am Bauteil verankert.`
    );
  };

  // Quick comment from Model Overview modal
  const handleQuickCommentFromOverview = (projectId: string, text: string) => {
    const cleanText = sanitizeUserText(text, 280);
    if (!cleanText) return;
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== projectId) return proj;
        const newComment: SpatialComment = {
          id: `cmt-${Date.now()}`,
          authorName: userSession?.name || 'Dr. Lukas Weber',
          authorRole: userSession?.role || 'Lead CAD Architect',
          createdAt: 'Gerade eben',
          text: cleanText,
          position: { x: 14, y: 12, z: 10 },
          normal: { x: 0, y: 1, z: 0 },
          resolved: false,
          versionNumber: proj.currentVersion,
        };
        return {
          ...proj,
          updatedAt: 'Gerade eben',
          comments: [...proj.comments, newComment],
        };
      })
    );
    showTransientBanner('success', 'Kommentar in der Bauteil-Akte und am 3D-Modell gespeichert.');
  };

  const handleToggleResolveComment = (commentId: string) => {
    soundEngine.playClick();
    updateActiveProject((proj) => ({
      ...proj,
      comments: proj.comments.map((c) =>
        c.id === commentId ? { ...c, resolved: !c.resolved } : c
      ),
    }));
  };

  const handleDeleteComment = (commentId: string) => {
    soundEngine.playClick();
    updateActiveProject((proj) => ({
      ...proj,
      comments: proj.comments.filter((c) => c.id !== commentId),
    }));
    if (selectedCommentId === commentId) setSelectedCommentId(null);
  };

  // Point-to-Point Metrology
  const handleCompleteMeasurement = (pointA: Vector3Tuple, pointB: Vector3Tuple) => {
    const metrics = calculatePointToPointMetrics(pointA, pointB);
    const record: MeasurementRecord = {
      id: `meas-${Date.now()}`,
      label: `Messung #${activeProject.measurements.length + 1}`,
      pointA,
      pointB,
      ...metrics,
    };
    updateActiveProject((proj) => ({
      ...proj,
      measurements: [...proj.measurements, record],
    }));
    showTransientBanner(
      'success',
      `Punkt-zu-Punkt Distanz gemessen: ${metrics.distanceMm.toFixed(2)} mm`
    );
  };

  const handleAddManualCoordinateMeasure = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number
  ) => {
    handleCompleteMeasurement({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz });
  };

  const handleClearMeasurements = () => {
    soundEngine.playClick();
    updateActiveProject((proj) => ({ ...proj, measurements: [] }));
  };

  // Versioning
  const handleSaveVersionSnapshot = (changelog: string) => {
    const cleanLog = sanitizeUserText(changelog, 180);
    if (!cleanLog) return;
    updateActiveProject((proj) => {
      const nextVerNum = proj.versions.length + 1;
      const newVer = {
        versionNumber: nextVerNum,
        createdAt: new Date().toLocaleTimeString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        author: userSession?.name || 'CAD Ingenieur',
        changelog: cleanLog,
        scadCode: proj.scadCode,
        parameters: { ...proj.parameters },
        finish: proj.finish,
      };
      return {
        ...proj,
        currentVersion: nextVerNum,
        versions: [...proj.versions, newVer],
        updatedAt: 'Gerade eben',
      };
    });
    showTransientBanner('success', `Revision v${activeProject.versions.length + 1}.0 gespeichert.`);
  };

  const handleRestoreVersion = (versionNumber: number) => {
    const target = activeProject.versions.find((v) => v.versionNumber === versionNumber);
    if (!target) return;
    updateActiveProject((proj) => ({
      ...proj,
      currentVersion: target.versionNumber,
      parameters: { ...target.parameters },
      finish: target.finish,
      scadCode: target.scadCode || proj.scadCode,
    }));
    showTransientBanner('success', `Modellstand v${versionNumber}.0 wiederhergestellt.`);
  };

  // Update Share Configuration (always with mandatory time limit)
  const handleUpdateShareConfig = (
    nextConfig: ShareLinkConfig,
    regenerateToken: boolean = false
  ) => {
    updateActiveProject((proj) => ({
      ...proj,
      shareToken: regenerateToken
        ? `${proj.id.replace('proj-', '')}-${Date.now().toString(36)}`
        : proj.shareToken,
      shareConfig: nextConfig,
    }));
    if (regenerateToken) {
      showTransientBanner(
        'success',
        `Neuer Freigabelink mit ${nextConfig.durationPreset} Zeitlimit generiert.`
      );
    }
  };

  // Quick update of any project's mandatory share link duration from the Overview
  const handleQuickUpdateProjectShareDuration = (
    projectId: string,
    preset: ShareDurationPreset
  ) => {
    setProjects((prev) =>
      prev.map((proj) => {
        if (proj.id !== projectId) return proj;
        const baseCfg = proj.shareConfig || DEFAULT_SHARE_CONFIG;
        return {
          ...proj,
          isPublicShareEnabled: true,
          shareConfig: {
            ...baseCfg,
            durationPreset: preset,
            expiresAtMs: computeShareExpiryTimestamp(preset),
          },
        };
      })
    );
    showTransientBanner('success', `Freigabelink-Zeitlimit auf ${preset} aktualisiert.`);
  };

  const handleQuickCopyActiveShareLink = () => {
    const cfg = activeProject.shareConfig || {
      ...DEFAULT_SHARE_CONFIG,
      durationPreset: workspaceSettings.defaultShareDuration,
      expiresAtMs: computeShareExpiryTimestamp(workspaceSettings.defaultShareDuration),
    };
    const url = encodeShareUrl({ ...activeProject, shareConfig: cfg });
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    soundEngine.playSuccessChime();
    setQuickLinkCopied(true);
    setTimeout(() => setQuickLinkCopied(false), 2200);
    showTransientBanner(
      'success',
      `Zeitlimitierter Shared Link (${cfg.durationPreset}) in die Zwischenablage kopiert.`
    );
  };

  // Multi-Format CAD Upload with Zero-Trust Security Scanner
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const textPreview = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, Math.min(bytes.length, 32768))
    );

    const scanReport = validateCADUpload(file.name, bytes, textPreview);
    setLatestSecurityReport(scanReport);
    setActiveDrawerTab('security');

    if (!scanReport.passed || scanReport.detectedFormat === 'unknown') {
      soundEngine.playSecurityAlert();
      showTransientBanner('error', scanReport.threatSummary);
      e.target.value = '';
      return;
    }

    soundEngine.playSuccessChime();
    const fmt = scanReport.detectedFormat;
    const fullText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    let stlBase64: string | undefined;
    if (fmt === 'stl') {
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      stlBase64 = btoa(binary);
    }

    const extractedParams =
      fmt === 'scad' ? extractScadParameters(fullText) : { scale_factor: 100 };

    const targetFolderId =
      selectedFolderId !== 'all' ? selectedFolderId : 'folder-prototypes';

    const newProj: CADModelProject = {
      id: `proj-${Date.now()}`,
      folderId: targetFolderId,
      name: sanitizeUserText(file.name.replace(/\.[^.]+$/, ''), 60),
      category: `Upload · ${fmt.toUpperCase()} Verifiziert`,
      format: fmt,
      updatedAt: 'Gerade eben',
      author: userSession?.name || 'CAD Ingenieur',
      shareToken: `share-${Date.now().toString(36)}`,
      isPublicShareEnabled: true,
      shareConfig: {
        durationPreset: workspaceSettings.defaultShareDuration,
        expiresAtMs: computeShareExpiryTimestamp(workspaceSettings.defaultShareDuration),
        allowGuestComments: true,
        allowGuestMeasurements: true,
        allowGuestDownload: false,
      },
      currentVersion: 1,
      scadCode:
        fmt === 'scad'
          ? fullText
          : `// Automatisch generierter Parametrik-Wrapper für ${file.name}\ncube([40, 40, 20]);`,
      stlBufferBase64: stlBase64,
      stepSourceText: fmt === 'step' ? fullText : undefined,
      parameters: Object.keys(extractedParams).length > 0 ? extractedParams : { wall_mm: 10 },
      finish: workspaceSettings.defaultMaterialFinish,
      explodedFactor: 0,
      versions: [
        {
          versionNumber: 1,
          createdAt: 'Gerade eben',
          author: userSession?.name || 'CAD Ingenieur',
          changelog: `Sicherheitsgeprüfter ${fmt.toUpperCase()} Original-Import (${file.size} Bytes)`,
          parameters: Object.keys(extractedParams).length > 0 ? extractedParams : { wall_mm: 10 },
          finish: workspaceSettings.defaultMaterialFinish,
        },
      ],
      comments: [],
      measurements: [],
      lastSecurityReport: scanReport,
    };

    setProjects((prev) => [newProj, ...prev]);
    setActiveProjectId(newProj.id);
    showTransientBanner('success', `${file.name} erfolgreich verifiziert und in 3D geladen.`);
    e.target.value = '';
  };

  // Compile & save newly authored/pasted OpenSCAD model
  const handleSaveAndRenderScadProject = (newProject: CADModelProject) => {
    setProjects((prev) => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setIsScadEditorOpen(false);
    setIsModelsOverviewOpen(false);
    setIsMobileMenuOpen(false);
    setSelectedCommentId(null);
    soundEngine.playSuccessChime();
    showTransientBanner(
      'success',
      `OpenSCAD Modell „${newProject.name}“ erfolgreich kompiliert & in 3D gerendert.`
    );
  };

  // Simulated malicious file test for the Security Sandbox
  const handleSimulateMaliciousTest = () => {
    const fakeExePayload = new Uint8Array([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
      ...new TextEncoder().encode('<script>eval("window.location=\'http://malicious.tld\'")</script>'),
    ]);
    const report = validateCADUpload('exploit_payload.stl', fakeExePayload);
    setLatestSecurityReport(report);
    showTransientBanner('error', report.threatSummary);
  };

  // Export current 3D model to STL, STEP, OBJ, or SCAD
  const handleExportFormat = (fmt: 'stl' | 'obj' | 'step' | 'scad') => {
    let content = '';
    let mime = 'text/plain;charset=utf-8';
    const safeName = activeProject.name.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (fmt === 'stl') {
      content = exportPositionsToAsciiSTL(latestExportPositionsRef.current, safeName);
      mime = 'model/stl';
    } else if (fmt === 'obj') {
      content = exportPositionsToOBJ(latestExportPositionsRef.current, safeName);
    } else if (fmt === 'step') {
      content = exportMetadataToSTEP(
        safeName,
        computedDimensions,
        userSession?.name || activeProject.author
      );
    } else {
      content = activeProject.scadCode;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_v${activeProject.currentVersion}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showTransientBanner(
      'success',
      `Export abgeschlossen: ${safeName}_v${activeProject.currentVersion}.${fmt}`
    );
  };

  const isLockedOut = !userSession && !publicShareMode;

  // Format dimensions according to unitSystem ('mm' vs 'inch')
  const formatUnitDims = (dims: BoundingDimensions): string => {
    if (workspaceSettings.unitSystem === 'inch') {
      const wIn = (dims.width / 25.4).toFixed(2);
      const hIn = (dims.height / 25.4).toFixed(2);
      const dIn = (dims.depth / 25.4).toFixed(2);
      return `${wIn} × ${hIn} × ${dIn} in`;
    }
    return `${dims.width} × ${dims.height} × ${dims.depth} mm`;
  };

  const currentStudioTheme: StudioTheme = workspaceSettings.studioTheme || 'vision_spatial';

  return (
    <div className="relative w-screen h-[100dvh] min-h-[100dvh] overflow-hidden bg-slate-100 text-slate-900 flex flex-col">
      {/* Hidden File Upload Input for .scad, .stl, .step, .stp */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".scad,.stl,.step,.stp"
        onChange={handleFileUpload}
        className="hidden"
        aria-label="CAD-Datei hochladen (.scad, .stl, .step)"
      />

      {/* STRICT 3-ZONE APPLE DAYLIGHT GLASS TOP BAR CONTRACT WITH MOBILE MENU SUPPORT */}
      <header className="relative z-50 flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-2.5 sm:py-3.5 apple-glass-header">
        {/* Zone 1: Single text element wordmark + mobile hamburger */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label={isMobileMenuOpen ? 'Menü schließen' : 'Hauptmenü öffnen'}
            data-testid="mobile-menu-toggle-btn"
            onClick={() => {
              soundEngine.playClick();
              setIsMobileMenuOpen((prev) => !prev);
            }}
            className="md:hidden p-1.5 rounded-xl apple-glass-btn text-slate-700 hover:text-slate-950 cursor-pointer"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5 text-sky-600" /> : <Menu className="w-5 h-5" />}
          </button>

          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
              setIsModelsOverviewOpen(false);
              setIsSettingsModalOpen(false);
              setIsShareModalOpen(false);
              setIsScadEditorOpen(false);
              setIsMobileMenuOpen(false);
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 font-display whitespace-nowrap shrink-0"
          >
            AetherCAD Studio
          </a>
        </div>

        {/* Zone 2: Clean Application-Level Navigation Links (4 uniform links, zero bordered buttons inside nav) */}
        <nav
          aria-label="Hauptnavigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <a
            href="#models-overview"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
              setIsSettingsModalOpen(false);
              setIsShareModalOpen(false);
              setIsScadEditorOpen(false);
              setIsModelsOverviewOpen((prev) => !prev);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isModelsOverviewOpen
                ? 'text-sky-600 font-semibold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-950'
            }`}
          >
            Modelle &amp; Ablagen ({projects.length})
          </a>

          <a
            href="#scad-editor"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
              setIsModelsOverviewOpen(false);
              setIsSettingsModalOpen(false);
              setIsShareModalOpen(false);
              setIsScadEditorOpen(true);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isScadEditorOpen
                ? 'text-sky-600 font-semibold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-950'
            }`}
          >
            SCAD-Editor
          </a>

          <a
            href="#shared-links-hub"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
              setIsModelsOverviewOpen(false);
              setIsSettingsModalOpen(false);
              setIsScadEditorOpen(false);
              setIsShareModalOpen((prev) => !prev);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isShareModalOpen
                ? 'text-sky-600 font-semibold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-950'
            }`}
          >
            Freigaben ({activeShareLinksCount})
          </a>

          <a
            href="#workspace-settings"
            onClick={(e) => {
              e.preventDefault();
              soundEngine.playClick();
              setIsModelsOverviewOpen(false);
              setIsShareModalOpen(false);
              setIsScadEditorOpen(false);
              setIsSettingsModalOpen((prev) => !prev);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              isSettingsModalOpen
                ? 'text-sky-600 font-semibold underline underline-offset-8 decoration-2'
                : 'hover:text-slate-950'
            }`}
          >
            Einstellungen
          </a>
        </nav>

        {/* Zone 3: Actions for Desktop & Mobile */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setIsScadEditorOpen(true);
            }}
            data-testid="header-open-scad-btn"
            className="md:hidden flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl apple-glass-btn text-sky-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Code2 className="w-3.5 h-3.5 text-sky-600" />
            <span>+ SCAD</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              setIsModelsOverviewOpen(false);
              setIsSettingsModalOpen(false);
              setIsScadEditorOpen(false);
              setIsShareModalOpen((prev) => !prev);
            }}
            className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs font-bold rounded-xl apple-glass-cta whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span className="hidden sm:inline">Freigabelink teilen</span>
            <span className="sm:hidden">Teilen</span>
          </button>
        </div>
      </header>

      {/* MOBILE SLIDE-DOWN NAVIGATION DRAWER (iPhone / Touch devices) */}
      {isMobileMenuOpen && (
        <div
          role="navigation"
          aria-label="Mobiles Navigationsmenü"
          className="md:hidden fixed top-[54px] inset-x-0 z-40 bg-white/95 backdrop-blur-xl border-b border-slate-200/90 p-4 shadow-2xl space-y-2 animate-in slide-in-from-top-2"
        >
          <div className="grid grid-cols-1 gap-1.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsMobileMenuOpen(false);
                setIsModelsOverviewOpen(true);
              }}
              className="flex items-center justify-between p-3 rounded-2xl apple-glass-card text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <FolderKanban className="w-4 h-4 text-sky-600" />
                <span>Modell-Übersicht &amp; Ablagen</span>
              </div>
              <span className="font-mono text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full font-bold">
                {projects.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsMobileMenuOpen(false);
                setIsScadEditorOpen(true);
              }}
              className="flex items-center justify-between p-3 rounded-2xl bg-sky-500 text-white font-bold shadow-md text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Code2 className="w-4 h-4" />
                <span>+ SCAD Code einfügen &amp; berechnen</span>
              </div>
              <span className="font-mono text-[10px] opacity-90">.SCAD</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsMobileMenuOpen(false);
                setIsModelsOverviewOpen(false);
                setIsSettingsModalOpen(false);
                setIsShareModalOpen(false);
              }}
              className="flex items-center gap-2.5 p-3 rounded-2xl apple-glass-card text-left text-slate-800 cursor-pointer"
            >
              <RotateCw className="w-4 h-4 text-slate-600" />
              <span>3D-Arbeitsbereich</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsMobileMenuOpen(false);
                setIsShareModalOpen(true);
              }}
              className="flex items-center justify-between p-3 rounded-2xl apple-glass-card text-left text-slate-800 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Link2 className="w-4 h-4 text-sky-600" />
                <span>Shared-Links Hub (Zeitlimits)</span>
              </div>
              <span className="font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full font-bold">
                {activeShareLinksCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setIsMobileMenuOpen(false);
                setIsSettingsModalOpen(true);
              }}
              className="flex items-center gap-2.5 p-3 rounded-2xl apple-glass-card text-left text-slate-800 cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4 text-slate-600" />
              <span>Einstellungen &amp; Studio-Theme</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Spatial 3D Stage */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        {/* Decluttered Top-Left Daylight Apple-Glass Active Model Card */}
        <div className="pointer-events-none absolute top-2.5 sm:top-4 left-2.5 sm:left-6 right-2.5 sm:right-auto z-20 w-auto sm:w-[min(368px,90vw)] space-y-2">
          <div className="pointer-events-auto rounded-2xl sm:rounded-3xl apple-glass-panel p-3 sm:p-4 transition-all">
            {/* Active Model Header with Current Ablage & Format */}
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 whitespace-nowrap overflow-hidden">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700 truncate max-w-[130px]">
                    <Folder className="w-3 h-3 text-sky-600 shrink-0" />
                    <span className="truncate">{activeProjectFolder?.name.split(' ')[0]}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono font-bold text-sky-600 uppercase">
                    {activeProject.format}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>v{activeProject.currentVersion}.0</span>
                </div>
                <h1 className="mt-0.5 text-sm sm:text-base font-bold text-slate-900 font-display tracking-tight leading-snug truncate">
                  {activeProject.name}
                </h1>

                {/* Glanceable Live Physical Spec Strip (click to open full Physics & Inertia drawer) */}
                <button
                  type="button"
                  data-testid="card-physics-summary-btn"
                  onClick={() => {
                    soundEngine.playClick();
                    setActiveDrawerTab(activeDrawerTab === 'metrology' ? 'none' : 'metrology');
                  }}
                  title="Klicken für Schwerpunkt, Masse & Trägheitstensor"
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-sky-700 transition-colors cursor-pointer whitespace-nowrap overflow-hidden"
                >
                  <Scale className="w-3 h-3 text-sky-600 shrink-0" />
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {computedDimensions.physical
                      ? formatMassDisplay(computedDimensions.physical.massGrams)
                      : '—'}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="truncate">
                    {(MATERIAL_SPECS[activeProject.finish] || MATERIAL_SPECS.titanium).shortName}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono text-slate-500 tabular-nums">
                    {formatUnitDims(computedDimensions)}
                  </span>
                </button>
              </div>

              <button
                type="button"
                aria-label={isLeftRailExpanded ? 'Bauteil-Infos einklappen' : 'Bauteil-Infos ausklappen'}
                onClick={() => {
                  soundEngine.playClick();
                  setIsLeftRailExpanded((prev) => !prev);
                }}
                className="p-1.5 rounded-xl apple-glass-btn text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
              >
                {isLeftRailExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            </div>

            {isLeftRailExpanded && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 space-y-2.5">
                {/* Clean Single-Row Shared-Link & Time-Limit Status */}
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-2xl apple-glass-subcard text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Clock className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                    <span className="text-slate-600 shrink-0">Link:</span>
                    <span
                      className={`font-mono font-bold whitespace-nowrap ${
                        activeProject.isPublicShareEnabled && activeShareValidity.isValid
                          ? 'text-emerald-700'
                          : 'text-rose-600'
                      }`}
                    >
                      {activeProject.isPublicShareEnabled
                        ? activeShareValidity.remainingLabel
                        : 'Gesperrt'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={handleQuickCopyActiveShareLink}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg apple-glass-btn text-[11px] font-semibold text-sky-700 hover:text-slate-950 cursor-pointer"
                    >
                      {quickLinkCopied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span>Kopiert</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Kopieren</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      aria-label="Freigabelink-Zeitlimit konfigurieren"
                      onClick={() => {
                        soundEngine.playClick();
                        setIsShareModalOpen(true);
                      }}
                      className="p-1 rounded-lg apple-glass-btn text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Streamlined Quick Action Row (No duplicates with Bottom Dock) */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setIsModelsOverviewOpen(true);
                    }}
                    className="flex items-center gap-1 font-semibold text-sky-700 hover:text-slate-950 cursor-pointer"
                  >
                    <FolderKanban className="w-3.5 h-3.5" />
                    <span>Modelle ({projects.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setIsScadEditorOpen(true);
                    }}
                    className="flex items-center gap-1 font-semibold text-sky-700 hover:text-slate-950 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>+ SCAD</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      fileInputRef.current?.click();
                    }}
                    className="flex items-center gap-1 hover:text-slate-950 font-medium cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import</span>
                  </button>

                  {publicShareMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        setPublicShareMode(false);
                      }}
                      className="flex items-center gap-1 text-emerald-700 hover:text-emerald-800 font-medium cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Gast</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        setUserSession(null);
                      }}
                      className="flex items-center gap-1 text-slate-500 hover:text-rose-600 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Sperren</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Transient Notification Toast */}
          {statusBanner && (
            <div
              role="status"
              className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl apple-glass-panel text-xs font-medium ${
                statusBanner.type === 'error'
                  ? 'border-rose-300 text-rose-700'
                  : 'border-emerald-300 text-emerald-800'
              }`}
            >
              {statusBanner.type === 'error' ? (
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
              <span>{statusBanner.text}</span>
            </div>
          )}
        </div>

        {/* Top-Right Floating Daylight Studio Atmosphere & Turntable Control */}
        <div className="pointer-events-auto absolute top-4 right-6 z-20 hidden lg:flex items-center gap-1 p-1.5 rounded-2xl apple-glass-panel text-xs">
          <div className="flex items-center gap-1 px-2 text-slate-500">
            <Sun className="w-3.5 h-3.5 text-sky-600" />
            <span className="font-semibold text-[11px]">Licht</span>
          </div>

          {(
            [
              { id: 'vision_spatial', label: 'Daylight' },
              { id: 'titanium_dark', label: 'Silver' },
              { id: 'blueprint_cryo', label: 'Blueprint' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                soundEngine.playClick();
                setWorkspaceSettings((prev) => ({ ...prev, studioTheme: t.id }));
              }}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
                currentStudioTheme === t.id
                  ? 'apple-glass-cta font-bold'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="w-px h-4 bg-slate-200 mx-0.5" />

          <button
            type="button"
            title="Automatische 360°-Drehung"
            onClick={() => {
              soundEngine.playClick();
              setWorkspaceSettings((prev) => ({
                ...prev,
                autoTurntable: !prev.autoTurntable,
              }));
            }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
              workspaceSettings.autoTurntable
                ? 'bg-amber-500 text-white font-bold shadow-sm'
                : 'apple-glass-btn text-slate-700 hover:text-slate-950'
            }`}
          >
            <RotateCw className="w-3 h-3" />
            <span>360°</span>
          </button>
        </div>

        {/* Central 100% Unobstructed Interactive Three.js Viewport */}
        <CADViewport
          project={activeProject}
          toolMode={toolMode}
          showDimensions={showDimensions}
          showCenterOfMass={showCenterOfMass}
          showGridFloor={workspaceSettings.showGridFloor}
          studioTheme={currentStudioTheme}
          autoTurntable={Boolean(workspaceSettings.autoTurntable)}
          wireframe={wireframe}
          sideBySideExploded={sideBySideExploded}
          isAutoExploding={isAutoExploding}
          cameraPreset={cameraPreset}
          cameraPresetTrigger={cameraPresetTrigger}
          selectedCommentId={selectedCommentId}
          onSelectComment={setSelectedCommentId}
          onAddSpatialComment={handleAddSpatialComment}
          onCompleteMeasurement={handleCompleteMeasurement}
          onMetricsComputed={(dims, exportPositions) => {
            setComputedDimensions(dims);
            latestExportPositionsRef.current = exportPositions;
          }}
        />

        {/* Unified Collapsible Apple-Glass Bottom Dock */}
        <BottomGlassDock
          project={activeProject}
          isPublicReadonly={publicShareMode && !userSession}
          activeTab={activeDrawerTab}
          onSelectTab={setActiveDrawerTab}
          toolMode={toolMode}
          onChangeToolMode={setToolMode}
          showDimensions={showDimensions}
          onToggleDimensions={() => setShowDimensions((prev) => !prev)}
          showCenterOfMass={showCenterOfMass}
          onToggleCenterOfMass={() => setShowCenterOfMass((prev) => !prev)}
          unitSystem={workspaceSettings.unitSystem}
          wireframe={wireframe}
          onToggleWireframe={() => setWireframe((prev) => !prev)}
          sideBySideExploded={sideBySideExploded}
          onToggleSideBySideExploded={handleToggleSideBySideExploded}
          isAutoExploding={isAutoExploding}
          onToggleAutoExploding={() => setIsAutoExploding((prev) => !prev)}
          onSelectCameraPreset={(preset) => {
            setCameraPreset(preset);
            setCameraPresetTrigger((c) => c + 1);
          }}
          onChangeFinish={handleChangeFinish}
          onChangeExploded={handleChangeExploded}
          onUpdateParameter={handleUpdateParameter}
          onUpdateScadCode={handleUpdateScadCode}
          onSaveVersionSnapshot={handleSaveVersionSnapshot}
          onRestoreVersion={handleRestoreVersion}
          onToggleResolveComment={handleToggleResolveComment}
          onDeleteComment={handleDeleteComment}
          onSelectComment={setSelectedCommentId}
          selectedCommentId={selectedCommentId}
          onClearMeasurements={handleClearMeasurements}
          onAddManualCoordinateMeasure={handleAddManualCoordinateMeasure}
          dimensions={computedDimensions}
          onExportFormat={handleExportFormat}
          soundEnabled={soundEnabled}
          onToggleSound={() => {
            const next = !soundEnabled;
            soundEngine.enabled = next;
            setSoundEnabled(next);
            setWorkspaceSettings((prev) => ({ ...prev, soundEffectsEnabled: next }));
            if (next) soundEngine.playClick();
          }}
          onSimulateMaliciousTest={handleSimulateMaliciousTest}
          latestSecurityReport={latestSecurityReport}
          onOpenScadEditor={() => setIsScadEditorOpen(true)}
        />
      </main>

      {/* Spatial Models Overview & Structured Ablagen Dashboard */}
      {isModelsOverviewOpen && (
        <ModelsOverviewModal
          projects={projects}
          folders={folders}
          activeProjectId={activeProject.id}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onMoveProjectToFolder={handleMoveProjectToFolder}
          userSession={userSession}
          onClose={() => setIsModelsOverviewOpen(false)}
          onSelectProject={(projectId) => {
            const target = projects.find((p) => p.id === projectId);
            setActiveProjectId(projectId);
            setSelectedCommentId(null);
            if (target) {
              showTransientBanner('success', `Bauteil „${target.name}“ im 3D-Viewer geladen.`);
            }
          }}
          onOpenProjectForCommenting={(projectId) => {
            setActiveProjectId(projectId);
            setIsModelsOverviewOpen(false);
            setToolMode('annotate');
            setActiveDrawerTab('comments');
            showTransientBanner(
              'success',
              '3D-Kommentarmodus aktiviert: Klicken Sie auf eine Bauteilfläche oder nutzen Sie das Kommentarfeld.'
            );
          }}
          onOpenShareModalForProject={(projectId) => {
            setActiveProjectId(projectId);
            setIsModelsOverviewOpen(false);
            setIsShareModalOpen(true);
          }}
          onQuickUpdateProjectShareDuration={handleQuickUpdateProjectShareDuration}
          onQuickCommentSubmit={handleQuickCommentFromOverview}
          onTriggerFileUpload={() => fileInputRef.current?.click()}
          onOpenScadEditor={() => setIsScadEditorOpen(true)}
        />
      )}

      {/* Dedicated OpenSCAD Code Textfenster / Editor Modal */}
      {isScadEditorOpen && (
        <ScadCodeEditorModal
          folders={folders}
          selectedFolderId={selectedFolderId}
          defaultAuthor={userSession?.name || 'CAD Ingenieur'}
          onClose={() => setIsScadEditorOpen(false)}
          onSaveAndRenderNewModel={handleSaveAndRenderScadProject}
        />
      )}

      {/* Apple-Glass Control Center & Settings Modal (Einstellungsmenü) */}
      {isSettingsModalOpen && (
        <SettingsModal
          settings={workspaceSettings}
          userSession={userSession}
          onUpdateSettings={(next) => {
            setWorkspaceSettings(next);
            setSoundEnabled(next.soundEffectsEnabled);
          }}
          onUpdateUserSession={(nextSession) => {
            setUserSession(nextSession);
            try {
              localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(nextSession));
            } catch {
              // ignore
            }
          }}
          onResetWorkspaceData={() => {
            localStorage.removeItem(STORAGE_KEY_PROJECTS);
            localStorage.removeItem(STORAGE_KEY_FOLDERS);
            setFolders(INITIAL_CAD_FOLDERS);
            setProjects(INITIAL_CAD_PROJECTS);
            setActiveProjectId(INITIAL_CAD_PROJECTS[0].id);
            setSelectedFolderId('all');
            setIsSettingsModalOpen(false);
            showTransientBanner(
              'success',
              'Alle CAD-Modelle, Ablagen und Freigabelink-Zeitlimits auf Werkseinstellung zurückgesetzt.'
            );
          }}
          onClose={() => setIsSettingsModalOpen(false)}
        />
      )}

      {/* Time-Limited Public Share Link Hub Modal */}
      {isShareModalOpen && (
        <ShareLinkModal
          project={activeProject}
          allProjects={projects}
          defaultDurationPreset={workspaceSettings.defaultShareDuration}
          onClose={() => setIsShareModalOpen(false)}
          onSelectProject={(projectId) => setActiveProjectId(projectId)}
          onTogglePublicAccess={(enabled) =>
            updateActiveProject((proj) => ({
              ...proj,
              isPublicShareEnabled: enabled,
              shareConfig: proj.shareConfig || {
                ...DEFAULT_SHARE_CONFIG,
                durationPreset: workspaceSettings.defaultShareDuration,
                expiresAtMs: computeShareExpiryTimestamp(workspaceSettings.defaultShareDuration),
              },
            }))
          }
          onUpdateShareConfig={handleUpdateShareConfig}
          onEnterPublicPreview={() => {
            setIsShareModalOpen(false);
            setUserSession(null);
            setPublicShareMode(true);
            showTransientBanner(
              'success',
              `Zeitlimitierter Gast-Link (${activeShareValidity.remainingLabel}) aktiviert: Zugriff ohne Login freigegeben.`
            );
          }}
        />
      )}

      {/* Login Gate Overlay when Workspace is Locked and no valid Public Share Token is active */}
      {isLockedOut && (
        <AuthGateModal
          onAuthenticate={(session) => {
            setUserSession(session);
            try {
              localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
            } catch {
              // ignore
            }
          }}
          onOpenPublicSharedSample={() => {
            if (!activeShareValidity.isValid) {
              showTransientBanner(
                'error',
                'Das Zeitlimit des öffentlichen Freigabelinks ist abgelaufen. Bitte melden Sie sich an.'
              );
              return;
            }
            setPublicShareMode(true);
            showTransientBanner(
              'success',
              `Zeitlimitierter Freigabelink geöffnet (${activeShareValidity.remainingLabel}) — Zugriff ohne Login aktiv.`
            );
          }}
        />
      )}
    </div>
  );
}
