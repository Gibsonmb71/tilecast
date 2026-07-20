import { contextBridge, ipcRenderer } from "electron";

/** Minimal, typed bridge; the renderer has no Node access. */
contextBridge.exposeInMainWorld("tilecast", {
  onPresent(callback: (presentation: unknown) => void): void {
    ipcRenderer.on("present", (_event, presentation) => callback(presentation));
  },
  onIdentify(
    callback: (data: { name: string; durationSeconds: number }) => void,
  ): void {
    ipcRenderer.on("identify", (_event, data) => callback(data));
  },
  onRetryItem(callback: () => void): void {
    ipcRenderer.on("retry-item", () => callback());
  },
  onSkipItem(callback: () => void): void {
    ipcRenderer.on("skip-item", () => callback());
  },
  reportProgress(itemId: string | null, kind: string): void {
    ipcRenderer.send("progress", { itemId, kind });
  },
  reportPlaybackError(itemId: string | null, message: string): void {
    ipcRenderer.send("playback-error", { itemId, message });
  },
  reportWebsiteRecovered(): void {
    ipcRenderer.send("website-recovered");
  },
  submitServerUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("setup-server-url", url);
  },
  onDiscoveredServer(
    callback: (server: { name: string; serverUrl: string }) => void,
  ): void {
    ipcRenderer.on("discovered-server", (_event, server) => callback(server));
  },
  listDiscoveredServers(): Promise<{ name: string; serverUrl: string }[]> {
    return ipcRenderer.invoke("list-discovered-servers");
  },
});
