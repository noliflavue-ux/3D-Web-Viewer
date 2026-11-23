import React, { useState } from 'react';
import {
  BoundingDimensions,
  CADModelProject,
  CameraPreset,
  MaterialFinish,
  SecurityScanReport,
  ToolMode,
} from '../types/cad';
import { soundEngine } from '../utils/soundEngine';
import {
  MATERIAL_FINISH_LIST,
  MATERIAL_SPECS,
  formatMassDisplay,
  formatTensorValue,
} from '../utils/physicalProperties';
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Ruler,
  MessageSquare,
  History,
  ShieldCheck,
  Download,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Plus,
  Volume2,
  VolumeX,
  Sliders,
  Box,
  Columns2,
  Play,
  Pause,
  Crosshair,
  Scale,
  X,
} from 'lucide-react';

export type ActiveDrawerTab = 'none' | 'scad' | 'metrology' | 'comments' | 'versions' | 'security';

interface BottomGlassDockProps {
  project: CADModelProject;
  isPublicReadonly: boolean;
  activeTab: ActiveDrawerTab;
  onSelectTab: (tab: ActiveDrawerTab) => void;
  toolMode: ToolMode;
  onChangeToolMode: (mode: ToolMode) => void;
  showDimensions: boolean;
  onToggleDimensions: () => void;
  showCenterOfMass: boolean;
  onToggleCenterOfMass: () => void;
  unitSystem?: 'mm' | 'inch';
  wireframe: boolean;
  onToggleWireframe: () => void;
  sideBySideExploded: boolean;
  onToggleSideBySideExploded: () => void;
  isAutoExploding: boolean;
  onToggleAutoExploding: () => void;
  onSelectCameraPreset: (preset: CameraPreset) => void;
  onChangeFinish: (finish: MaterialFinish) => void;
  onChangeExploded: (factor: number) => void;
  onUpdateParameter: (key: string, value: number) => void;
  onUpdateScadCode: (code: string) => void;
  onSaveVersionSnapshot: (changelog: string) => void;
  onRestoreVersion: (versionNumber: number) => void;
  onToggleResolveComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onSelectComment: (commentId: string | null) => void;
  selectedCommentId: string | null;
  onClearMeasurements: () => void;
  onAddManualCoordinateMeasure: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void;
  dimensions: BoundingDimensions;
  onExportFormat: (fmt: 'stl' | 'obj' | 'step' | 'scad') => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onSimulateMaliciousTest: () => void;
  latestSecurityReport?: SecurityScanReport;
  onOpenScadEditor?: () => void;
}

export const BottomGlassDock: React.FC<BottomGlassDockProps> = ({
  project,
  isPublicReadonly,
  activeTab,
  onSelectTab,
  toolMode,
  onChangeToolMode,
  showDimensions,
  onToggleDimensions,
  showCenterOfMass,
  onToggleCenterOfMass,
  unitSystem = 'mm',
  wireframe,
  onToggleWireframe,
  sideBySideExploded,
  onToggleSideBySideExploded,
  isAutoExploding,
  onToggleAutoExploding,
  onSelectCameraPreset,
  onChangeFinish,
  onChangeExploded,
  onUpdateParameter,
  onUpdateScadCode,
  onSaveVersionSnapshot,
  onRestoreVersion,
  onToggleResolveComment,
  onDeleteComment,
  onSelectComment,
  selectedCommentId,
  onClearMeasurements,
  onAddManualCoordinateMeasure,
  dimensions,
  onExportFormat,
  soundEnabled,
  onToggleSound,
  onSimulateMaliciousTest,
  latestSecurityReport,
  onOpenScadEditor,
}) => {
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [changelogDraft, setChangelogDraft] = useState('');
  const [manualPtA, setManualPtA] = useState({ x: -20, y: 0, z: 0 });
  const [manualPtB, setManualPtB] = useState({ x: 20, y: 15, z: 0 });

  const report = latestSecurityReport || project.lastSecurityReport;
  const activeMaterial = MATERIAL_SPECS[project.finish] || MATERIAL_SPECS.titanium;
  const physical = dimensions.physical;
  const lengthUnit = unitSystem === 'inch' ? 'in' : 'mm';
  const formatLen = (mm: number) =>
    unitSystem === 'inch' ? (mm / 25.4).toFixed(2) : mm.toFixed(1);

  const handleSaveRevision = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changelogDraft.trim()) return;
    onSaveVersionSnapshot(changelogDraft.trim());
    setChangelogDraft('');
    soundEngine.playSuccessChime();
  };

  const handleManualMeasureSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddManualCoordinateMeasure(
      manualPtA.x,
      manualPtA.y,
      manualPtA.z,
      manualPtB.x,
      manualPtB.y,
      manualPtB.z
    );
    soundEngine.playMeasureSnap();
  };

  return (
    <div
      className={`fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30 w-[min(1220px,calc(100vw-0.75rem))] px-0.5 sm:px-0 transition-transform duration-200 ${
        isDockCollapsed ? 'translate-y-[calc(100%-34px)]' : 'translate-y-0'
      }`}
    >
      {/* Collapse / Expand Zen Mode Handle */}
      <div className="flex justify-center mb-1.5">
        <button
          type="button"
          onClick={() => {
            soundEngine.playClick();
            setIsDockCollapsed((prev) => !prev);
            if (!isDockCollapsed) onSelectTab('none');
          }}
          className="flex items-center gap-1.5 px-4 py-1 rounded-full apple-glass-panel text-[11px] font-semibold text-slate-700 hover:text-slate-950 cursor-pointer"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-sky-600" />
              <span>Spatial Dock einblenden</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-sky-600" />
              <span>Zen-Ansicht (Dock ausblenden)</span>
            </>
          )}
        </button>
      </div>

      {/* Expandable Daylight Apple-Glass Drawer above the Dock */}
      {!isDockCollapsed && activeTab !== 'none' && (
        <div className="mb-2 p-3 sm:p-5 rounded-2xl sm:rounded-3xl apple-glass-panel text-slate-900 max-h-[62dvh] sm:max-h-[50vh] overflow-y-auto shadow-2xl">
          {/* Mobile drawer header with close button */}
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200/80 sm:hidden">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              {activeTab === 'scad' && 'SCAD & Parameter'}
              {activeTab === 'metrology' && 'Physik & Maße'}
              {activeTab === 'comments' && `3D-Pins (${project.comments.length})`}
              {activeTab === 'versions' && `Versionen (v${project.currentVersion})`}
              {activeTab === 'security' && 'Sicherheit'}
            </span>
            <button
              type="button"
              aria-label="Panel schließen"
              onClick={() => onSelectTab('none')}
              className="p-1 rounded-lg apple-glass-btn text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* TAB 1: SCAD & Parametric Studio */}
          {activeTab === 'scad' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-sky-600" />
                    <span>OpenSCAD Echtzeit-Parameter</span>
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500">
                    v{project.currentVersion} · {project.format.toUpperCase()}
                  </span>
                </div>

                {isPublicReadonly && (
                  <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-800">
                    Öffentlicher Lesemodus: Parameter-Vorschau ist interaktiv, permanente Änderungen erfordern einen Workspace-Login.
                  </div>
                )}

                <div className="space-y-3">
                  {Object.entries(project.parameters).map(([paramKey, paramVal]) => {
                    const numVal = Number(paramVal);
                    return (
                      <div key={paramKey} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label htmlFor={`param-${paramKey}`} className="font-mono text-slate-700 font-medium">
                            {paramKey}
                          </label>
                          <span className="font-mono font-bold text-sky-700">{numVal} mm</span>
                        </div>
                        <input
                          id={`param-${paramKey}`}
                          type="range"
                          min={Math.max(2, Math.round(numVal * 0.35))}
                          max={Math.max(60, Math.round(numVal * 2.2))}
                          step={1}
                          value={numVal}
                          onChange={(e) => onUpdateParameter(paramKey, parseFloat(e.target.value))}
                          className="w-full accent-sky-600 cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <label htmlFor="scad-source-editor" className="text-xs font-bold text-slate-800">
                    OpenSCAD Quelltext-Editor (.scad CSG Kernel)
                  </label>
                  <div className="flex items-center gap-2">
                    {onOpenScadEditor && (
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.playClick();
                          onOpenScadEditor();
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl apple-glass-cta text-[11px] font-bold text-white cursor-pointer shadow-xs whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Neuen SCAD-Code einfügen</span>
                      </button>
                    )}
                    <span className="text-[11px] text-slate-500 hidden sm:inline">
                      cube, cylinder, sphere, difference
                    </span>
                  </div>
                </div>
                <textarea
                  id="scad-source-editor"
                  rows={7}
                  value={project.scadCode}
                  readOnly={isPublicReadonly}
                  onChange={(e) => onUpdateScadCode(e.target.value)}
                  className="w-full flex-1 rounded-2xl bg-slate-50/95 border border-slate-200/90 p-3.5 font-mono text-xs text-slate-800 leading-relaxed focus:outline-none focus:border-sky-500 shadow-inner"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Physical Properties (Mass, CoM, Inertia Tensor) & Metrology */}
          {activeTab === 'metrology' && (
            <div className="space-y-4">
              {/* Top Row: Heading + Inline Material Density Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2">
                  <Scale className="w-4 h-4 text-sky-600 shrink-0" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Physikalische Eigenschaften &amp; Bemaßung
                  </h3>
                </div>

                {/* Inline Material Switcher with Live Density (g/cm³) */}
                <div
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
                  role="group"
                  aria-label="Werkstoff-Dichte wählen"
                >
                  {MATERIAL_FINISH_LIST.map((spec) => {
                    const isActive = project.finish === spec.id;
                    return (
                      <button
                        key={spec.id}
                        type="button"
                        data-testid={`physics-material-${spec.id}`}
                        onClick={() => {
                          soundEngine.playClick();
                          onChangeFinish(spec.id);
                        }}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                          isActive
                            ? 'apple-glass-cta text-white'
                            : 'apple-glass-btn text-slate-700 hover:text-slate-950'
                        }`}
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${spec.swatchClass} border ${
                            isActive ? 'border-white/80' : 'border-slate-400/60'
                          }`}
                        />
                        <span>{spec.shortName}</span>
                        <span
                          className={`font-mono text-[10px] ${
                            isActive ? 'text-sky-100' : 'text-slate-500'
                          }`}
                        >
                          {spec.densityGCm3.toFixed(2)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary Physics KPI Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-2xl apple-glass-card">
                  <div className="text-[11px] font-medium text-slate-500">Gesamtmasse</div>
                  <div
                    data-testid="physics-mass-value"
                    className="text-base sm:text-lg font-mono font-bold text-slate-900 mt-0.5 tabular-nums"
                  >
                    {physical ? formatMassDisplay(physical.massGrams) : '—'}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {physical ? `${physical.massKg.toFixed(4)} kg` : 'Berechnung läuft'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl apple-glass-card">
                  <div className="text-[11px] font-medium text-slate-500">Werkstoff &amp; Dichte</div>
                  <div
                    data-testid="physics-density-value"
                    className="text-base sm:text-lg font-mono font-bold text-sky-700 mt-0.5 tabular-nums"
                  >
                    {(physical?.densityGCm3 ?? activeMaterial.densityGCm3).toFixed(2)} g/cm³
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                    {activeMaterial.name} ({activeMaterial.alloy})
                  </div>
                </div>

                <div className="p-3 rounded-2xl apple-glass-card">
                  <div className="text-[11px] font-medium text-slate-500">Festkörper-Volumen</div>
                  <div className="text-base sm:text-lg font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                    {dimensions.volumeCm3.toFixed(2)} cm³
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {dimensions.triangleCount.toLocaleString('de-DE')} Dreiecke
                  </div>
                </div>

                <div className="p-3 rounded-2xl apple-glass-card">
                  <div className="text-[11px] font-medium text-slate-500">Oberfläche &amp; Hüllmaß</div>
                  <div className="text-base sm:text-lg font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                    {dimensions.surfaceAreaCm2.toFixed(2)} cm²
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {formatLen(dimensions.width)} × {formatLen(dimensions.height)} ×{' '}
                    {formatLen(dimensions.depth)} {lengthUnit}
                  </div>
                </div>
              </div>

              {/* Engineering Details: Left (Center of Mass + Measuring) | Right (3x3 Inertia Tensor + Export) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Left Column: Center of Mass + Point-to-Point Measurement */}
                <div className="lg:col-span-5 space-y-3">
                  {/* Center of Mass Card */}
                  <div
                    data-testid="physics-com-card"
                    className="p-3.5 rounded-2xl apple-glass-subcard space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <Crosshair className="w-3.5 h-3.5 text-orange-600" />
                        <span>Schwerpunkt (Center of Mass)</span>
                      </div>
                      <button
                        type="button"
                        data-testid="toggle-com-gizmo-btn"
                        onClick={() => {
                          soundEngine.playClick();
                          onToggleCenterOfMass();
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          showCenterOfMass
                            ? 'bg-orange-600 text-white shadow-xs'
                            : 'apple-glass-btn text-slate-700'
                        }`}
                      >
                        {showCenterOfMass ? '3D-Marker aktiv' : 'Im 3D anzeigen'}
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center font-mono">
                      <div className="py-1.5 px-2 rounded-xl bg-white/90 border border-slate-200/80">
                        <div className="text-[10px] font-semibold text-rose-600">X</div>
                        <div className="text-xs font-bold text-slate-900 tabular-nums">
                          {physical ? formatLen(physical.centerOfMassMm.x) : '0.0'} {lengthUnit}
                        </div>
                      </div>
                      <div className="py-1.5 px-2 rounded-xl bg-white/90 border border-slate-200/80">
                        <div className="text-[10px] font-semibold text-emerald-600">Y</div>
                        <div className="text-xs font-bold text-slate-900 tabular-nums">
                          {physical ? formatLen(physical.centerOfMassMm.y) : '0.0'} {lengthUnit}
                        </div>
                      </div>
                      <div className="py-1.5 px-2 rounded-xl bg-white/90 border border-slate-200/80">
                        <div className="text-[10px] font-semibold text-sky-600">Z</div>
                        <div className="text-xs font-bold text-slate-900 tabular-nums">
                          {physical ? formatLen(physical.centerOfMassMm.z) : '0.0'} {lengthUnit}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Point-to-Point Measurement Controls */}
                  <form
                    onSubmit={handleManualMeasureSubmit}
                    className="p-3.5 rounded-2xl apple-glass-subcard space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Ruler className="w-3.5 h-3.5 text-amber-600" />
                        <span>Abstandsmessung ({project.measurements.length})</span>
                      </span>
                      {project.measurements.length > 0 && (
                        <button
                          type="button"
                          onClick={onClearMeasurements}
                          className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 font-semibold cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                      <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                        <span className="text-slate-400">P1</span>
                        <input
                          type="number"
                          aria-label="Punkt 1 X"
                          value={manualPtA.x}
                          onChange={(e) => setManualPtA({ ...manualPtA, x: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                        <input
                          type="number"
                          aria-label="Punkt 1 Y"
                          value={manualPtA.y}
                          onChange={(e) => setManualPtA({ ...manualPtA, y: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                        <input
                          type="number"
                          aria-label="Punkt 1 Z"
                          value={manualPtA.z}
                          onChange={(e) => setManualPtA({ ...manualPtA, z: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-slate-200">
                        <span className="text-slate-400">P2</span>
                        <input
                          type="number"
                          aria-label="Punkt 2 X"
                          value={manualPtB.x}
                          onChange={(e) => setManualPtB({ ...manualPtB, x: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                        <input
                          type="number"
                          aria-label="Punkt 2 Y"
                          value={manualPtB.y}
                          onChange={(e) => setManualPtB({ ...manualPtB, y: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                        <input
                          type="number"
                          aria-label="Punkt 2 Z"
                          value={manualPtB.z}
                          onChange={(e) => setManualPtB({ ...manualPtB, z: parseFloat(e.target.value) || 0 })}
                          className="w-10 bg-transparent text-slate-900 text-right focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold text-[11px] hover:bg-amber-600 transition-colors cursor-pointer"
                      >
                        Strecke setzen
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          soundEngine.playClick();
                          onChangeToolMode(toolMode === 'measure' ? 'orbit' : 'measure');
                        }}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                          toolMode === 'measure'
                            ? 'apple-glass-cta text-white'
                            : 'apple-glass-btn text-slate-700'
                        }`}
                      >
                        {toolMode === 'measure' ? '3D-Messung aktiv' : 'Im 3D-Modell messen'}
                      </button>
                    </div>

                    {project.measurements.length > 0 && (
                      <div className="space-y-1.5 max-h-24 overflow-y-auto pt-1">
                        {project.measurements.map((m, idx) => (
                          <div
                            key={m.id}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/90 border border-slate-200/80 text-[11px] font-mono"
                          >
                            <span className="text-amber-700 font-bold">
                              M{idx + 1}: {m.distanceMm.toFixed(2)} mm
                            </span>
                            <span className="text-slate-500">
                              Δ({m.deltaX}, {m.deltaY}, {m.deltaZ})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                </div>

                {/* Right Column: Symmetric 3x3 Inertia Tensor about Center of Mass + Principal Moments + Export */}
                <div className="lg:col-span-7 flex flex-col justify-between gap-3">
                  <div
                    data-testid="physics-inertia-matrix"
                    className="p-3.5 rounded-2xl apple-glass-subcard space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                        <Box className="w-3.5 h-3.5 text-sky-600" />
                        <span>
                          Trägheitstensor am Schwerpunkt (I<sub className="text-[9px] font-mono">CoM</sub>)
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">Einheit: g·cm²</span>
                    </div>

                    {/* Clean 3x3 Engineering Matrix */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-right font-mono text-xs border-separate border-spacing-1">
                        <thead>
                          <tr className="text-[10px] text-slate-500 uppercase">
                            <th className="w-10 text-left font-semibold px-1.5 py-0.5">Achse</th>
                            <th className="text-right font-semibold px-2 py-0.5 text-rose-600">X</th>
                            <th className="text-right font-semibold px-2 py-0.5 text-emerald-600">Y</th>
                            <th className="text-right font-semibold px-2 py-0.5 text-sky-600">Z</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              {
                                axis: 'X',
                                axisColor: 'text-rose-600',
                                row: [
                                  { label: 'Ixx', val: physical?.inertiaTensorGCm2.ixx ?? 0, diag: true },
                                  { label: 'Ixy', val: physical?.inertiaTensorGCm2.ixy ?? 0, diag: false },
                                  { label: 'Ixz', val: physical?.inertiaTensorGCm2.ixz ?? 0, diag: false },
                                ],
                              },
                              {
                                axis: 'Y',
                                axisColor: 'text-emerald-600',
                                row: [
                                  { label: 'Iyx', val: physical?.inertiaTensorGCm2.ixy ?? 0, diag: false },
                                  { label: 'Iyy', val: physical?.inertiaTensorGCm2.iyy ?? 0, diag: true },
                                  { label: 'Iyz', val: physical?.inertiaTensorGCm2.iyz ?? 0, diag: false },
                                ],
                              },
                              {
                                axis: 'Z',
                                axisColor: 'text-sky-600',
                                row: [
                                  { label: 'Izx', val: physical?.inertiaTensorGCm2.ixz ?? 0, diag: false },
                                  { label: 'Izy', val: physical?.inertiaTensorGCm2.iyz ?? 0, diag: false },
                                  { label: 'Izz', val: physical?.inertiaTensorGCm2.izz ?? 0, diag: true },
                                ],
                              },
                            ] as const
                          ).map((r) => (
                            <tr key={r.axis}>
                              <td className={`text-left font-bold px-1.5 py-1.5 ${r.axisColor}`}>
                                {r.axis}
                              </td>
                              {r.row.map((cell) => (
                                <td
                                  key={cell.label}
                                  className={`px-2.5 py-1.5 rounded-lg tabular-nums border ${
                                    cell.diag
                                      ? 'bg-sky-50/90 border-sky-200 text-slate-950 font-bold'
                                      : 'bg-white/85 border-slate-200/70 text-slate-600'
                                  }`}
                                >
                                  <span className="text-[9px] text-slate-400 mr-1.5 font-normal">
                                    {cell.label}
                                  </span>
                                  <span>{formatTensorValue(cell.val)}</span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Principal Moments & Radii of Gyration */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 text-[11px]">
                      <div className="px-3 py-2 rounded-xl bg-white/85 border border-slate-200/70">
                        <div className="text-[10px] text-slate-500 font-medium">
                          Hauptmomente (I₁ · I₂ · I₃)
                        </div>
                        <div
                          data-testid="physics-principal-moments"
                          className="font-mono font-bold text-slate-900 tabular-nums mt-0.5 whitespace-nowrap"
                        >
                          {physical
                            ? physical.principalMomentsGCm2.map((v) => formatTensorValue(v)).join(' · ')
                            : '0 · 0 · 0'}
                        </div>
                      </div>
                      <div className="px-3 py-2 rounded-xl bg-white/85 border border-slate-200/70">
                        <div className="text-[10px] text-slate-500 font-medium">
                          Trägheitsradien (r<sub className="text-[9px]">x</sub> · r<sub className="text-[9px]">y</sub> · r<sub className="text-[9px]">z</sub>)
                        </div>
                        <div className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5 whitespace-nowrap">
                          {physical
                            ? `${physical.radiusOfGyrationMm.x.toFixed(1)} · ${physical.radiusOfGyrationMm.y.toFixed(1)} · ${physical.radiusOfGyrationMm.z.toFixed(1)} mm`
                            : '—'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Multi-Format CAD Export Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <span className="text-xs text-slate-600 flex items-center gap-1.5 font-medium">
                      <Download className="w-3.5 h-3.5 text-sky-600" />
                      <span>CAD-Direktexport:</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      {(['stl', 'step', 'obj', 'scad'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => {
                            soundEngine.playSuccessChime();
                            onExportFormat(fmt);
                          }}
                          className="px-2.5 py-1.5 rounded-lg apple-glass-btn hover:bg-sky-600 hover:text-white text-xs font-mono font-bold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          .{fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Spatial 3D Team Annotations */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Räumliche 3D-Team-Kommentare am Bauteil ({project.comments.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Jeder Kommentar ist fest mit einer 3D-Oberflächenkoordinate (XYZ) und Revisionsnummer verknüpft.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    onChangeToolMode(toolMode === 'annotate' ? 'orbit' : 'annotate');
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    toolMode === 'annotate'
                      ? 'apple-glass-cta text-white'
                      : 'apple-glass-btn text-sky-700'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>{toolMode === 'annotate' ? 'Klicke jetzt auf das 3D-Bauteil...' : 'Neuen 3D-Pin am Modell setzen'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {project.comments.map((cmt, index) => {
                  const isSelected = selectedCommentId === cmt.id;
                  return (
                    <div
                      key={cmt.id}
                      onClick={() => onSelectComment(isSelected ? null : cmt.id)}
                      className={`p-3.5 rounded-2xl transition-all cursor-pointer ${
                        isSelected ? 'apple-glass-card-active' : 'apple-glass-card'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sky-600">#{index + 1}</span>
                          <span className="font-bold text-slate-900">{cmt.authorName}</span>
                          <span className="text-slate-500">· {cmt.authorRole}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">
                          v{cmt.versionNumber} · {cmt.createdAt}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{cmt.text}</p>
                      <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                        <span className="font-mono text-slate-500">
                          XYZ ({cmt.position.x}, {cmt.position.y}, {cmt.position.z}) mm
                        </span>
                        {!isPublicReadonly && (
                          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => onToggleResolveComment(cmt.id)}
                              className={`flex items-center gap-1 font-semibold cursor-pointer ${
                                cmt.resolved ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{cmt.resolved ? 'Erledigt' : 'Als erledigt markieren'}</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Kommentar ${index + 1} löschen`}
                              onClick={() => onDeleteComment(cmt.id)}
                              className="text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Model Versioning & Revision History */}
          {activeTab === 'versions' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-2.5">
                <h3 className="text-sm font-bold text-slate-900 mb-2">
                  Versionshistorie &amp; Änderungsrückverfolgung ({project.versions.length} Stände)
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {[...project.versions].reverse().map((ver) => {
                    const isCurrent = ver.versionNumber === project.currentVersion;
                    return (
                      <div
                        key={ver.versionNumber}
                        className={`flex items-center justify-between p-3 rounded-2xl ${
                          isCurrent ? 'apple-glass-card-active' : 'apple-glass-card'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-sky-700">
                              Revision v{ver.versionNumber}.0
                            </span>
                            <span className="text-slate-900 font-semibold">{ver.author}</span>
                            <span className="text-slate-500">· {ver.createdAt}</span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">{ver.changelog}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            soundEngine.playClick();
                            onRestoreVersion(ver.versionNumber);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 cursor-pointer ${
                            isCurrent
                              ? 'apple-glass-cta text-white'
                              : 'apple-glass-btn text-slate-700'
                          }`}
                        >
                          {isCurrent ? 'Aktiv geladen' : `v${ver.versionNumber} wiederherstellen`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="lg:col-span-5">
                <form onSubmit={handleSaveRevision} className="p-4 rounded-2xl apple-glass-subcard space-y-3">
                  <div className="text-xs font-bold text-slate-900">
                    Neuen Revisionsstand einfrieren (v{project.versions.length + 1}.0)
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Speichert alle aktuellen OpenSCAD-Parameter, den Code und das Oberflächen-Finish revisionssicher ab.
                  </p>
                  <input
                    type="text"
                    disabled={isPublicReadonly}
                    value={changelogDraft}
                    onChange={(e) => setChangelogDraft(e.target.value)}
                    placeholder="Änderungsnotiz (z.B. Wandstärke +2mm verstärkt)"
                    className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={isPublicReadonly}
                    className="w-full py-2 px-4 rounded-xl apple-glass-cta disabled:opacity-40 text-white font-bold text-xs transition-colors cursor-pointer"
                  >
                    Revision v{project.versions.length + 1}.0 speichern
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: Upload Security Sandbox & Verification */}
          {activeTab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Zero-Trust CAD Upload-Sicherheitsprüfung</span>
                  </h3>
                  {report && (
                    <span className="text-[11px] font-mono text-slate-500">
                      SHA-256 Preview: {report.sha256Preview}
                    </span>
                  )}
                </div>

                {report ? (
                  <div
                    className={`p-3.5 rounded-2xl border ${
                      report.passed
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-rose-50 border-rose-300 text-rose-900'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-bold mb-1">
                      <span>
                        Datei: {report.fileName} ({report.fileSizeBytes} Bytes)
                      </span>
                      <span>{report.passed ? 'FREIGEGEBEN' : 'QUARANTÄNE / BLOCKIERT'}</span>
                    </div>
                    <p className="text-xs">{report.threatSummary}</p>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
                      <div className="px-2 py-1 rounded bg-white/80 border border-slate-200">
                        Ext: {report.checks.extensionAllowed ? 'OK' : 'FAIL'}
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 border border-slate-200">
                        Header: {report.checks.magicBytesValid ? 'OK' : 'FAIL'}
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 border border-slate-200">
                        No-EXE: {report.checks.noExecutableSignatures ? 'OK' : 'BLOCK'}
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 border border-slate-200">
                        No-XSS: {report.checks.noScriptInjection ? 'OK' : 'BLOCK'}
                      </div>
                      <div className="px-2 py-1 rounded bg-white/80 border border-slate-200">
                        Quota: {report.checks.sizeWithinQuota ? 'OK' : 'FAIL'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="lg:col-span-5 flex flex-col justify-between p-4 rounded-2xl apple-glass-subcard">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Live-Penetrationstest der Upload-Firewall
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                    Teste die Sicherheits-Engine mit einer simulierten Schadcode-Datei (getarnte PE/MZ `.exe` mit JavaScript-Injection als `.stl`), um die sofortige Blockade zu verifizieren.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playSecurityAlert();
                    onSimulateMaliciousTest();
                  }}
                  className="mt-3 w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Schaddatei-Angriff simulieren (exploit_payload.stl)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Primary Horizontal Daylight Apple-Glass Control Dock */}
      <div className="px-2.5 sm:px-3.5 py-2 rounded-2xl sm:rounded-3xl apple-glass-panel flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2 shadow-xl">
        {/* Row 1 / Left: Interactive Tool Modes & Drawer Tabs */}
        <div className="flex items-center justify-between sm:justify-start gap-1 shrink-0 pb-0.5 lg:pb-0">
          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onSelectTab(activeTab === 'scad' ? 'none' : 'scad');
            }}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'scad'
                ? 'apple-glass-cta text-white'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SCAD</span>
          </button>

          <button
            type="button"
            data-testid="dock-physics-tab-btn"
            onClick={() => {
              soundEngine.playClick();
              onSelectTab(activeTab === 'metrology' ? 'none' : 'metrology');
            }}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'metrology' || toolMode === 'measure'
                ? 'bg-amber-500 text-white'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Physik &amp; Maße</span>
            <span className="sm:hidden">Physik</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onSelectTab(activeTab === 'comments' ? 'none' : 'comments');
            }}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'comments' || toolMode === 'annotate'
                ? 'apple-glass-cta text-white'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Pins ({project.comments.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onSelectTab(activeTab === 'versions' ? 'none' : 'versions');
            }}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'versions'
                ? 'apple-glass-cta text-white'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>v{project.currentVersion}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundEngine.playClick();
              onSelectTab(activeTab === 'security' ? 'none' : 'security');
            }}
            aria-label="Zero-Trust Upload-Sicherheitsprüfung"
            title="Zero-Trust Upload-Sicherheitsprüfung"
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'security'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${activeTab === 'security' ? 'text-white' : 'text-emerald-600'}`} />
            <span className="hidden xl:inline">Schutz</span>
          </button>
        </div>

        {/* Row 2 / Center & Right: Explosion, Material Finish Swatches & Viewport Helpers */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 pt-1.5 lg:pt-0 border-t lg:border-t-0 border-slate-200/70">
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onToggleSideBySideExploded();
              }}
              aria-pressed={sideBySideExploded}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                sideBySideExploded
                  ? 'apple-glass-cta text-white'
                  : 'apple-glass-btn text-slate-700'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>Explosion</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onToggleAutoExploding();
              }}
              aria-label={isAutoExploding ? 'Explosions-Animation pausieren' : 'Explosions-Animation abspielen'}
              title="Komponenten entlang Separationsvektoren animieren"
              className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                isAutoExploding
                  ? 'bg-amber-500 text-white'
                  : 'apple-glass-btn text-slate-700'
              }`}
            >
              {isAutoExploding ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>

            <label htmlFor="exploded-slider" className="sr-only">
              Explosionsansicht
            </label>
            <input
              id="exploded-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={project.explodedFactor}
              onChange={(e) => onChangeExploded(parseFloat(e.target.value))}
              className="w-11 sm:w-16 accent-sky-600 cursor-pointer"
            />
          </div>

          <div
            className="hidden md:flex items-center gap-1.5 shrink-0"
            role="group"
            aria-label="Material-Finish & Dichte"
          >
            {MATERIAL_FINISH_LIST.map((fin) => (
              <button
                key={fin.id}
                type="button"
                title={`${fin.name} (${fin.densityGCm3.toFixed(2)} g/cm³)`}
                aria-label={`Material ${fin.name}, Dichte ${fin.densityGCm3} g/cm³`}
                onClick={() => {
                  soundEngine.playClick();
                  onChangeFinish(fin.id);
                }}
                className={`w-4.5 h-4.5 rounded-full ${fin.swatchClass} border transition-transform cursor-pointer ${
                  project.finish === fin.id
                    ? 'border-slate-900 scale-115 ring-2 ring-sky-500/60'
                    : 'border-slate-400/50 opacity-80 hover:opacity-100'
                }`}
              />
            ))}
          </div>

          {/* Right: Camera Presets, CoM, BBox, Wireframe & Audio */}
          <div className="flex items-center gap-1 shrink-0">
            {(['iso', 'front', 'top', 'right'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  onSelectCameraPreset(preset);
                }}
                className="hidden sm:inline-flex px-1.5 py-1 rounded-lg apple-glass-btn text-[10px] font-mono font-semibold uppercase text-slate-700 cursor-pointer"
              >
                {preset}
              </button>
            ))}

            <button
              type="button"
              data-testid="dock-com-toggle-btn"
              title="3D-Schwerpunkt (Center of Mass) ein-/ausblenden"
              onClick={() => {
                soundEngine.playClick();
                onToggleCenterOfMass();
              }}
              className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer whitespace-nowrap ${
                showCenterOfMass
                  ? 'bg-orange-100 text-orange-800 border-orange-400'
                  : 'apple-glass-btn text-slate-600'
              }`}
            >
              <Crosshair className="w-3 h-3" />
              <span>CoM</span>
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onToggleDimensions();
              }}
              className={`px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer whitespace-nowrap ${
                showDimensions
                  ? 'bg-sky-100 text-sky-800 border-sky-400'
                  : 'apple-glass-btn text-slate-600'
              }`}
            >
              Box
            </button>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onToggleWireframe();
              }}
              className={`px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer whitespace-nowrap ${
                wireframe
                  ? 'bg-sky-100 text-sky-800 border-sky-400'
                  : 'apple-glass-btn text-slate-600'
              }`}
            >
              Draht
            </button>

            <button
              type="button"
              onClick={onToggleSound}
              aria-label={soundEnabled ? 'UI-Sounds stummschalten' : 'UI-Sounds aktivieren'}
              className="hidden sm:inline-flex p-1.5 rounded-lg apple-glass-btn text-slate-700 cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-sky-600" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
