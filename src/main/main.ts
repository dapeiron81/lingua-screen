import 'dotenv/config';
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../shared/ipc';
import type { AppSettings, AudioChunk, SessionConfig, SessionSnapshot, SubtitleSegment } from '../shared/types';
import { exportSubtitles } from './exporter';
import { createProvider, type ProviderAdapter } from './provider';
import { SessionStore } from './store';
import { translateStableSegment } from './translator';
import { StorageSettingsService } from './storage-settings';
import { generateBatchSubtitles } from './batch-provider';
import type { BatchSubtitleRequest } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let active: SessionSnapshot | null = null;
let provider: ProviderAdapter = createProvider();
const store = new SessionStore();
const storageSettings = new StorageSettingsService();
let overlaySettings: AppSettings['overlay'] = { alwaysOnTop: true, clickThrough: false, opacity: 0.92, fontSize: 30, bilingual: true };

function rendererUrl(route = '') {
  const dev = process.env.VITE_DEV_SERVER_URL;
  return dev ? `${dev}${route}` : `${pathToFileURL(join(__dirname, '../../dist/index.html')).href}${route}`;
}

async function createWindows() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 960, minHeight: 640, backgroundColor: '#0b1020',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => console.error('Main page failed to load:', code, description, url));
  mainWindow.webContents.on('render-process-gone', (_event, details) => console.error('Main renderer exited:', details));
  mainWindow.webContents.on('console-message', (_event, level, message) => console.error('Renderer console:', level, message));
  await mainWindow.loadURL(rendererUrl());

  const display = screen.getPrimaryDisplay().workArea;
  overlayWindow = new BrowserWindow({
    width: Math.min(1100, display.width - 80), height: 190, x: display.x + 40, y: display.y + display.height - 230,
    transparent: true, frame: false, show: false, resizable: true, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWindow.webContents.on('did-fail-load', (_event, code, description, url) => console.error('Overlay failed to load:', code, description, url));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  await overlayWindow.loadURL(rendererUrl('#overlay'));
}

function broadcast(channel: string, payload: unknown) {
  for (const window of [mainWindow, overlayWindow]) if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function acceptSegment(segment: SubtitleSegment) {
  if (!active) return;
  const accepted = await store.putSegment(active.id, segment);
  const index = active.segments.findIndex((item) => item.id === accepted.id);
  if (index >= 0) active.segments[index] = accepted; else active.segments.push(accepted);
  broadcast(IPC.subtitleUpdated, accepted);
}

function bindProvider() {
  provider.on('segment', async (segment) => {
    await acceptSegment(segment);
    if (segment.state === 'stable' && !segment.translatedText) {
      try { await acceptSegment(await translateStableSegment(segment)); }
      catch (error) { if (active) { active.providerMessage = (error as Error).message; broadcast(IPC.sessionStatus, active); } }
    }
  });
  provider.on('status', (status) => { if (active) { active.providerMessage = status.message; broadcast(IPC.sessionStatus, active); } });
  provider.on('error', async (error) => {
    if (!active) return;
    active.status = 'error'; active.providerMessage = error.message;
    await store.put(active); broadcast(IPC.sessionStatus, active);
  });
}
bindProvider();

app.whenReady().then(async () => {
  await store.initialize();
  await storageSettings.initialize();

  ipcMain.handle(IPC.listSources, async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
    return sources.filter((item) => !item.name.includes('语幕 LinguaScreen')).map((item) => ({
      id: item.id, appName: item.name, displayName: item.name,
      kind: item.id.startsWith('window') ? 'window' : 'screen', sampleRate: 16000, channels: 1,
    }));
  });

  ipcMain.handle(IPC.startSession, async (_event, config: SessionConfig) => {
    if (active?.status === 'capturing') await stopSession();
    active = { id: randomUUID(), config, status: 'capturing', startedAt: new Date().toISOString(), segments: [] };
    await store.put(active);
    provider = createProvider(); bindProvider();
    provider.connect(active.id, config).catch(async (error) => {
      if (active) { active.status = 'error'; active.providerMessage = error.message; await store.put(active); broadcast(IPC.sessionStatus, active); }
    });
    overlayWindow?.showInactive();
    broadcast(IPC.sessionStatus, active);
    return active;
  });

  ipcMain.on(IPC.audioChunk, (_event, raw: { sequence: number; startedAtMs: number; durationMs: number; sampleRate: number; channels: number; pcm: ArrayBuffer }) => {
    if (!active || active.status !== 'capturing') return;
    const chunk: AudioChunk = { ...raw, sessionId: active.id, pcm: new Uint8Array(raw.pcm), dropped: false };
    provider.sendAudio(chunk);
  });

  ipcMain.handle(IPC.stopSession, stopSession);
  ipcMain.handle(IPC.getSession, () => active);
  ipcMain.handle(IPC.listSessions, () => store.list());
  ipcMain.handle(IPC.providerStatus, () => provider.getStatus());
  ipcMain.handle(IPC.getStorageSettings, () => storageSettings.get());
  ipcMain.handle(IPC.chooseTemporaryDirectory, () => storageSettings.choose());
  ipcMain.handle(IPC.getBatchDefaults, () => ({
    asrModel: process.env.BATCH_ASR_MODEL || 'qwen-audio-3.0-asr-flash-filetrans',
    translationModel: process.env.BATCH_TRANSLATION_MODEL || 'qwen-plus',
  }));
  ipcMain.handle(IPC.chooseLocalMedia, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择本地视频或音频', properties: ['openFile'],
      filters: [{ name: '视频和音频', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'mpeg', 'mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'opus'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0]; const info = await stat(path);
    return { path, name: path.split(/[\\/]/).pop() || path, size: info.size };
  });
  ipcMain.handle(IPC.startBatchSubtitle, async (_event, request: BatchSubtitleRequest) => {
    if (active?.status === 'capturing') await stopSession();
    active = {
      id: randomUUID(), status: 'capturing', startedAt: new Date().toISOString(), segments: [],
      config: {
        source: { id: request.file.path, appName: request.file.name, displayName: request.file.name, kind: 'process' },
        sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, bilingual: true, mode: 'quality',
      },
      providerMessage: '准备本地视频高质量字幕任务',
    };
    await store.put(active); broadcast(IPC.sessionStatus, active);
    try {
      const segments = await generateBatchSubtitles(active.id, request, (progress) => {
        if (active) active.providerMessage = progress.message;
        broadcast(IPC.batchProgress, progress); if (active) broadcast(IPC.sessionStatus, active);
      }, storageSettings.get().temporaryDirectory);
      for (const segment of segments) await acceptSegment(segment);
      active.status = 'stopped'; active.stoppedAt = new Date().toISOString();
      await store.put(active); broadcast(IPC.sessionStatus, active);
      return active;
    } catch (error) {
      active.status = 'error'; active.providerMessage = (error as Error).message;
      broadcast(IPC.batchProgress, { stage: 'error', percent: 0, message: active.providerMessage });
      await store.put(active); broadcast(IPC.sessionStatus, active);
      throw error;
    }
  });
  ipcMain.handle(IPC.overlayToggle, (_event, show: boolean) => show ? overlayWindow?.showInactive() : overlayWindow?.hide());
  ipcMain.handle(IPC.overlaySettings, async (_event, settings: Partial<AppSettings['overlay']>) => {
    overlaySettings = { ...overlaySettings, ...settings };
    if (active && typeof settings.bilingual === 'boolean') {
      active.config.bilingual = settings.bilingual;
      await store.put(active);
      broadcast(IPC.sessionStatus, active);
    }
    overlayWindow?.setOpacity(overlaySettings.opacity);
    overlayWindow?.setIgnoreMouseEvents(overlaySettings.clickThrough, { forward: true });
    broadcast(IPC.overlaySettings, overlaySettings);
  });
  ipcMain.handle(IPC.saveSegment, async (_event, segment: SubtitleSegment) => acceptSegment({ ...segment, origin: 'manual', state: 'stable', version: segment.version + 1 }));
  ipcMain.handle(IPC.exportSubtitles, async (_event, format: 'srt' | 'vtt' | 'txt') => {
    if (!active) return { canceled: true };
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `字幕-${active.startedAt.slice(0, 10)}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, '\ufeff' + exportSubtitles(active.segments, format), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });

  // Register every IPC endpoint before loading the renderer. The first React
  // effect requests sources/status immediately when the page is evaluated.
  await createWindows();
}).catch((error) => {
  console.error('LinguaScreen startup failed:', error);
  app.exit(1);
});

async function stopSession() {
  if (!active) return null;
  await provider.finish().catch(() => undefined);
  active.status = 'stopped'; active.stoppedAt = new Date().toISOString();
  await store.put(active); broadcast(IPC.sessionStatus, active);
  return active;
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
// Synchronous cleanup guarantees temporary artifacts are gone before the
// Electron process exits. User-exported subtitle files live elsewhere.
app.on('will-quit', () => storageSettings.cleanupForExitSync());
