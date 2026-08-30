import type { AppSettings, AudioSource, BatchProgress, BatchSubtitleRequest, LocalMediaFile, ProviderStatus, SessionConfig, SessionSnapshot, StorageSettings, SubtitleSegment } from '../shared/types';

declare global {
  interface Window {
    subtitleAPI: {
      listSources(): Promise<AudioSource[]>;
      startSession(config: SessionConfig): Promise<SessionSnapshot>;
      stopSession(): Promise<SessionSnapshot | null>;
      getSession(): Promise<SessionSnapshot | null>;
      sendAudioChunk(payload: { sequence: number; startedAtMs: number; durationMs: number; sampleRate: number; channels: number; pcm: ArrayBuffer }): void;
      onSubtitle(callback: (segment: SubtitleSegment) => void): () => void;
      onStatus(callback: (snapshot: SessionSnapshot) => void): () => void;
      toggleOverlay(show: boolean): Promise<void>;
      updateOverlay(settings: Partial<AppSettings['overlay']>): Promise<void>;
      exportSubtitles(format: 'srt' | 'vtt' | 'txt'): Promise<{ canceled: boolean; filePath?: string }>;
      listSessions(): Promise<SessionSnapshot[]>;
      saveSegment(segment: SubtitleSegment): Promise<SubtitleSegment>;
      providerStatus(): Promise<ProviderStatus>;
      getStorageSettings(): Promise<StorageSettings>;
      chooseTemporaryDirectory(): Promise<StorageSettings>;
      chooseLocalMedia(): Promise<LocalMediaFile | null>;
      startBatchSubtitle(request: BatchSubtitleRequest): Promise<SessionSnapshot>;
      getBatchDefaults(): Promise<{ asrModel: string; translationModel: string }>;
      onBatchProgress(callback: (progress: BatchProgress) => void): () => void;
    };
  }
}

export {};
