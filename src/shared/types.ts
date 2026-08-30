export type SegmentState = 'partial' | 'stable';
export type SessionStatus = 'idle' | 'capturing' | 'reconnecting' | 'stopped' | 'error';

export interface AudioSource {
  id: string;
  processId?: number;
  processTree?: number[];
  appName: string;
  displayName: string;
  kind: 'window' | 'screen' | 'process';
  sampleRate?: number;
  channels?: number;
}

export interface AudioChunk {
  sessionId: string;
  sequence: number;
  startedAtMs: number;
  durationMs: number;
  sampleRate: number;
  channels: number;
  pcm: Uint8Array;
  dropped: boolean;
}

export interface SubtitleSegment {
  id: string;
  sessionId: string;
  sourceText: string;
  translatedText: string;
  startMs: number;
  endMs: number;
  state: SegmentState;
  version: number;
  sourceLanguage: string;
  targetLanguage: string;
  confidence?: number;
  origin: 'realtime' | 'prefetch' | 'cache' | 'manual';
}

export interface SessionConfig {
  source: AudioSource;
  sourceLanguage: string;
  targetLanguage: string;
  bilingual: boolean;
  mode: 'speed' | 'balanced' | 'quality';
  cacheKey?: string;
}

export interface SessionSnapshot {
  id: string;
  config: SessionConfig;
  status: SessionStatus;
  startedAt: string;
  stoppedAt?: string;
  segments: SubtitleSegment[];
  providerMessage?: string;
}

export interface AppSettings {
  overlay: { alwaysOnTop: boolean; clickThrough: boolean; opacity: number; fontSize: number; bilingual: boolean };
  sourceLanguage: string;
  targetLanguage: string;
  mode: 'speed' | 'balanced' | 'quality';
}

export interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  name: string;
  message: string;
}

export interface StorageSettings {
  temporaryDirectory: string;
  subtitlePersistence: 'memory-only';
}

export interface LocalMediaFile { path: string; name: string; size: number }
export interface BatchSubtitleRequest {
  file: LocalMediaFile;
  sourceLanguage: string;
  targetLanguage: string;
  asrModel: string;
  translationModel: string;
}
export interface BatchProgress {
  stage: 'uploading' | 'transcribing' | 'translating' | 'completed' | 'error';
  percent: number;
  message: string;
}
