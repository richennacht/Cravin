import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { inTauri, loadPrefs } from "./runtime";

export const OVERLAY_LABEL = "assist";
export const ANSWERS_EVENT = "cravin://answers";
export const ASK_EVENT = "cravin://ask";

/**
 * Keep Cravin's windows out of screen shares and recordings while they stay
 * visible on the user's own display. Tauri maps this to
 * SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) on Windows 10 2004+ and
 * NSWindow.sharingType = .none on macOS. macOS honours it only partly: some
 * ScreenCaptureKit-based capture can still pick the window up. Linux has no
 * equivalent, so the call is a no-op there.
 */
export const applyCaptureProtection = async (enabled: boolean) => {
  if (!inTauri) return;
  const targets = [getCurrentWindow(), await Window.getByLabel(OVERLAY_LABEL)];
  await Promise.all(
    targets.map((w) => w?.setContentProtected(enabled).catch(() => {})),
  );
};

export const isOverlayOpen = async () =>
  inTauri && (await WebviewWindow.getByLabel(OVERLAY_LABEL)) !== null;

/** Open the floating assist overlay, or close it if it's already up. */
export const toggleOverlay = async () => {
  if (!inTauri) return;
  const existing = await WebviewWindow.getByLabel(OVERLAY_LABEL);
  if (existing) {
    await existing.close();
    return;
  }
  const { hideFromShare } = loadPrefs();
  new WebviewWindow(OVERLAY_LABEL, {
    url: "src/cravin/overlay/index.html",
    title: "Cravin Assist",
    width: 360,
    height: 460,
    minWidth: 280,
    minHeight: 200,
    alwaysOnTop: true,
    decorations: false,
    transparent: true,
    shadow: false,
    skipTaskbar: true,
    resizable: true,
    focus: false,
    contentProtected: hideFromShare,
  });
};
