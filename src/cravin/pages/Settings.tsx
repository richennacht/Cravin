import { useEffect, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettings";
import { applyTheme, getStoredTheme } from "@/lib/utils/theme";
import { SECTIONS_CONFIG } from "@/components/Sidebar";
import AccessibilityPermissions from "@/components/AccessibilityPermissions";
import SecureInputWarning from "@/components/SecureInputWarning";
import type { Theme } from "@/bindings";
import { TRANSLATE_LANGS, langName } from "../lib/demo";
import { inTauri, loadPrefs, savePrefs, type Prefs } from "../lib/runtime";
import { updateLabel, useUpdater } from "../lib/updater";
import { applyCaptureProtection } from "../lib/overlay";
import { getVersion } from "@tauri-apps/api/app";

const ENGINE_SECTIONS = ["general", "advanced", "history", "about"] as const;
type EngineSection = (typeof ENGINE_SECTIONS)[number];
const ENGINE_LABELS: Record<EngineSection, string> = {
  general: "Shortcuts",
  advanced: "Advanced",
  history: "History",
  about: "About",
};

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="cv-row">
      <div className="cv-row-main">
        <div className="cv-row-title">{title}</div>
        {desc && <div className="cv-row-desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Switch({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="cv-switch"
      disabled={disabled}
      style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
      onClick={() => onChange(!on)}
    />
  );
}

export default function Settings() {
  const {
    settings,
    audioDevices,
    updateSetting,
    refreshAudioDevices,
    updateChecksLocked,
  } = useSettings();
  const updater = useUpdater();
  const [version, setVersion] = useState<string>("0.1.0");
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [engine, setEngine] = useState<EngineSection | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    refreshAudioDevices();
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, [refreshAudioDevices]);

  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(next);
  };

  const changeTheme = (value: Theme) => {
    setTheme(value);
    applyTheme(value);
    if (inTauri) updateSetting("theme", value);
  };

  const EngineComponent = engine ? SECTIONS_CONFIG[engine].component : null;

  return (
    <div className="cv-page" style={{ maxWidth: 760 }}>
      <header className="cv-page-head">
        <div>
          <h1 className="cv-title">Settings</h1>
          <p className="cv-subtitle">
            Local by default. Nothing leaves this machine unless you turn it on.
          </p>
        </div>
      </header>

      {inTauri && (
        <div className="flex flex-col gap-3 mb-4">
          <AccessibilityPermissions />
          <SecureInputWarning />
        </div>
      )}

      <h2 className="cv-section-title" style={{ marginTop: 0 }}>
        General
      </h2>
      <div className="cv-list">
        <Row title="Appearance">
          <select
            className="cv-select"
            value={theme}
            onChange={(e) => changeTheme(e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row
          title="Translate into"
          desc="Your language for captions and answers"
        >
          <select
            className="cv-select"
            value={prefs.translateTo}
            onChange={(e) => setPref("translateTo", e.target.value)}
          >
            {TRANSLATE_LANGS.map((l) => (
              <option key={l} value={l}>
                {langName(l)}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <h2 className="cv-section-title">Audio</h2>
      <div className="cv-list">
        <Row title="Microphone" desc="Transcribed as Me">
          <select
            className="cv-select"
            disabled={!inTauri}
            value={settings?.selected_microphone ?? "Default"}
            onChange={(e) =>
              updateSetting("selected_microphone", e.target.value)
            }
          >
            {inTauri ? (
              audioDevices.map((d) => (
                <option key={d.index} value={d.name}>
                  {d.name}
                </option>
              ))
            ) : (
              <option>Default</option>
            )}
          </select>
        </Row>
        <Row
          title="System audio"
          desc="Transcribed as Them. Needs macOS 14.2+ or Windows 10."
        >
          <span className="cv-row-aside">Coming next</span>
        </Row>
      </div>

      <h2 className="cv-section-title">Meetings</h2>
      <div className="cv-list">
        <Row
          title="Suggest answers"
          desc="When the other side finishes a question"
        >
          <Switch
            on={prefs.autoSuggest}
            onChange={(v) => setPref("autoSuggest", v)}
          />
        </Row>
        <Row
          title="Live translation"
          desc="Show a translation under anything not in your language"
        >
          <Switch
            on={prefs.liveTranslate}
            onChange={(v) => setPref("liveTranslate", v)}
          />
        </Row>
      </div>

      <h2 className="cv-section-title">Privacy</h2>
      <div className="cv-list">
        <Row
          title="Consent reminder"
          desc="Remind me to tell people I'm transcribing"
        >
          <Switch
            on={prefs.consentReminder}
            onChange={(v) => setPref("consentReminder", v)}
          />
        </Row>
        <Row
          title="Recording indicator"
          desc="Show a dot while Cravin is listening"
        >
          <Switch
            on={prefs.recordingIndicator}
            onChange={(v) => setPref("recordingIndicator", v)}
          />
        </Row>
        <Row
          title="Hide Cravin from screen share"
          desc="You still see Cravin and its overlay, but Zoom, Meet, Teams and most recorders don't. Reliable on Windows 10 2004+, best effort on macOS, not available on Linux."
        >
          <Switch
            on={prefs.hideFromShare}
            disabled={!inTauri}
            onChange={(v) => {
              setPref("hideFromShare", v);
              applyCaptureProtection(v);
            }}
          />
        </Row>
      </div>

      <h2 className="cv-section-title">Updates</h2>
      <div className="cv-list">
        <Row
          title={`Cravin ${version}`}
          desc={
            inTauri ? updateLabel(updater) : "Updates run in the desktop app"
          }
        >
          {updater.status === "available" ? (
            <button
              type="button"
              className="cv-btn cv-btn-sm cv-btn-primary"
              onClick={updater.install}
            >
              Update and restart
            </button>
          ) : (
            <button
              type="button"
              className="cv-btn cv-btn-sm"
              disabled={
                !inTauri ||
                ["checking", "downloading", "installing"].includes(
                  updater.status,
                )
              }
              onClick={updater.checkNow}
            >
              Check now
            </button>
          )}
        </Row>
        <Row
          title="Check automatically"
          desc={
            updateChecksLocked
              ? "Turned off by your system administrator"
              : "On launch and every few hours"
          }
        >
          <Switch
            on={settings?.update_checks_enabled ?? true}
            disabled={!inTauri || !!updateChecksLocked}
            onChange={(v) => updateSetting("update_checks_enabled", v)}
          />
        </Row>
      </div>

      <h2 className="cv-section-title">Engine</h2>
      <p className="cv-row-desc" style={{ marginTop: -6, marginBottom: 12 }}>
        The transcription engine Cravin is built on (Handy). Its dictation
        shortcut still works.
      </p>
      {inTauri ? (
        <>
          <div className="cv-chips">
            {ENGINE_SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="cv-chip"
                aria-pressed={engine === s}
                onClick={() => setEngine(engine === s ? null : s)}
              >
                {ENGINE_LABELS[s]}
              </button>
            ))}
          </div>
          {EngineComponent && (
            <div className="cv-engine flex flex-col items-center gap-4">
              <EngineComponent />
            </div>
          )}
        </>
      ) : (
        <div className="cv-list">
          <Row title="Engine settings" desc="Available in the desktop app">
            <span className="cv-row-aside">Desktop only</span>
          </Row>
        </div>
      )}
    </div>
  );
}
