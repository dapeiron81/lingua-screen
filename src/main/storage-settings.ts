import { app, dialog } from 'electron';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { StorageSettings } from '../shared/types';

interface StoredPreferences { temporaryDirectory?: string }

export class StorageSettingsService {
  private settings!: StorageSettings;
  private preferencesFile = '';

  async initialize() {
    const userData = app.getPath('userData');
    this.preferencesFile = join(userData, 'preferences.json');
    let saved: StoredPreferences = {};
    try { saved = JSON.parse(await readFile(this.preferencesFile, 'utf8')); } catch {}
    this.settings = {
      temporaryDirectory: saved.temporaryDirectory || join(app.getPath('temp'), 'LinguaScreenTemp'),
      subtitlePersistence: 'memory-only',
    };

    // Privacy migration: remove subtitle sessions written by versions <= 0.1.
    await rm(join(userData, 'subtitle-cache', 'sessions.json'), { force: true });
    await this.clearTemporaryWorkspace();
  }

  get() { return { ...this.settings }; }

  async choose() {
    const result = await dialog.showOpenDialog({ title: '选择语幕临时缓存位置', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return this.get();
    const previous = this.settings.temporaryDirectory;
    this.settings.temporaryDirectory = join(resolve(result.filePaths[0]), 'LinguaScreenTemp');
    await mkdir(dirname(this.preferencesFile), { recursive: true });
    await writeFile(this.preferencesFile, JSON.stringify({ temporaryDirectory: this.settings.temporaryDirectory }, null, 2), 'utf8');
    if (previous !== this.settings.temporaryDirectory) await this.clearExactWorkspace(previous);
    await this.clearTemporaryWorkspace();
    return this.get();
  }

  async clearTemporaryWorkspace() { await this.clearExactWorkspace(this.settings.temporaryDirectory); }

  cleanupForExitSync() {
    const absolute = resolve(this.settings.temporaryDirectory);
    if (absolute !== resolve(dirname(absolute)) && absolute.endsWith('LinguaScreenTemp')) {
      rmSync(absolute, { recursive: true, force: true });
    }
  }

  private async clearExactWorkspace(target: string) {
    const absolute = resolve(target);
    if (absolute === resolve(dirname(absolute)) || !absolute.endsWith('LinguaScreenTemp')) throw new Error('拒绝清理非语幕临时目录');
    await rm(absolute, { recursive: true, force: true });
    await mkdir(absolute, { recursive: true });
  }
}
