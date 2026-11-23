import React, { useState } from 'react';
import { UserSession } from '../types/cad';
import { soundEngine } from '../utils/soundEngine';
import { ShieldCheck, Lock, ArrowRight, Layers, Eye } from 'lucide-react';

interface AuthGateModalProps {
  onAuthenticate: (session: UserSession) => void;
  onOpenPublicSharedSample: () => void;
}

export const AuthGateModal: React.FC<AuthGateModalProps> = ({
  onAuthenticate,
  onOpenPublicSharedSample,
}) => {
  const [email, setEmail] = useState('lukas.weber@aethercad.de');
  const [password, setPassword] = useState('••••••••••••••••');
  const [name, setName] = useState('Dr. Lukas Weber');
  const [role, setRole] = useState('Lead CAD Architect');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Bitte eine gültige Engineering-E-Mail-Adresse eingeben.');
      soundEngine.playSecurityAlert();
      return;
    }
    if (password.trim().length < 6) {
      setError('Sicherheitstoken / Passwort muss mindestens 6 Zeichen umfassen.');
      soundEngine.playSecurityAlert();
      return;
    }
    setError('');
    soundEngine.playSuccessChime();
    onAuthenticate({
      email: email.trim(),
      name: name.trim() || 'CAD Ingenieur',
      role: role.trim() || 'Konstruktion',
      authenticatedAt: new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/30">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl apple-glass-panel overflow-hidden">
        {/* Left Column: Engineering Security & Feature Highlights */}
        <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-between bg-gradient-to-br from-sky-50/90 via-white/95 to-slate-100/90 border-b lg:border-b-0 lg:border-r border-slate-200/80">
          <div>
            <div className="flex items-center gap-2.5 text-sky-600 text-xs font-semibold mb-4">
              <Layers className="w-4 h-4" />
              <span>AetherCAD Studio · Spatial WebGL Engineering</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 font-display leading-tight">
              Präzisions-Visualisierung für SCAD, STL &amp; STEP
            </h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Geschützter Engineering-Workspace mit Echtzeit-OpenSCAD-Parametrik, Punkt-zu-Punkt
              3D-Messtechnik, Team-Annotationen direkt am Bauteil und mehrstufiger Upload-Sandbox.
            </p>

            <div className="mt-8 space-y-4 text-xs text-slate-600">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-900">Zero-Trust Upload-Quarantäne</div>
                  <div className="text-slate-500 mt-0.5">
                    Blockiert ausführbare Binärdateien (PE/MZ, ELF, Mach-O) und Skript-Injektionen
                    vor dem Parser-Durchlauf.
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Lock className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-900">
                    Zeitlimitierte Direktlinks ohne Login-Zwang
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Einzelne Bauteil-Stände lassen sich per signiertem Freigabelink mit verbindlichem
                    Ablaufdatum für externe Partner freischalten.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-200/80 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">Externer Prüfer ohne Account?</span>
            <button
              type="button"
              onClick={() => {
                soundEngine.playClick();
                onOpenPublicSharedSample();
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Öffentlichen Freigabelink testen</span>
            </button>
          </div>
        </div>

        {/* Right Column: Login Form */}
        <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-center bg-white/90">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-slate-900 font-display">Workspace-Anmeldung</h2>
            <p className="text-xs text-slate-500 mt-1">
              Melde dich an, um Projekte zu bearbeiten, Dateien zu prüfen und zeitlimitierte
              Freigabelinks zu generieren.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="auth-name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Name &amp; Funktion
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                  placeholder="Dr. Lukas Weber"
                />
                <input
                  id="auth-role"
                  type="text"
                  aria-label="Abteilung oder Rolle"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                  placeholder="Lead CAD Architect"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Engineering E-Mail
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                placeholder="name@firma.de"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Workspace Passwort / Sicherheitsschlüssel
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl bg-white border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-sky-500"
                placeholder="Mindestens 6 Zeichen"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl apple-glass-cta font-semibold text-xs transition-all cursor-pointer"
            >
              <span>Workspace entsperren</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-200/80 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Statischer Webspace-Modus aktiv</span>
            <span>Lokale Ende-zu-Ende Persistenz</span>
          </div>
        </div>
      </div>
    </div>
  );
};
