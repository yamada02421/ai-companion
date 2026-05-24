import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("companion", {
  chat: (message: string) => ipcRenderer.invoke("companion:chat", message),
  trigger: (mode: string) => ipcRenderer.invoke("companion:trigger", mode),
  toggleExpand: () => ipcRenderer.invoke("companion:toggle-expand"),
  getSettings: () => ipcRenderer.invoke("companion:get-settings"),
  saveSettings: (s: any) => ipcRenderer.invoke("companion:save-settings", s),

  onMessage: (cb: (data: { role: string; text: string; mode: string }) => void) => {
    ipcRenderer.on("companion:message", (_e, data) => cb(data));
  },
  onThinking: (cb: (thinking: boolean) => void) => {
    ipcRenderer.on("companion:thinking", (_e, val) => cb(val));
  },
  onExpand: (cb: (expanded: boolean) => void) => {
    ipcRenderer.on("companion:expand", (_e, val) => cb(val));
  },
  onContinuous: (cb: (active: boolean) => void) => {
    ipcRenderer.on("companion:continuous", (_e, val) => cb(val));
  },
  onCharacter: (cb: (data: { name: string }) => void) => {
    ipcRenderer.on("companion:character", (_e, data) => cb(data));
  },
  onShowSettings: (cb: (show: boolean) => void) => {
    ipcRenderer.on("companion:show-settings", (_e, val) => cb(val));
  },
});
