import React, { useState } from 'react';
import {
  MaterialFinish,
  ShareDurationPreset,
  StudioTheme,
  UserSession,
  WorkspaceSettings,
} from '../types/cad';
import { soundEngine } from '../utils/soundEngine';
import {
  Settings,
  UserCheck,
  Clock,
  Sliders,
  ShieldCheck,
  X,
  Check,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';

interface SettingsModalProps {
  settings: WorkspaceSettings;
  userSession: UserSession | null;
  onUpdateSettings: (next: WorkspaceSettings) => void;
  onUpdateUserSession: (next: UserSession) => void;
  onResetWorkspaceData: () => void;
  onClose: () => void;
}

const DURATION_PRESETS: { value: ShareDurationPreset; label: string; desc: string }[] = [
  { value: '1h', label: '1 Stunde', desc: 'Strenges Kurzzeit-Limit' },
  { value: '24h', label: '24 Stunden', desc: 'Empfohlener Tages-Standard' },
  { value: '7d', label: '7 Tage', desc: 'Wochen-Sprint-Freigabe' },
  { value: '30d', label: '30 Tage', desc: 'Maximale Laufzeit' },
];

const STUDIO_THEMES: { value: StudioTheme; label: string; desc: string }[] = [
  {
    value: 'vision_spatial',
    label: 'Apple Daylight Studio',
    desc: 'Helles Alabaster-Studio mit weichem Tageslicht & Turntable-Ringen',
  },
  {
    value: 'titanium_dark',
    label: 'Silver Precision Lab',
    desc: 'Reines Weißglas-Labor mit neutraler Studio-Ausleuchtung',
  },
  {
    value: 'blueprint_cryo',
    label: 'Cryo Blueprint Light',
    desc: 'Helle technische Blaupausen-Atmosphäre für Präzisions-Bemaßung',
  },
];

const FINISH_OPTIONS: { value: MaterialFinish; label: string }[] = [
  { value: 'titanium', label: 'Titan Grade 5 (Gebürstet)' },
  { value: 'anodized_blue', label: 'Eloxal Aluminium Blau' },
  { value: 'matte_polymer', label: 'SLS Nylon / Matte Polymer' },
  { value: 'frosted_glass', label: 'Acrylglas / Optik-Prüfung' },
  { value: 'brushed_gold', label: 'Messing / Bronze-Legierung' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  userSession,
  onUpdateSettings,
  onUpdateUserSession,
  onResetWorkspaceData,
  onClose,
}) => {
  const [nameDraft, setNameDraft] = useState(userSession?.name || 'Dr. Lukas Weber');
  const [emailDraft, setEmailDraft] = useState(
    userSession?.email || 'lukas.weber@aethercad.de'
  );
  const [roleDraft, setRoleDraft] = useState(userSession?.role || 'Lead CAD Architect');
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    soundEngine.playSuccessChime();
    onUpdateUserSession({
      name: nameDraft.trim() || 'Dr. Lukas Weber',
      email: emailDraft.trim() || 'lukas.weber@aethercad.de',
      role: roleDraft.trim() || 'Lead CAD Architect',
      authenticatedAt: userSession?.authenticatedAt || 'Aktiv',
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const currentTheme = settings.studioTheme || 'vision_spatial';

  return (
    <div className="fixed inset-0 top-14 z-40 flex items-center justify-center p-4 sm:p-6 bg-slate-900/25">
      <div
        role="dialog"
        aria-label="Einstellungsmenü"
        className="w-full max-w-4xl max-h-[86vh] flex flex-col rounded-3xl apple-glass-panel text-slate-900 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white/60">
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-sky-600" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 font-display tracking-tight">
                Apple-Glass Kontrollzentrum &amp; Einstellungen
              </h2>
              <p className="text-xs text-slate-500">
                3D-Studio-Atmosphäre, verbindliche Shared-Link-Zeitlimits, Maßeinheiten, Audio &amp;
                Zero-Trust-Sicherheit
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Einstellungen schließen"
            onClick={onClose}
            className="p-2 rounded-xl apple-glass-btn text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Section 1: 3D Studio Atmosphere & Turntable */}
          <section className="p-4 rounded-2xl apple-glass-subcard space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-600 uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                <span>3D-Studio-Atmosphäre &amp; Spatial Lighting</span>
              </div>
              <span className="text-[11px] font-mono text-slate-500">Echtzeit-WebGL-Vorschau</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {STUDIO_THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      studioTheme: theme.value,
                    });
                  }}
                  className={`p-3.5 rounded-2xl text-left transition-all cursor-pointer ${
                    currentTheme === theme.value
                      ? 'apple-glass-card-active'
                      : 'apple-glass-card hover:border-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold text-slate-900 font-display">{theme.label}</div>
                  <div className="text-[11px] text-slate-600 mt-1 leading-snug">{theme.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Section 2: Mandatory Share Link Expiration Policy */}
          <section className="p-4 rounded-2xl apple-glass-subcard space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-sky-600 uppercase tracking-wider">
              <Clock className="w-4 h-4" />
              <span>Freigabelink-Richtlinie (Immer mit zeitlichem Limit)</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Unbegrenzt gültige öffentliche Links sind systemweit deaktiviert. Wählen Sie das
              Standard-Ablaufzeitlimit für neu erstellte Shared Links:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      defaultShareDuration: preset.value,
                    });
                  }}
                  className={`p-3 rounded-2xl text-left transition-all cursor-pointer ${
                    settings.defaultShareDuration === preset.value
                      ? 'apple-glass-card-active'
                      : 'apple-glass-card hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-bold text-slate-900 font-display">{preset.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{preset.desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Section 3: 3D CAD Viewport, Units & Audio Synthesizer */}
          <section className="p-4 rounded-2xl apple-glass-subcard space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-sky-600 uppercase tracking-wider">
              <Sliders className="w-4 h-4" />
              <span>Bemaßungs-Einheiten, Werkstoffe &amp; Akustik</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="settings-unit-select"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Standard-Maßeinheit im Viewport
                </label>
                <select
                  id="settings-unit-select"
                  value={settings.unitSystem}
                  onChange={(e) => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      unitSystem: e.target.value as 'mm' | 'inch',
                    });
                  }}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                >
                  <option value="mm">Metrisch — Millimeter (mm / cm³)</option>
                  <option value="inch">Imperial — Zoll (in / in³)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="settings-finish-select"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Standard-Oberflächenmaterial für Datei-Importe
                </label>
                <select
                  id="settings-finish-select"
                  value={settings.defaultMaterialFinish}
                  onChange={(e) => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      defaultMaterialFinish: e.target.value as MaterialFinish,
                    });
                  }}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                >
                  {FINISH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-center justify-between p-3 rounded-xl apple-glass-card text-xs cursor-pointer">
                <span className="text-slate-800 font-medium">
                  Konstruktionsgitter &amp; Turntable-Ringe
                </span>
                <input
                  type="checkbox"
                  checked={settings.showGridFloor}
                  onChange={() => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      showGridFloor: !settings.showGridFloor,
                    });
                  }}
                  className="accent-sky-600 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl apple-glass-card text-xs cursor-pointer">
                <span className="text-slate-800 font-medium">
                  360° Präsentations-Rotation (Turntable)
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(settings.autoTurntable)}
                  onChange={() => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      autoTurntable: !settings.autoTurntable,
                    });
                  }}
                  className="accent-sky-600 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl apple-glass-card text-xs cursor-pointer">
                <span className="text-slate-800 font-medium">
                  Maßbox (Bounding Box) automatisch zeigen
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoBoundingBoxOnLoad}
                  onChange={() => {
                    soundEngine.playClick();
                    onUpdateSettings({
                      ...settings,
                      autoBoundingBoxOnLoad: !settings.autoBoundingBoxOnLoad,
                    });
                  }}
                  className="accent-sky-600 rounded cursor-pointer"
                />
              </label>

              <div className="flex items-center justify-between p-3 rounded-xl apple-glass-card text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.soundEffectsEnabled}
                    onChange={() => {
                      const next = !settings.soundEffectsEnabled;
                      soundEngine.enabled = next;
                      if (next) soundEngine.playClick();
                      onUpdateSettings({
                        ...settings,
                        soundEffectsEnabled: next,
                      });
                    }}
                    className="accent-sky-600 rounded cursor-pointer"
                  />
                  <span className="text-slate-800 font-medium">Web-Audio Synthesizer Sounds</span>
                </label>
                <button
                  type="button"
                  onClick={() => soundEngine.playSuccessChime()}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg apple-glass-btn text-[11px] font-medium text-sky-700 cursor-pointer"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Testton</span>
                </button>
              </div>
            </div>
          </section>

          {/* Section 4: Logged-in User Profile */}
          <section className="p-4 rounded-2xl apple-glass-subcard space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-sky-600 uppercase tracking-wider">
              <UserCheck className="w-4 h-4" />
              <span>Aktives Ingenieur-Profil (Autoren-Kennung für 3D-Kommentare)</span>
            </div>

            <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="profile-name-input"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Name
                </label>
                <input
                  id="profile-name-input"
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-role-input"
                  className="block text-[11px] font-medium text-slate-600 mb-1"
                >
                  Rolle / Abteilung
                </label>
                <input
                  id="profile-role-input"
                  type="text"
                  value={roleDraft}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl apple-glass-cta font-bold text-xs cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{savedNotice ? 'Profil gespeichert' : 'Profil übernehmen'}</span>
                </button>
              </div>
            </form>
          </section>

          {/* Section 5: Zero-Trust Upload Firewall & Local Storage Reset */}
          <section className="p-4 rounded-2xl apple-glass-subcard flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Zero-Trust Upload-Quarantäne &amp; Statischer Webspace-Speicher</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Blockiert ausführbare Binärdateien (PE/MZ, ELF, Skripte) vor dem WebGL-Parsing.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onResetWorkspaceData();
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl apple-glass-btn hover:border-rose-300 text-xs font-medium text-slate-700 hover:text-rose-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Demo-Bauteile auf Werkseinstellung zurücksetzen</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
