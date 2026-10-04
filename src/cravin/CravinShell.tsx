import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Boxes,
  House,
  Languages,
  Radio,
  Settings as SettingsIcon,
} from "lucide-react";
import "./cravin.css";
import { inTauri } from "./lib/runtime";
import { useSession } from "./lib/useSession";
import { useUpdater } from "./lib/updater";
import {
  startTranslationListener,
  useTranslationActive,
} from "./lib/translations";
import { emitTo, listen } from "@tauri-apps/api/event";
import { loadPrefs } from "./lib/runtime";
import {
  ANSWERS_EVENT,
  ASK_EVENT,
  OVERLAY_LABEL,
  applyCaptureProtection,
} from "./lib/overlay";
import { useSettings } from "@/hooks/useSettings";
import Home from "./pages/Home";
import Live from "./pages/Live";
import Translate from "./pages/Translate";
import Models from "./pages/Models";
import Settings from "./pages/Settings";

export type Page = "home" | "live" | "translate" | "models" | "settings";

type NavItem = { id: Page; label: string; icon: ReactNode };

const BROWSE: NavItem[] = [
  { id: "home", label: "Meetings", icon: <House size={15} /> },
  { id: "live", label: "Live", icon: <Radio size={15} /> },
  { id: "translate", label: "Translate", icon: <Languages size={15} /> },
];

const SETUP: NavItem[] = [
  { id: "models", label: "Models", icon: <Boxes size={15} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={15} /> },
];

export default function CravinShell() {
  const [page, setPage] = useState<Page>("home");
  const session = useSession();
  const updater = useUpdater();
  const translating = useTranslationActive();
  const { settings, isLoading, updateChecksLocked } = useSettings();
  const autoUpdate =
    inTauri &&
    !isLoading &&
    updateChecksLocked === false &&
    (settings?.update_checks_enabled ?? false);

  // Collect language hotkey results even while another page is open.
  useEffect(startTranslationListener, []);

  // Keep this window out of screen shares if the user asked for that.
  useEffect(() => {
    applyCaptureProtection(loadPrefs().hideFromShare);
  }, []);

  // Feed the floating overlay and take questions typed into it.
  useEffect(() => {
    if (!inTauri) return;
    emitTo(OVERLAY_LABEL, ANSWERS_EVENT, session.answers).catch(() => {});
  }, [session.answers]);

  const askRef = useRef(session.ask);
  askRef.current = session.ask;
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = listen<string>(ASK_EVENT, (e) =>
      askRef.current(e.payload),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Check on launch, then every six hours while the app stays open.
  useEffect(() => {
    if (!autoUpdate) return;
    useUpdater.getState().checkNow();
    const id = window.setInterval(
      () => useUpdater.getState().checkNow(),
      6 * 60 * 60 * 1000,
    );
    return () => window.clearInterval(id);
  }, [autoUpdate]);

  const navButton = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      className="cv-nav-item"
      aria-current={page === item.id ? "page" : undefined}
      onClick={() => setPage(item.id)}
      title={item.label}
    >
      {item.icon}
      <span className="cv-hide-narrow">{item.label}</span>
      {item.id === "live" && session.running && (
        <span className="cv-dot cv-dot-live" />
      )}
      {item.id === "translate" && translating && (
        <span className="cv-dot cv-dot-live" />
      )}
    </button>
  );

  return (
    <div className="cv-app">
      <aside className="cv-sidebar">
        <div className="cv-brand">
          <span className="cv-brand-mark" />
          <span className="cv-hide-narrow">Cravin</span>
        </div>
        <nav className="cv-nav-group">
          <div className="cv-nav-label cv-hide-narrow">Browse</div>
          {BROWSE.map(navButton)}
        </nav>
        <nav className="cv-nav-group">
          <div className="cv-nav-label cv-hide-narrow">Setup</div>
          {SETUP.map(navButton)}
        </nav>
        {(updater.status === "available" ||
          updater.status === "downloading" ||
          updater.status === "installing") && (
          <button
            type="button"
            className="cv-update cv-hide-narrow"
            onClick={updater.install}
            disabled={updater.status !== "available"}
          >
            <span className="cv-update-title">
              {updater.status === "available"
                ? "Update available"
                : updater.status === "downloading"
                  ? `Downloading ${updater.progress}%`
                  : "Restarting"}
            </span>
            <span className="cv-update-sub">
              {updater.status === "available"
                ? `Install ${updater.version} and restart`
                : "Hang tight"}
            </span>
            {updater.status === "downloading" && (
              <span className="cv-progress" style={{ width: "100%" }}>
                <span style={{ width: `${updater.progress}%` }} />
              </span>
            )}
          </button>
        )}
        <div className="cv-sidebar-foot cv-hide-narrow">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="cv-dot cv-dot-ok" /> Local only
          </span>
          <span>{inTauri ? "Desktop" : "Browser preview"}</span>
        </div>
      </aside>

      <main className="cv-main">
        {page === "home" && (
          <Home
            onOpenLive={() => {
              setPage("live");
            }}
            onNewSession={() => {
              session.reset();
              session.start();
              setPage("live");
            }}
          />
        )}
        {page === "live" && <Live session={session} />}
        {page === "translate" && (
          <Translate onOpenModels={() => setPage("models")} />
        )}
        {page === "models" && <Models />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
