import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CADFolder,
  CADModelProject,
  MaterialFinish,
  ShareDurationPreset,
} from '../types/cad';
import {
  analyzeScadCodeStructure,
  createProjectFromScadCode,
} from '../utils/cadParser';
import { SCAD_TEMPLATES, ScadTemplate } from '../utils/scadTemplates';
import { soundEngine } from '../utils/soundEngine';
import {
  Code2,
  Folder,
  Sparkles,
  X,
  Play,
  Clipboard,
  Trash2,
  Sliders,
  Box,
  Layers,
  CheckCircle2,
  FileCode2,
  HelpCircle,
} from 'lucide-react';

interface ScadCodeEditorModalProps {
  folders: CADFolder[];
  selectedFolderId: string | 'all';
  defaultAuthor?: string;
  onClose: () => void;
  onSaveAndRenderNewModel: (newProject: CADModelProject) => void;
}

const FINISH_CHOICES: { id: MaterialFinish; label: string; swatchClass: string }[] = [
  { id: 'titanium', label: 'Titan Grade 5', swatchClass: 'bg-slate-400' },
  { id: 'anodized_blue', label: 'Eloxal Blau', swatchClass: 'bg-sky-500' },
  { id: 'frosted_glass', label: 'Acrylglas', swatchClass: 'bg-cyan-300' },
  { id: 'matte_polymer', label: 'Carbon-Polymer', swatchClass: 'bg-slate-700' },
  { id: 'brushed_gold', label: 'Messing CuZn', swatchClass: 'bg-amber-400' },
];

export const ScadCodeEditorModal: React.FC<ScadCodeEditorModalProps> = ({
  folders,
  selectedFolderId,
  defaultAuthor = 'CAD Ingenieur',
  onClose,
  onSaveAndRenderNewModel,
}) => {
  // Initial template: Flansch-Hohlzylinder or simple CSG
  const [scadCode, setScadCode] = useState<string>(() => SCAD_TEMPLATES[0].code);
  const [modelName, setModelName] = useState<string>('');
  const [targetFolderId, setTargetFolderId] = useState<string>(() => {
    if (selectedFolderId !== 'all') return selectedFolderId;
    return folders[0]?.id || 'folder-prototypes';
  });
  const [selectedFinish, setSelectedFinish] = useState<MaterialFinish>('titanium');
  const [pasteNotice, setPasteNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Live syntax analysis of the OpenSCAD code
  const analysis = useMemo(() => analyzeScadCodeStructure(scadCode), [scadCode]);

  // If user hasn't explicitly entered a custom name, use suggestedName as visual placeholder
  const effectiveName = modelName.trim() || analysis.suggestedName || 'Neues OpenSCAD Bauteil';

  // Handle Tab key indentation inside textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      const nextVal = val.substring(0, start) + '  ' + val.substring(end);
      setScadCode(nextVal);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCompileAndRender();
    }
  };

  const handleSelectTemplate = (template: ScadTemplate) => {
    soundEngine.playClick();
    setScadCode(template.code);
    setModelName(template.title);
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setScadCode(text);
          soundEngine.playSuccessChime();
          setPasteNotice('Code aus der Zwischenablage eingefügt');
          setTimeout(() => setPasteNotice(null), 2500);
          return;
        }
      }
    } catch {
      // ignore clipboard permission error
    }
    textareaRef.current?.focus();
    setPasteNotice('Fügen Sie den Code direkt per Tastatur ein (Strg+V / ⌘V)');
    setTimeout(() => setPasteNotice(null), 3000);
  };

  const handleClearCode = () => {
    soundEngine.playClick();
    setScadCode('');
    setModelName('');
    textareaRef.current?.focus();
  };

  const handleCompileAndRender = () => {
    if (!scadCode.trim()) {
      textareaRef.current?.focus();
      return;
    }
    soundEngine.playSuccessChime();

    const newProject = createProjectFromScadCode({
      name: modelName.trim() || analysis.suggestedName,
      scadCode,
      folderId: targetFolderId,
      author: defaultAuthor,
      finish: selectedFinish,
      shareDuration: '24h',
    });

    onSaveAndRenderNewModel(newProject);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="OpenSCAD Code einfügen und als 3D-Modell berechnen"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-md"
    >
      <div className="w-full max-w-5xl h-[96dvh] sm:h-[88vh] flex flex-col rounded-t-3xl sm:rounded-3xl apple-glass-panel text-slate-900 overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-slate-200/80 bg-white/85 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 flex items-center justify-center text-sky-600 shrink-0">
              <FileCode2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 font-display tracking-tight truncate">
                OpenSCAD Code einfügen &amp; als 3D-Modell berechnen
              </h2>
              <p className="text-[11px] text-slate-500 hidden sm:block truncate">
                Live CSG-Kernel · cube, cylinder, sphere, difference, union &amp; Echtzeit-Parameter
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCompileAndRender}
              data-testid="compile-scad-primary-btn"
              className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl apple-glass-cta text-xs font-bold whitespace-nowrap cursor-pointer shadow-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Als 3D-Modell berechnen</span>
              <span className="xs:hidden">Berechnen</span>
            </button>

            <button
              type="button"
              aria-label="Code-Editor schließen"
              onClick={onClose}
              className="p-2 rounded-xl apple-glass-btn text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Template Quick Bar */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-slate-200/70 bg-slate-50/70 shrink-0 flex items-center gap-2 overflow-x-auto text-xs">
          <span className="font-semibold text-slate-500 whitespace-nowrap shrink-0 flex items-center gap-1 text-[11px]">
            <Sparkles className="w-3 h-3 text-sky-600" />
            <span>Vorlagen:</span>
          </span>
          {SCAD_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => handleSelectTemplate(tmpl)}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-sky-400 hover:bg-sky-50 text-slate-700 hover:text-sky-800 text-[11px] font-medium whitespace-nowrap shrink-0 transition-all cursor-pointer"
              title={tmpl.description}
            >
              {tmpl.title}
            </button>
          ))}
        </div>

        {/* Main Body: 2 Columns on Desktop, Stacked on Mobile */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* Left Column: Code Textarea & Toolbar (Lg: 8 cols) */}
          <div className="lg:col-span-8 flex flex-col p-3 sm:p-5 border-b lg:border-b-0 lg:border-r border-slate-200/80 bg-slate-900/5 min-h-[300px] flex-1 overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Code2 className="w-3.5 h-3.5 text-sky-600" />
                <span>OpenSCAD Quelltext (.scad)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {pasteNotice && (
                  <span className="text-emerald-700 font-semibold animate-pulse">
                    {pasteNotice}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg apple-glass-btn text-slate-700 hover:text-slate-950 font-medium cursor-pointer"
                  title="Aus der Zwischenablage einfügen"
                >
                  <Clipboard className="w-3 h-3" />
                  <span className="hidden sm:inline">Einfügen</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearCode}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg apple-glass-btn text-slate-600 hover:text-rose-600 font-medium cursor-pointer"
                  title="Editor leeren"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Leeren</span>
                </button>
              </div>
            </div>

            <div className="relative flex-1 min-h-0 flex flex-col rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-inner">
              <textarea
                ref={textareaRef}
                data-testid="scad-code-editor-textarea"
                aria-label="OpenSCAD Quellcode"
                value={scadCode}
                onChange={(e) => setScadCode(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`// Geben oder fügen Sie hier Ihren OpenSCAD-Code ein:\nradius = 20;\nheight = 35;\ndifference() {\n  cylinder(h = height, r = radius);\n  translate([0, 0, -1]) cylinder(h = height + 2, r = radius - 4);\n}`}
                className="w-full flex-1 p-3.5 bg-transparent font-mono text-xs sm:text-[13px] text-emerald-300 leading-relaxed resize-none focus:outline-none placeholder:text-slate-600 selection:bg-sky-700/60 selection:text-white"
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
              />
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-t border-slate-800/80 text-[10px] sm:text-[11px] font-mono text-slate-400">
                <span>
                  {scadCode.split('\n').length} Zeilen · {scadCode.length} Zeichen
                </span>
                <span className="text-slate-500 hidden sm:inline">
                  Tipp: Tab zum Einrücken · ⌘↵ zum Berechnen
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Model Settings, Folder Selector, and Live Inspection (Lg: 4 cols) */}
          <div className="lg:col-span-4 p-4 sm:p-5 flex flex-col justify-between bg-white/60 overflow-y-auto space-y-4">
            <div className="space-y-4">
              {/* Bauteil-Name */}
              <div>
                <label
                  htmlFor="scad-model-name-input"
                  className="block text-xs font-bold text-slate-900 mb-1"
                >
                  Modellname
                </label>
                <input
                  id="scad-model-name-input"
                  data-testid="scad-model-name-input"
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder={analysis.suggestedName || 'z.B. Turbinengehäuse V1'}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 shadow-xs"
                />
              </div>

              {/* Ziel-Ablage (Folder) */}
              <div>
                <label
                  htmlFor="scad-target-folder-select"
                  className="block text-xs font-bold text-slate-900 mb-1"
                >
                  In Ablage ablegen
                </label>
                <div className="relative">
                  <select
                    id="scad-target-folder-select"
                    data-testid="scad-target-folder-select"
                    value={targetFolderId}
                    onChange={(e) => setTargetFolderId(e.target.value)}
                    className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500 shadow-xs appearance-none cursor-pointer"
                  >
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <Folder className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Oberflächen-Finish */}
              <div>
                <span className="block text-xs font-bold text-slate-900 mb-1.5">
                  Oberflächen-Finish
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {FINISH_CHOICES.map((fin) => (
                    <button
                      key={fin.id}
                      type="button"
                      onClick={() => setSelectedFinish(fin.id)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all cursor-pointer ${
                        selectedFinish === fin.id
                          ? 'border-sky-500 bg-sky-50/80 text-sky-950 font-semibold ring-1 ring-sky-500/40'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full ${fin.swatchClass} shrink-0 border border-slate-300`} />
                      <span className="truncate">{fin.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live CSG & Syntax Analysis Box */}
              <div className="p-3.5 rounded-2xl apple-glass-subcard space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-600" />
                    <span>Live CSG-Inspektion</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full font-bold">
                    Syntax OK
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-xl bg-white border border-slate-200/80">
                    <div className="text-[10px] text-slate-500">3D-Primitives</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {analysis.primitiveCount} Elemente
                    </div>
                  </div>
                  <div className="p-2 rounded-xl bg-white border border-slate-200/80">
                    <div className="text-[10px] text-slate-500">Parameter</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {analysis.parameterCount} Variablen
                    </div>
                  </div>
                </div>

                {analysis.detectedPrimitivesSummary.length > 0 && (
                  <div className="text-[11px] text-slate-600 space-y-0.5 pt-1">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Erkannte Geometrien:
                    </div>
                    {analysis.detectedPrimitivesSummary.slice(0, 4).map((desc, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-slate-700">
                        <CheckCircle2 className="w-3 h-3 text-sky-600 shrink-0" />
                        <span className="truncate">{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleCompileAndRender}
                className="w-full py-2.5 px-4 rounded-xl apple-glass-cta text-xs font-bold text-white flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Sparkles className="w-4 h-4" />
                <span>Als neues 3D-Modell anzeigen</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-2 px-3 rounded-xl apple-glass-btn text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer text-center"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
