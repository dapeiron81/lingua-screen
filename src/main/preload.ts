import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, SessionConfig, SubtitleSegment } from '../shared/types';

// Keep the preload self-contained. Sandboxed Electron preload scripts cannot
// require arbitrary local modules, so importing ../shared/ipc breaks the bridge.
const IPC = {
  listSources: 'sources:list', startSession: 'session:start', stopSession: 'session:stop',
  getSession: 'session:get', audioChunk: 'audio:chunk', subtitleUpdated: 'subtitle:updated',
  sessionStatus: 'session:status', overlayToggle: 'overlay:toggle', overlaySettings: 'overlay:settings',
  exportSubtitles: 'subtitles:export', listSessions: 'sessions:list', saveSegment: 'segment:save',
  providerStatus: 'provider:status',
  getStorageSettings: 'storage:get-settings', chooseTemporaryDirectory: 'storage:choose-temporary-directory',
  chooseLocalMedia: 'batch:choose-local-media', startBatchSubtitle: 'batch:start-subtitle',
  batchProgress: 'batch:progress', getBatchDefaults: 'batch:get-defaults',
} as const;

contextBridge.exposeInMainWorld('subtitleAPI', {
  listSources: () => ipcRenderer.invoke(IPC.listSources),
  startSession: (config: SessionConfig) => ipcRenderer.invoke(IPC.startSession, config),
  stopSession: () => ipcRenderer.invoke(IPC.stopSession),
  getSession: () => ipcRenderer.invoke(IPC.getSession),
  sendAudioChunk: (payload: unknown) => ipcRenderer.send(IPC.audioChunk, payload),
  onSubtitle: (callback: (segment: SubtitleSegment) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, segment: SubtitleSegment) => callback(segment);
    ipcRenderer.on(IPC.subtitleUpdated, listener);
    return () => ipcRenderer.off(IPC.subtitleUpdated, listener);
  },
  onStatus: (callback: (snapshot: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot);
    ipcRenderer.on(IPC.sessionStatus, listener);
    return () => ipcRenderer.off(IPC.sessionStatus, listener);
  },
  toggleOverlay: (show: boolean) => ipcRenderer.invoke(IPC.overlayToggle, show),
  updateOverlay: (settings: Partial<AppSettings['overlay']>) => ipcRenderer.invoke(IPC.overlaySettings, settings),
  exportSubtitles: (format: 'srt' | 'vtt' | 'txt') => ipcRenderer.invoke(IPC.exportSubtitles, format),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  saveSegment: (segment: SubtitleSegment) => ipcRenderer.invoke(IPC.saveSegment, segment),
  providerStatus: () => ipcRenderer.invoke(IPC.providerStatus),
  getStorageSettings: () => ipcRenderer.invoke(IPC.getStorageSettings),
  chooseTemporaryDirectory: () => ipcRenderer.invoke(IPC.chooseTemporaryDirectory),
  chooseLocalMedia: () => ipcRenderer.invoke(IPC.chooseLocalMedia),
  startBatchSubtitle: (request: unknown) => ipcRenderer.invoke(IPC.startBatchSubtitle, request),
  getBatchDefaults: () => ipcRenderer.invoke(IPC.getBatchDefaults),
  onBatchProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on(IPC.batchProgress, listener);
    return () => ipcRenderer.off(IPC.batchProgress, listener);
  },
});
