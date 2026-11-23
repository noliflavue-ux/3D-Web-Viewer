import React, { useState } from 'react';
import { CADModelProject, ShareDurationPreset, ShareLinkConfig } from '../types/cad';
import { DEFAULT_SHARE_CONFIG, encodeShareUrl } from '../utils/defaultProjects';
import { computeShareExpiryTimestamp, evaluateShareLinkValidity } from '../utils/cadParser';
import { soundEngine } from '../utils/soundEngine';
import {
  Link2,
  Copy,
  Check,
  Eye,
  Lock,
  X,
  Clock,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

interface ShareLinkModalProps {
  project: CADModelProject;
  allProjects?: CADModelProject[];
  defaultDurationPreset: ShareDurationPreset;
  onClose: () => void;
  onSelectProject?: (projectId: string) => void;
  onTogglePublicAccess: (enabled: boolean) => void;
  onUpdateShareConfig: (config: ShareLinkConfig, regenerateToken?: boolean) => void;
  onEnterPublicPreview: () => void;
}

const DURATION_OPTIONS: {
  preset: ShareDurationPreset;
  label: string;
  sublabel: string;
}[] = [
  { preset: '1h', label: '1 Stunde', sublabel: 'Express-Prüfung' },
  { preset: '24h', label: '24 Stunden', sublabel: 'Tagesfreigabe' },
  { preset: '7d', label: '7 Tage', sublabel: 'Sprint-Review' },
  { preset: '30d', label: '30 Tage', sublabel: 'Max. Laufzeit' },
];

export const ShareLinkModal: React.FC<ShareLinkModalProps> = ({
  project,
  allProjects = [],
  defaultDurationPreset,
  onClose,
  onSelectProject,
  onTogglePublicAccess,
  onUpdateShareConfig,
  onEnterPublicPreview,
}) => {
  const [copied, setCopied] = useState(false);

  const currentConfig: ShareLinkConfig = project.shareConfig || {
    ...DEFAULT_SHARE_CONFIG,
    durationPreset: defaultDurationPreset,
    expiresAtMs: computeShareExpiryTimestamp(defaultDurationPreset),
  };

  const validity = evaluateShareLinkValidity(currentConfig.expiresAtMs);
  const shareUrl = encodeShareUrl({
    ...project,
    shareConfig: currentConfig,
  });

  const handleSelectDuration = (preset: ShareDurationPreset) => {
    soundEngine.playClick();
    const nextExpiresAt = computeShareExpiryTimestamp(preset);
    onUpdateShareConfig(
      {
        ...currentConfig,
        durationPreset: preset,
        expiresAtMs: nextExpiresAt,
      },
      false
    );
  };

  const handleTogglePermission = (
    key: 'allowGuestComments' | 'allowGuestMeasurements' | 'allowGuestDownload'
  ) => {
    soundEngine.playClick();
    onUpdateShareConfig(
      {
        ...currentConfig,
        [key]: !currentConfig[key],
      },
      false
    );
  };

  const handleRegenerateWithFreshTimer = () => {
    soundEngine.playSuccessChime();
    const freshExpiry = computeShareExpiryTimestamp(currentConfig.durationPreset);
    onUpdateShareConfig(
      {
        ...currentConfig,
        expiresAtMs: freshExpiry,
      },
      true
    );
  };

  const handleSimulateExpiredLink = () => {
    soundEngine.playSecurityAlert();
    onUpdateShareConfig(
      {
        ...currentConfig,
        expiresAtMs: Date.now() - 60 * 1000,
      },
      false
    );
  };

  const handleCopy = () => {
    if (!validity.isValid) {
      soundEngine.playSecurityAlert();
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setCopied(true);
    soundEngine.playSuccessChime();
    setTimeout(() => setCopied(false), 2500);
  };

  const formattedExpiryDate = new Date(currentConfig.expiresAtMs).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 top-14 z-40 flex items-center justify-center p-4 sm:p-6 bg-slate-900/25">
      <div
        role="dialog"
        aria-label="Zeitlimitierten Freigabelink erstellen"
        className="w-full max-w-3xl max-h-[86vh] flex flex-col rounded-3xl apple-glass-panel text-slate-900 overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-white/60">
          <div className="flex items-center gap-2.5">
            <Link2 className="w-5 h-5 text-sky-600" />
            <div>
              <h2 className="text-lg font-bold text-slate-900 font-display tracking-tight">
                Shared-Links &amp; Verbindliche Zeitlimit-Zentrale
              </h2>
              <p className="text-xs text-slate-600">
                Öffentliche Gast-Links ohne Login-Sperre — immer geschützt durch ein automatisches
                Ablaufdatum
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dialog schließen"
            onClick={onClose}
            className="p-2 rounded-xl apple-glass-btn text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Scalable Model Selector for 20+ Models */}
          {allProjects.length > 1 && (
            <div className="p-3.5 rounded-2xl apple-glass-subcard flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor="share-modal-project-select"
                className="text-xs font-bold text-slate-700"
              >
                Bauteil für Freigabelink auswählen ({allProjects.length} Modelle verfügbar):
              </label>
              <select
                id="share-modal-project-select"
                value={project.id}
                onChange={(e) => {
                  soundEngine.playClick();
                  onSelectProject?.(e.target.value);
                }}
                className="flex-1 min-w-[240px] rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                {allProjects.map((p) => {
                  const pVal = evaluateShareLinkValidity(p.shareConfig?.expiresAtMs);
                  return (
                    <option key={p.id} value={p.id}>
                      [{p.format.toUpperCase()}] {p.name} —{' '}
                      {p.isPublicShareEnabled ? pVal.remainingLabel : 'Gesperrt'}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Active Model Master Status Card */}
          <div className="p-4 rounded-2xl apple-glass-card flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-sky-700 font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  Aktives Bauteil: {project.name} (Revision v{project.currentVersion}.0)
                </span>
              </div>
              <div className="text-xs text-slate-600 mt-1">
                {project.isPublicShareEnabled
                  ? `Signierter Gast-Token aktiv · Verfällt am ${formattedExpiryDate} Uhr (${validity.remainingLabel})`
                  : 'Dieser Link ist gesperrt · Zugriff nur mit verifiziertem Team-Login'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onTogglePublicAccess(!project.isPublicShareEnabled);
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                project.isPublicShareEnabled
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-400'
                  : 'bg-slate-200 text-slate-600 border border-slate-300'
              }`}
            >
              {project.isPublicShareEnabled ? 'Freigegeben' : 'Gesperrt'}
            </button>
          </div>

          {project.isPublicShareEnabled ? (
            <div className="space-y-4">
              {/* Mandatory Time Limit Selector */}
              <div className="p-4 rounded-2xl apple-glass-subcard space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-sky-600" />
                    <span>Verbindliches Zeitlimit festlegen (Pflichtangabe)</span>
                  </span>
                  <span
                    className={`text-xs font-mono font-bold ${
                      validity.isValid ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    {validity.isValid
                      ? `Gültig bis ${formattedExpiryDate} (${validity.remainingLabel})`
                      : 'Link-Zeitlimit abgelaufen'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {DURATION_OPTIONS.map((opt) => {
                    const isSelected =
                      currentConfig.durationPreset === opt.preset && validity.isValid;
                    return (
                      <button
                        key={opt.preset}
                        type="button"
                        onClick={() => handleSelectDuration(opt.preset)}
                        className={`p-3 rounded-2xl text-left transition-all cursor-pointer ${
                          isSelected ? 'apple-glass-card-active' : 'apple-glass-card'
                        }`}
                      >
                        <div className="text-sm font-bold text-slate-900 font-display">
                          {opt.label}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">{opt.sublabel}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Granular Guest Permissions */}
              <div className="p-4 rounded-2xl apple-glass-subcard space-y-2.5">
                <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-sky-600" />
                  <span>Gast-Berechtigungen während der Gültigkeitsdauer</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl apple-glass-card text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentConfig.allowGuestComments}
                      onChange={() => handleTogglePermission('allowGuestComments')}
                      className="accent-sky-600 rounded cursor-pointer"
                    />
                    <span>3D-Kommentare erlauben</span>
                  </label>

                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl apple-glass-card text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentConfig.allowGuestMeasurements}
                      onChange={() => handleTogglePermission('allowGuestMeasurements')}
                      className="accent-sky-600 rounded cursor-pointer"
                    />
                    <span>2-Punkt-Messung erlauben</span>
                  </label>

                  <label className="flex items-center gap-2.5 p-2.5 rounded-xl apple-glass-card text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentConfig.allowGuestDownload}
                      onChange={() => handleTogglePermission('allowGuestDownload')}
                      className="accent-sky-600 rounded cursor-pointer"
                    />
                    <span>CAD-Export erlauben</span>
                  </label>
                </div>
              </div>

              {/* Generated Signed URL */}
              <div className="p-4 rounded-2xl apple-glass-subcard space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="public-share-url-input"
                    className="block text-xs font-bold text-slate-800"
                  >
                    Signierter Direktlink (inkl. Ablauf-Zeitstempel &amp; Berechtigungen):
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleRegenerateWithFreshTimer}
                      className="flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900 font-semibold cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Neuen Token &amp; Timer starten</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSimulateExpiredLink}
                      className="text-xs text-amber-700 hover:text-amber-900 font-semibold cursor-pointer"
                    >
                      Ablauf simulieren
                    </button>
                  </div>
                </div>

                {validity.isValid ? (
                  <div className="flex items-center gap-2">
                    <input
                      id="public-share-url-input"
                      type="text"
                      readOnly
                      value={shareUrl}
                      className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-xs font-mono text-sky-800 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl apple-glass-cta font-bold text-xs text-white shrink-0 cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? 'Kopiert' : 'Link kopieren'}</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 flex items-center justify-between gap-3 text-xs text-rose-900">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>
                        Dieser Freigabelink ist abgelaufen. Bitte wählen Sie oben ein neues
                        Zeitlimit (1h, 24h, 7d oder 30d), um den Link wieder freizuschalten.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectDuration(currentConfig.durationPreset)}
                      className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shrink-0 cursor-pointer"
                    >
                      Jetzt erneuern
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-600">
                  Ansicht aus Perspektive eines externen Projektpartners ohne Login testen:
                </span>
                <button
                  type="button"
                  disabled={!validity.isValid}
                  onClick={() => {
                    soundEngine.playClick();
                    onEnterPublicPreview();
                  }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl apple-glass-btn text-xs font-bold cursor-pointer ${
                    validity.isValid
                      ? 'text-sky-700 hover:text-slate-900'
                      : 'text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Als externer Gast öffnen (ohne Login)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl apple-glass-subcard flex items-center gap-3 text-xs text-slate-600">
              <Lock className="w-4 h-4 text-rose-600 shrink-0" />
              <span>
                Dieser Direktlink ist aktuell gesperrt. Nur angemeldete Benutzer können das Bauteil
                einsehen.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
