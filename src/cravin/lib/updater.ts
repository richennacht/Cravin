import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { commands } from "@/bindings";
import { inTauri } from "./runtime";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "portable"
  | "error";

type UpdaterState = {
  status: UpdateStatus;
  version?: string;
  notes?: string;
  progress: number; // 0-100 while downloading
  lastChecked?: number;
  error?: string;
  checkNow: () => Promise<void>;
  install: () => Promise<void>;
};

let pending: Update | null = null;

/**
 * App updates through the Tauri updater plugin. Releases publish a signed
 * latest.json (tauri-action does this when TAURI_SIGNING_PRIVATE_KEY is set);
 * the app compares versions, downloads, verifies the signature and relaunches.
 */
export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle",
  progress: 0,

  checkNow: async () => {
    if (!inTauri) return;
    const busy = ["checking", "downloading", "installing"];
    if (busy.includes(get().status)) return;
    set({ status: "checking", error: undefined });
    try {
      pending = await check();
      set({
        lastChecked: Date.now(),
        status: pending ? "available" : "up-to-date",
        version: pending?.version,
        notes: pending?.body ?? undefined,
      });
    } catch (e) {
      set({ status: "error", error: String(e), lastChecked: Date.now() });
    }
  },

  install: async () => {
    if (!inTauri || !pending) return;
    if (await commands.isPortable()) {
      // Portable installs can't replace themselves in place.
      set({ status: "portable" });
      return;
    }
    let total = 0;
    let done = 0;
    set({ status: "downloading", progress: 0 });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          set({
            progress: total
              ? Math.min(100, Math.round((done / total) * 100))
              : 0,
          });
        }
        if (event.event === "Finished")
          set({ status: "installing", progress: 100 });
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));

export const updateLabel = (s: UpdaterState): string => {
  switch (s.status) {
    case "checking":
      return "Checking for updates";
    case "up-to-date":
      return "You're up to date";
    case "available":
      return `Version ${s.version} is ready`;
    case "downloading":
      return `Downloading ${s.progress}%`;
    case "installing":
      return "Installing, Cravin will restart";
    case "portable":
      return "Portable build: download the new version from Releases";
    case "error":
      return "Couldn't check for updates";
    default:
      return "Not checked yet";
  }
};
