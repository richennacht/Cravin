import { useState, type ReactNode } from "react";
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
        {page === "translate" && <Translate session={session} />}
        {page === "models" && <Models />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
