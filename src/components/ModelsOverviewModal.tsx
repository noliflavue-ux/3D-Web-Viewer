import React, { useEffect, useRef, useState } from 'react';
import {
  CADFolder,
  CADFolderColor,
  CADFormat,
  CADModelProject,
  ModelSortOption,
  ShareDurationPreset,
  ShareLinkConfig,
  UserSession,
} from '../types/cad';
import {
  computeShareExpiryTimestamp,
  evaluateShareLinkValidity,
  filterAndSortProjects,
  getProjectMetadataMatches,
} from '../utils/cadParser';
import { DEFAULT_SHARE_CONFIG, encodeShareUrl } from '../utils/defaultProjects';
import { soundEngine } from '../utils/soundEngine';
import {
  FolderKanban,
  Folder,
  FolderPlus,
  Search,
  MessageSquare,
  Link2,
  Eye,
  Clock,
  Check,
  Copy,
  Send,
  Upload,
  X,
  ArrowUpDown,
  LayoutGrid,
  List,
  Trash2,
  GripVertical,
  CheckCircle2,
  Sparkles,
  Code2,
} from 'lucide-react';

interface ModelsOverviewModalProps {
  projects: CADModelProject[];
  folders: CADFolder[];
  activeProjectId: string;
  selectedFolderId: string | 'all';
  onSelectFolder: (folderId: string | 'all') => void;
  onCreateFolder: (name: string, description: string, colorAccent: CADFolderColor) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveProjectToFolder: (projectId: string, folderId: string) => void;
  userSession: UserSession | null;
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onOpenProjectForCommenting: (projectId: string) => void;
  onOpenShareModalForProject: (projectId: string) => void;
  onQuickUpdateProjectShareDuration: (projectId: string, preset: ShareDurationPreset) => void;
  onQuickCommentSubmit: (projectId: string, commentText: string) => void;
  onTriggerFileUpload: () => void;
  onOpenScadEditor?: () => void;
}

const FOLDER_COLOR_DOT: Record<CADFolderColor, string> = {
  sky: 'bg-sky-500 text-sky-700 border-sky-200',
  indigo: 'bg-indigo-500 text-indigo-700 border-indigo-200',
  amber: 'bg-amber-500 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-500 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-500 text-rose-700 border-rose-200',
};

const FINISH_LABELS: Record<string, { label: string; dot: string }> = {
  titanium: { label: 'Titan Grade 5', dot: 'bg-slate-400' },
  anodized_blue: { label: 'Eloxal Blau', dot: 'bg-sky-500' },
  frosted_glass: { label: 'Acrylglas', dot: 'bg-cyan-400' },
  matte_polymer: { label: 'SLS Polymer', dot: 'bg-slate-600' },
  brushed_gold: { label: 'Messing CuZn', dot: 'bg-amber-500' },
};

const DURATION_BADGES: ShareDurationPreset[] = ['1h', '24h', '7d', '30d'];

const METADATA_QUICK_CHIPS: { label: string; query: string }[] = [
  { label: 'Werkstoff: Titan', query: 'Titan' },
  { label: 'Parameter: blade_count', query: 'blade_count' },
  { label: 'Autor: Elena Rostova', query: 'Elena Rostova' },
  { label: 'Kommentar: Kavitation', query: 'Kavitation' },
  { label: 'Norm: DIN 3967', query: 'DIN 3967' },
  { label: 'Polymer / Carbon', query: 'SLS Polymer' },
];

export const ModelsOverviewModal: React.FC<ModelsOverviewModalProps> = ({
  projects,
  folders,
  activeProjectId,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onMoveProjectToFolder,
  userSession,
  onClose,
  onSelectProject,
  onOpenProjectForCommenting,
  onOpenShareModalForProject,
  onQuickUpdateProjectShareDuration,
  onQuickCommentSubmit,
  onTriggerFileUpload,
  onOpenScadEditor,
}) => {
  const [formatFilter, setFormatFilter] = useState<'all' | CADFormat>('all');
  const [sortBy, setSortBy] = useState<ModelSortOption>('updated');
  const [viewMode, setViewMode] = useState<'cards' | 'compact'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearchAcrossFolders, setGlobalSearchAcrossFolders] = useState<boolean>(true);
  const [quickCommentDrafts, setQuickCommentDrafts] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Drag-and-Drop state for moving projects between Ablagen
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dropSuccessMessage, setDropSuccessMessage] = useState<string | null>(null);

  // New Folder (Ablage) inline form state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [newFolderColor, setNewFolderColor] = useState<CADFolderColor>('sky');

  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut (Ctrl+K / Cmd+K or '/') to focus the global search bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        globalSearchInputRef.current?.focus();
      } else if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        globalSearchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const hasActiveSearch = searchQuery.trim().length > 0;

  const visibleProjects = filterAndSortProjects(projects, {
    folderId: selectedFolderId,
    format: formatFilter,
    searchQuery,
    sortBy,
    folders,
    globalSearchAcrossFolders,
  });

  const activeFolderObj = folders.find((f) => f.id === selectedFolderId);
  const draggedProjectObj = projects.find((p) => p.id === draggedProjectId);

  const showModalDropFeedback = (msg: string) => {
    setDropSuccessMessage(msg);
    setTimeout(() => {
      setDropSuccessMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  // Drag-and-Drop Handlers
  const handleProjectDragStart = (
    e: React.DragEvent<HTMLElement>,
    proj: CADModelProject
  ) => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA')
    ) {
      e.preventDefault();
      return;
    }
    soundEngine.playClick();
    setDraggedProjectId(proj.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', proj.id);
      e.dataTransfer.setData('application/x-aethercad-project', proj.id);
    }
  };

  const handleProjectDragEnd = () => {
    setDraggedProjectId(null);
    setDragOverFolderId(null);
  };

  const handleFolderDragOver = (
    e: React.DragEvent<HTMLElement>,
    folderId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  };

  const handleFolderDragEnter = (
    e: React.DragEvent<HTMLElement>,
    folderId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverFolderId !== folderId) {
      setDragOverFolderId(folderId);
    }
  };

  const handleFolderDragLeave = (
    e: React.DragEvent<HTMLElement>,
    folderId: string
  ) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) {
      return;
    }
    if (dragOverFolderId === folderId) {
      setDragOverFolderId(null);
    }
  };

  const handleFolderDrop = (
    e: React.DragEvent<HTMLElement>,
    targetFolder: CADFolder
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const transferredId =
      e.dataTransfer?.getData('application/x-aethercad-project') ||
      e.dataTransfer?.getData('text/plain') ||
      draggedProjectId;

    setDraggedProjectId(null);
    setDragOverFolderId(null);

    if (!transferredId) return;

    const proj = projects.find((p) => p.id === transferredId);
    if (!proj) return;

    const currentFolderId = proj.folderId || 'folder-prototypes';
    if (currentFolderId === targetFolder.id) {
      soundEngine.playClick();
      showModalDropFeedback(
        `„${proj.name}“ befindet sich bereits in der Ablage „${targetFolder.name}“.`
      );
      return;
    }

    soundEngine.playSuccessChime();
    onMoveProjectToFolder(proj.id, targetFolder.id);
    showModalDropFeedback(
      `„${proj.name}“ per Drag & Drop in Ablage „${targetFolder.name}“ verschoben.`
    );
  };

  const handleCreateFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    soundEngine.playSuccessChime();
    onCreateFolder(
      newFolderName.trim(),
      newFolderDesc.trim() || 'Benutzerdefinierte Bauteil-Ablage',
      newFolderColor
    );
    setNewFolderName('');
    setNewFolderDesc('');
    setIsCreatingFolder(false);
  };

  const handleSendQuickComment = (projectId: string) => {
    const text = (quickCommentDrafts[projectId] || '').trim();
    if (!text) return;
    soundEngine.playSuccessChime();
    onQuickCommentSubmit(projectId, text);
    setQuickCommentDrafts((prev) => ({ ...prev, [projectId]: '' }));
  };

  const handleCopyDirectLink = (proj: CADModelProject) => {
    const cfg: ShareLinkConfig = proj.shareConfig || {
      ...DEFAULT_SHARE_CONFIG,
      expiresAtMs: computeShareExpiryTimestamp('24h'),
    };
    const url = encodeShareUrl({ ...proj, shareConfig: cfg });
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    soundEngine.playSuccessChime();
    setCopiedId(proj.id);
    setTimeout(() => setCopiedId((prev) => (prev === proj.id ? null : prev)), 2200);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end sm:justify-center p-0 sm:p-4 sm:p-6 bg-slate-900/35 backdrop-blur-sm">
      <div
        role="dialog"
        aria-label="Modell-Übersicht, Ablagen und Team-Kommentare"
        className="w-full max-w-6xl h-full sm:h-[86vh] flex flex-col rounded-none sm:rounded-3xl apple-glass-panel text-slate-900 overflow-hidden shadow-2xl"
      >
        {/* Top Spatial Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-3.5 border-b border-slate-200/80 bg-white/80 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderKanban className="w-5 h-5 text-sky-600 shrink-0" />
              <h2 className="text-base sm:text-xl font-bold text-slate-900 font-display tracking-tight truncate">
                Modell-Übersicht &amp; Strukturierte Ablagen
              </h2>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5 truncate hidden xs:block">
              Angemeldet als{' '}
              <strong className="text-slate-900">{userSession?.name || 'Dr. Lukas Weber'}</strong> ·
              Globale Metadaten-Suche &amp; 1-Klick 3D-Ansicht
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {onOpenScadEditor && (
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  onClose();
                  onOpenScadEditor();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl apple-glass-cta text-xs font-bold text-white cursor-pointer whitespace-nowrap shadow-xs"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">+ SCAD Code einfügen</span>
                <span className="sm:hidden">+ SCAD</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onClose();
                onTriggerFileUpload();
              }}
              className="flex items-center gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-xl apple-glass-btn text-xs font-bold text-sky-700 cursor-pointer whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Importieren</span>
              <span className="sm:hidden">Import</span>
            </button>

            <button
              type="button"
              aria-label="Modell-Übersicht schließen"
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl apple-glass-btn text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* GLOBAL SEARCH BAR FOR PROJECT NAMES & DEEP CAD METADATA */}
        <div
          role="search"
          aria-label="Globale Projektsuche nach Namen und Metadaten"
          className="px-6 py-3 border-b border-slate-200/80 bg-gradient-to-r from-sky-50/70 via-white/85 to-slate-50/80 shrink-0 space-y-2"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-sky-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={globalSearchInputRef}
                id="global-models-search-input"
                data-testid="global-models-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Globale Suche nach Name, Format, Autor, Werkstoff (z.B. Titan), SCAD-Parameter (blade_count), 3D-Kommentar oder Changelog..."
                aria-label="Globale Suche nach Projektname oder Metadaten"
                className="w-full rounded-2xl bg-white border border-slate-300/90 pl-10 pr-24 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-xs focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {hasActiveSearch ? (
                  <button
                    type="button"
                    aria-label="Suchbegriff löschen"
                    data-testid="clear-global-search-btn"
                    onClick={() => {
                      soundEngine.playClick();
                      setSearchQuery('');
                      globalSearchInputRef.current?.focus();
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                ) : (
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-500">
                    ⌘K / /
                  </kbd>
                )}
              </div>
            </div>

            {/* Scope Toggle: Search across all Ablagen vs. active Ablage */}
            <label className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/90 border border-slate-200/90 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={globalSearchAcrossFolders}
                onChange={() => {
                  soundEngine.playClick();
                  setGlobalSearchAcrossFolders((prev) => !prev);
                }}
                className="accent-sky-600 rounded cursor-pointer"
              />
              <span>Alle Ablagen durchsuchen</span>
            </label>

            {/* Live Search Result Counter Pill */}
            <div
              data-testid="global-search-results-count"
              className={`px-3 py-2 rounded-2xl text-xs font-mono font-bold shrink-0 ${
                hasActiveSearch
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 border border-slate-200/80'
              }`}
            >
              {visibleProjects.length} / {projects.length} Treffer
            </div>
          </div>

          {/* Quick Metadata Search Suggestion Chips */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 text-slate-500 font-semibold mr-1">
              <Sparkles className="w-3 h-3 text-sky-600" />
              <span>Metadaten-Schnellfilter:</span>
            </span>
            {METADATA_QUICK_CHIPS.map((chip) => {
              const isSelectedChip =
                searchQuery.trim().toLowerCase() === chip.query.toLowerCase();
              return (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setSearchQuery(isSelectedChip ? '' : chip.query);
                  }}
                  className={`px-2.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                    isSelectedChip
                      ? 'apple-glass-cta text-white font-bold'
                      : 'bg-white hover:bg-sky-50 text-slate-600 hover:text-sky-700 border border-slate-200/90'
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mobile Horizontal Ablagen Strip (iPhone & Tablet) */}
        <div className="flex lg:hidden items-center gap-1.5 px-3 sm:px-6 py-2 bg-slate-100/90 border-b border-slate-200/80 overflow-x-auto no-scrollbar shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap shrink-0">
            Ablagen:
          </span>
          <button
            type="button"
            onClick={() => onSelectFolder('all')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              selectedFolderId === 'all'
                ? 'apple-glass-cta text-white font-bold shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            Alle ({projects.length})
          </button>
          {folders.map((f) => {
            const count = projects.filter((p) => (p.folderId || 'folder-prototypes') === f.id).length;
            const isSelected = selectedFolderId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectFolder(f.id)}
                className={`px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? 'apple-glass-cta text-white font-bold shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${FOLDER_COLOR_DOT[f.colorAccent].split(' ')[0]}`} />
                <span>{f.name}</span>
                <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        {/* Main 2-Column Body: Left = Ablagen (Folders) Drop Zones | Right = Filter, Sort & Draggable Models */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT SIDEBAR: Ablagen & Projekt-Ordner (Drop Zones) - Hidden on mobile, shown on desktop */}
          <aside className="hidden lg:flex lg:col-span-4 xl:col-span-3 border-r border-slate-200/80 bg-slate-50/70 p-4 flex-col justify-between overflow-y-auto">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Ablagen ({folders.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    setIsCreatingFolder((prev) => !prev);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg apple-glass-btn text-[11px] font-bold text-sky-700 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Neue Ablage</span>
                </button>
              </div>

              {/* Active Dragging Guidance Banner */}
              {draggedProjectObj && (
                <div
                  role="status"
                  className="p-2.5 rounded-2xl bg-sky-50 border border-sky-400/70 text-xs text-sky-800 shadow-xs animate-pulse"
                >
                  <div className="font-bold">Drag &amp; Drop aktiv:</div>
                  <div className="text-[11px] text-sky-700 truncate mt-0.5">
                    „{draggedProjectObj.name}“ auf eine Ablage unten ziehen
                  </div>
                </div>
              )}

              {/* Inline Create Folder Form */}
              {isCreatingFolder && (
                <form
                  onSubmit={handleCreateFolderSubmit}
                  className="p-3 rounded-2xl bg-white border border-sky-200 shadow-sm space-y-2.5"
                >
                  <div className="text-xs font-bold text-slate-900">Neue Ablage erstellen</div>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Name (z.B. Kundenfreigabe Q4)"
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    value={newFolderDesc}
                    onChange={(e) => setNewFolderDesc(e.target.value)}
                    placeholder="Kurzbeschreibung..."
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      {(['sky', 'indigo', 'amber', 'emerald', 'rose'] as CADFolderColor[]).map(
                        (col) => (
                          <button
                            key={col}
                            type="button"
                            aria-label={`Ablage-Farbe ${col}`}
                            onClick={() => setNewFolderColor(col)}
                            className={`w-4 h-4 rounded-full ${
                              FOLDER_COLOR_DOT[col].split(' ')[0]
                            } ${
                              newFolderColor === col
                                ? 'ring-2 ring-offset-1 ring-slate-900 scale-110'
                                : 'opacity-60'
                            } cursor-pointer`}
                          />
                        )
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsCreatingFolder(false)}
                        className="px-2.5 py-1 rounded-lg text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Abbrechen
                      </button>
                      <button
                        type="submit"
                        className="px-3 py-1 rounded-lg apple-glass-cta text-[11px] font-bold cursor-pointer"
                      >
                        Anlegen
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* All Models Button */}
              <button
                type="button"
                onClick={() => {
                  soundEngine.playClick();
                  onSelectFolder('all');
                }}
                className={`w-full p-3 rounded-2xl text-left transition-all flex items-center justify-between cursor-pointer ${
                  selectedFolderId === 'all'
                    ? 'apple-glass-card-active'
                    : 'apple-glass-card hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderKanban className="w-4 h-4 text-sky-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      Alle Modelle &amp; Ablagen
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      Gesamter Workspace-Katalog
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs font-bold shrink-0">
                  {projects.length}
                </span>
              </button>

              {/* Individual Folders List (Interactive Drag-and-Drop Targets) */}
              <div className="space-y-2">
                {folders.map((folder) => {
                  const count = projects.filter(
                    (p) => (p.folderId || 'folder-prototypes') === folder.id
                  ).length;
                  const matchingInFolderCount = hasActiveSearch
                    ? projects.filter(
                        (p) =>
                          (p.folderId || 'folder-prototypes') === folder.id &&
                          getProjectMetadataMatches(p, searchQuery, folders).matches
                      ).length
                    : count;
                  const isSelected = selectedFolderId === folder.id;
                  const isDragHovered = dragOverFolderId === folder.id;
                  const isDraggedAlreadyHere =
                    draggedProjectObj &&
                    (draggedProjectObj.folderId || 'folder-prototypes') === folder.id;
                  const dotClass =
                    FOLDER_COLOR_DOT[folder.colorAccent]?.split(' ')[0] || 'bg-sky-500';
                  const isCustomFolder = !folder.id.startsWith('folder-');

                  return (
                    <div
                      key={folder.id}
                      data-testid={`drop-folder-${folder.id}`}
                      onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                      onDragEnter={(e) => handleFolderDragEnter(e, folder.id)}
                      onDragLeave={(e) => handleFolderDragLeave(e, folder.id)}
                      onDrop={(e) => handleFolderDrop(e, folder)}
                      className={`group rounded-2xl transition-all ${
                        isDragHovered
                          ? 'ring-2 ring-sky-500 bg-sky-50/95 scale-[1.02] shadow-md'
                          : draggedProjectId && !isDraggedAlreadyHere
                          ? 'apple-glass-card border-dashed border-sky-400/70 hover:border-sky-500'
                          : isSelected
                          ? 'apple-glass-card-active'
                          : 'apple-glass-card hover:border-slate-300'
                      }`}
                    >
                      <div className="p-3 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            soundEngine.playClick();
                            onSelectFolder(folder.id);
                          }}
                          className="flex-1 text-left flex items-start gap-2.5 min-w-0 cursor-pointer"
                        >
                          <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${dotClass}`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {folder.name}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                              {isDragHovered
                                ? isDraggedAlreadyHere
                                  ? 'Bereits in dieser Ablage'
                                  : 'Loslassen zum Einsortieren →'
                                : folder.description}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {isDragHovered && !isDraggedAlreadyHere ? (
                            <span className="px-2 py-0.5 rounded-lg bg-sky-600 text-white font-mono text-[10px] font-bold">
                              Ablegen
                            </span>
                          ) : hasActiveSearch ? (
                            <span
                              title={`${matchingInFolderCount} Suchtreffer in dieser Ablage`}
                              className={`px-2 py-0.5 rounded-lg font-mono text-xs font-bold ${
                                matchingInFolderCount > 0
                                  ? 'bg-sky-100 text-sky-700'
                                  : 'bg-slate-100 text-slate-400'
                              }`}
                            >
                              {matchingInFolderCount}/{count}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-mono text-xs font-bold">
                              {count}
                            </span>
                          )}
                          {isCustomFolder && (
                            <button
                              type="button"
                              aria-label={`Ablage ${folder.name} löschen`}
                              onClick={() => {
                                soundEngine.playClick();
                                onDeleteFolder(folder.id);
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Info Note inside Sidebar */}
            <div className="mt-4 pt-3 border-t border-slate-200/80 text-[11px] text-slate-500 leading-relaxed">
              <strong>Drag &amp; Drop:</strong> Ziehen Sie ein Bauteil am Griff-Symbol{' '}
              <GripVertical className="inline w-3 h-3 text-slate-400" /> mit der Maus direkt auf
              eine Ablage links.
            </div>
          </aside>

          {/* RIGHT MAIN PANEL: Filter, Sort, View Toggle & Draggable Models List */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col min-h-0 overflow-hidden">
            {/* Format Filter, Sort & View Mode Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-200/80 bg-white/50 shrink-0">
              {/* Format Filter Tabs */}
              <div className="flex items-center gap-1.5 bg-slate-200/75 p-1 rounded-2xl border border-slate-300/80">
                {(
                  [
                    { id: 'all', label: `Alle (${visibleProjects.length})` },
                    { id: 'scad', label: 'SCAD' },
                    { id: 'stl', label: 'STL' },
                    { id: 'step', label: 'STEP' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      soundEngine.playClick();
                      setFormatFilter(tab.id);
                    }}
                    className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      formatFilter === tab.id
                        ? 'apple-glass-cta text-white font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sort Dropdown + View Switcher */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs">
                  <ArrowUpDown className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <label htmlFor="overview-sort-select" className="text-slate-500 font-medium">
                    Sortieren:
                  </label>
                  <select
                    id="overview-sort-select"
                    value={sortBy}
                    onChange={(e) => {
                      soundEngine.playClick();
                      setSortBy(e.target.value as ModelSortOption);
                    }}
                    className="bg-transparent font-semibold text-slate-900 focus:outline-none cursor-pointer"
                  >
                    <option value="updated">Zuletzt aktualisiert</option>
                    <option value="name_asc">Name (A–Z)</option>
                    <option value="format">Dateiformat (SCAD/STL/STEP)</option>
                    <option value="comments_desc">Meiste 3D-Kommentare</option>
                    <option value="version_desc">Höchste Revision</option>
                  </select>
                </div>

                {/* View Mode Toggle: Detailed Cards vs Compact Table (for 20+ models) */}
                <div className="flex items-center bg-slate-200/75 p-1 rounded-xl border border-slate-300/80">
                  <button
                    type="button"
                    aria-label="Karten-Ansicht"
                    onClick={() => {
                      soundEngine.playClick();
                      setViewMode('cards');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      viewMode === 'cards'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Karten</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Kompakt-Liste für viele Modelle"
                    onClick={() => {
                      soundEngine.playClick();
                      setViewMode('compact');
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      viewMode === 'compact'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Kompakt</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Active Folder & Drag-and-Drop Confirmation Banner */}
            <div className="px-6 py-2 bg-slate-100/80 border-b border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-sky-600" />
                <span className="font-bold text-slate-900">
                  {hasActiveSearch && globalSearchAcrossFolders
                    ? `Globale Suche in allen Ablagen („${searchQuery.trim()}“)`
                    : activeFolderObj
                    ? activeFolderObj.name
                    : 'Alle Ablagen'}
                </span>
                <span className="text-slate-400" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-600">
                  {visibleProjects.length} von {projects.length} Bauteilen angezeigt
                </span>
              </div>

              {dropSuccessMessage ? (
                <div
                  role="status"
                  data-testid="dnd-feedback-banner"
                  className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-800 font-semibold text-[11px]"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{dropSuccessMessage}</span>
                </div>
              ) : (
                <span className="font-mono text-[11px] text-slate-500">
                  Drag &amp; Drop in Ablage oder Klick für 3D-Viewer
                </span>
              )}
            </div>

            {/* Scrollable Draggable Models List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {visibleProjects.length === 0 ? (
                <div className="p-12 text-center rounded-2xl apple-glass-subcard space-y-3">
                  <div className="text-sm font-bold text-slate-700">
                    Keine Bauteile für „{searchQuery}“ gefunden.
                  </div>
                  <p className="text-xs text-slate-500">
                    Prüfen Sie den Suchbegriff oder setzen Sie die globale Suche zurück.
                  </p>
                  {hasActiveSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        soundEngine.playClick();
                        setSearchQuery('');
                      }}
                      className="px-4 py-1.5 rounded-xl apple-glass-cta text-xs font-bold cursor-pointer"
                    >
                      Globale Suche zurücksetzen
                    </button>
                  )}
                </div>
              ) : viewMode === 'compact' ? (
                /* COMPACT TABLE VIEW FOR 20+ MODELS (DRAGGABLE ROWS) */
                <div className="rounded-2xl apple-glass-card overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-4">Bauteil &amp; Metadaten (Ziehbar)</th>
                        <th className="py-3 px-3">Ablage (Sortierung)</th>
                        <th className="py-3 px-3">Stand &amp; Pins</th>
                        <th className="py-3 px-3">Shared-Link Limit</th>
                        <th className="py-3 px-4 text-right">Aktion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {visibleProjects.map((proj) => {
                        const isActive = proj.id === activeProjectId;
                        const isBeingDragged = draggedProjectId === proj.id;
                        const shareValid = evaluateShareLinkValidity(proj.shareConfig?.expiresAtMs);
                        const matchInfo = hasActiveSearch
                          ? getProjectMetadataMatches(proj, searchQuery, folders)
                          : null;

                        return (
                          <tr
                            key={proj.id}
                            draggable
                            data-testid={`draggable-project-${proj.id}`}
                            onDragStart={(e) => handleProjectDragStart(e, proj)}
                            onDragEnd={handleProjectDragEnd}
                            className={`transition-all cursor-grab active:cursor-grabbing ${
                              isBeingDragged
                                ? 'opacity-55 bg-sky-100/80 ring-2 ring-sky-400'
                                : isActive
                                ? 'bg-sky-50/70'
                                : 'hover:bg-slate-50/80'
                            }`}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2.5">
                                <span
                                  title="Per Drag & Drop in eine Ablage links ziehen"
                                  className="text-slate-400 hover:text-sky-600 cursor-grab active:cursor-grabbing shrink-0"
                                >
                                  <GripVertical className="w-4 h-4" />
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    soundEngine.playClick();
                                    onSelectProject(proj.id);
                                    onClose();
                                  }}
                                  className="text-left group cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-sky-700 uppercase">
                                      {proj.format}
                                    </span>
                                    <span className="font-bold text-slate-900 group-hover:text-sky-600 transition-colors">
                                      {proj.name}
                                    </span>
                                    {isActive && (
                                      <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-md">
                                        Aktiv
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    {proj.category} · {proj.author}
                                  </div>
                                  {matchInfo && matchInfo.matchedFields.length > 0 && (
                                    <div className="text-[10px] font-mono font-semibold text-sky-700 mt-1">
                                      Gefunden in: {matchInfo.matchedFields.join(' · ')}
                                    </div>
                                  )}
                                </button>
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <select
                                aria-label={`Ablage für ${proj.name}`}
                                value={proj.folderId || 'folder-prototypes'}
                                onChange={(e) => {
                                  soundEngine.playClick();
                                  onMoveProjectToFolder(proj.id, e.target.value);
                                }}
                                className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:border-sky-500 cursor-pointer"
                              >
                                {folders.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </td>

                            <td className="py-3 px-3 font-mono text-slate-700">
                              v{proj.currentVersion}.0 · {proj.comments.length} Pins
                            </td>

                            <td className="py-3 px-3 font-mono font-semibold">
                              <span
                                className={
                                  proj.isPublicShareEnabled && shareValid.isValid
                                    ? 'text-emerald-700'
                                    : 'text-rose-600'
                                }
                              >
                                {proj.isPublicShareEnabled ? shareValid.remainingLabel : 'Gesperrt'}
                              </span>
                            </td>

                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    soundEngine.playClick();
                                    onSelectProject(proj.id);
                                    onClose();
                                  }}
                                  className="px-3 py-1.5 rounded-xl apple-glass-cta text-xs font-bold whitespace-nowrap cursor-pointer"
                                >
                                  Im 3D-Viewer anzeigen
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    soundEngine.playClick();
                                    onOpenShareModalForProject(proj.id);
                                  }}
                                  className="p-1.5 rounded-xl apple-glass-btn text-slate-700 cursor-pointer"
                                  aria-label={`Shared-Link für ${proj.name}`}
                                >
                                  <Link2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* DETAILED CARDS VIEW (DRAGGABLE CARDS) */
                visibleProjects.map((proj) => {
                  const isActive = proj.id === activeProjectId;
                  const isBeingDragged = draggedProjectId === proj.id;
                  const shareValidity = evaluateShareLinkValidity(proj.shareConfig?.expiresAtMs);
                  const currentPreset = proj.shareConfig?.durationPreset || '24h';
                  const finishMeta = FINISH_LABELS[proj.finish] || FINISH_LABELS.titanium;
                  const openPins = proj.comments.filter((c) => !c.resolved).length;
                  const folderObj =
                    folders.find((f) => f.id === (proj.folderId || 'folder-prototypes')) ||
                    folders[0];
                  const matchInfo = hasActiveSearch
                    ? getProjectMetadataMatches(proj, searchQuery, folders)
                    : null;

                  return (
                    <article
                      key={proj.id}
                      draggable
                      data-testid={`draggable-project-${proj.id}`}
                      onDragStart={(e) => handleProjectDragStart(e, proj)}
                      onDragEnd={handleProjectDragEnd}
                      className={`rounded-2xl p-5 transition-all cursor-grab active:cursor-grabbing ${
                        isBeingDragged
                          ? 'opacity-55 scale-[0.99] ring-2 ring-sky-400 border-dashed bg-sky-50/70'
                          : isActive
                          ? 'apple-glass-card-active'
                          : 'apple-glass-card'
                      }`}
                    >
                      {/* Top Row: Drag Grip, Model Metadata, Folder Selector & Primary Actions */}
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          {/* Tactile Drag Handle */}
                          <div
                            title="Bauteil per Drag & Drop in eine Ablage links ziehen"
                            aria-label={`Ziehgriff für ${proj.name}`}
                            className="mt-1 p-1.5 rounded-xl bg-slate-100/90 hover:bg-sky-100 text-slate-400 hover:text-sky-600 transition-colors cursor-grab active:cursor-grabbing shrink-0"
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>

                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <span className="font-mono font-bold text-sky-700 uppercase">
                                {proj.format}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{proj.category}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-slate-800 font-semibold">
                                Revision v{proj.currentVersion}.0
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1.5 text-slate-700">
                                <span className={`w-2 h-2 rounded-full ${finishMeta.dot}`} />
                                {finishMeta.label}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  soundEngine.playClick();
                                  onSelectProject(proj.id);
                                  onClose();
                                }}
                                className="text-lg font-bold text-slate-900 hover:text-sky-600 font-display tracking-tight text-left transition-colors cursor-pointer"
                              >
                                {proj.name}
                              </button>
                              {isActive && (
                                <span className="text-[11px] font-semibold text-sky-700 bg-sky-100 px-2.5 py-0.5 rounded-lg">
                                  Aktiv im 3D-Viewport
                                </span>
                              )}
                              {matchInfo && matchInfo.matchedFields.length > 0 && (
                                <span
                                  data-testid={`metadata-match-badge-${proj.id}`}
                                  className="text-[11px] font-mono font-semibold text-sky-800 bg-sky-100/90 border border-sky-300 px-2.5 py-0.5 rounded-lg"
                                >
                                  Gefunden in: {matchInfo.matchedFields.join(' · ')}
                                </span>
                              )}
                            </div>

                            {/* Ablage Assignment Dropdown + Drag Hint */}
                            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                              <div className="flex items-center gap-1.5">
                                <Folder className="w-3.5 h-3.5 text-sky-600" />
                                <label
                                  htmlFor={`folder-select-${proj.id}`}
                                  className="text-slate-500 font-medium"
                                >
                                  Ablage:
                                </label>
                                <select
                                  id={`folder-select-${proj.id}`}
                                  value={folderObj?.id || 'folder-prototypes'}
                                  onChange={(e) => {
                                    soundEngine.playClick();
                                    onMoveProjectToFolder(proj.id, e.target.value);
                                  }}
                                  className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:outline-none focus:border-sky-500 cursor-pointer"
                                >
                                  {folders.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <span className="text-slate-300" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-slate-500">Autor: {proj.author}</span>
                              <span className="text-slate-300" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                Parameter: {Object.keys(proj.parameters).slice(0, 3).join(', ')}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Primary Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.playClick();
                              onSelectProject(proj.id);
                              onClose();
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl apple-glass-cta text-xs font-bold cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Im 3D-Viewer anzeigen</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.playClick();
                              onOpenProjectForCommenting(proj.id);
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl apple-glass-btn text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-sky-600" />
                            <span>3D-Pin setzen ({proj.comments.length})</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              soundEngine.playClick();
                              onOpenShareModalForProject(proj.id);
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl apple-glass-btn text-xs font-semibold text-sky-700 cursor-pointer"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>Freigabelink (Zeitlimit)</span>
                          </button>
                        </div>
                      </div>

                      {/* Bottom Row: Time-Limited Share Bar + Direct Inline Commenting */}
                      <div className="mt-4 pt-3.5 border-t border-slate-200/80 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                        {/* Left 5 Cols: Share Link & Time-Limit Switcher */}
                        <div className="lg:col-span-5 p-3 rounded-xl apple-glass-subcard flex flex-col justify-between gap-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                              <Clock className="w-3.5 h-3.5 text-sky-600" />
                              <span>Zeitlimitierter Shared Link:</span>
                            </span>
                            <span
                              className={`font-mono font-bold ${
                                proj.isPublicShareEnabled && shareValidity.isValid
                                  ? 'text-emerald-700'
                                  : 'text-rose-600'
                              }`}
                            >
                              {proj.isPublicShareEnabled
                                ? shareValidity.remainingLabel
                                : 'Deaktiviert'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              {DURATION_BADGES.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => {
                                    soundEngine.playClick();
                                    onQuickUpdateProjectShareDuration(proj.id, preset);
                                  }}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer ${
                                    currentPreset === preset && shareValidity.isValid
                                      ? 'apple-glass-cta text-white font-bold'
                                      : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                                  }`}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopyDirectLink(proj)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg apple-glass-btn text-[11px] font-semibold text-slate-800 cursor-pointer"
                            >
                              {copiedId === proj.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Kopiert</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-sky-600" />
                                  <span>Link kopieren</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Right 7 Cols: Recent Comments & Inline Comment Input */}
                        <div className="lg:col-span-7 space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-600">
                            <span className="font-semibold text-slate-800">
                              3D-Bauteilkommentare ({openPins} offen):
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">
                              Direktkommentar an v{proj.currentVersion}.0
                            </span>
                          </div>

                          {proj.comments.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {proj.comments.slice(-2).map((c) => (
                                <div
                                  key={c.id}
                                  className="p-2 rounded-xl apple-glass-subcard text-xs text-slate-700 truncate"
                                >
                                  <span className="font-bold text-slate-900">{c.authorName}: </span>
                                  <span>{c.text}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={quickCommentDrafts[proj.id] || ''}
                              onChange={(e) =>
                                setQuickCommentDrafts((prev) => ({
                                  ...prev,
                                  [proj.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSendQuickComment(proj.id);
                                }
                              }}
                              placeholder={`Direktkommentar zu ${proj.name.split(' ')[0]}...`}
                              aria-label={`Direktkommentar zu ${proj.name}`}
                              className="flex-1 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleSendQuickComment(proj.id)}
                              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl apple-glass-cta font-bold text-xs cursor-pointer shrink-0"
                            >
                              <Send className="w-3 h-3" />
                              <span>Kommentieren</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
