import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { AudioChunk, ProviderStatus, SessionConfig, SubtitleSegment } from '../shared/types';

export interface ProviderEvents {
  segment: [SubtitleSegment];
  status: [ProviderStatus];
  error: [Error];
}

export abstract class ProviderAdapter extends EventEmitter<ProviderEvents> {
  abstract connect(sessionId: string, config: SessionConfig): Promise<void>;
  abstract sendAudio(chunk: AudioChunk): void;
  abstract finish(): Promise<void>;
  abstract getStatus(): ProviderStatus;
}

export class UnconfiguredProvider extends ProviderAdapter {
  private sessionId = '';
  private config?: SessionConfig;

  async connect(sessionId: string, config: SessionConfig) {
    this.sessionId = sessionId;
    this.config = config;
    this.emit('status', this.getStatus());
  }

  sendAudio(chunk: AudioChunk) {
    // Local demo pulse: proves capture and timing without inventing speech content.
    if (chunk.sequence > 0 && chunk.sequence % 100 === 0 && this.config) {
      this.emit('segment', {
        id: `signal-${chunk.sequence}`,
        sessionId: this.sessionId,
        sourceText: '已收到音频，配置 API Key 后开始识别',
        translatedText: '',
        startMs: chunk.startedAtMs,
        endMs: chunk.startedAtMs + chunk.durationMs,
        state: 'partial',
        version: 1,
        sourceLanguage: this.config.sourceLanguage,
        targetLanguage: this.config.targetLanguage,
        origin: 'realtime',
      });
    }
  }

  async finish() {}
  getStatus(): ProviderStatus {
    return { configured: false, connected: false, name: '阿里云百炼', message: '未配置 DASHSCOPE_API_KEY / WORKSPACE_ID，当前为音频链路演示模式' };
  }
}

export class DashScopeAsrProvider extends ProviderAdapter {
  private socket?: WebSocket;
  private taskId = '';
  private sessionId = '';
  private config?: SessionConfig;
  private ready = false;
  private connecting = false;
  private pending: Buffer[] = [];
  private versions = new Map<string, number>();

  constructor(private readonly apiKey: string, private readonly workspaceId: string, private readonly region: string) { super(); }

  async connect(sessionId: string, config: SessionConfig): Promise<void> {
    this.sessionId = sessionId;
    this.config = config;
    this.taskId = randomUUID();
    this.connecting = true;
    this.emit('status', this.getStatus());
    const host = this.region === 'ap-southeast-1' ? `${this.workspaceId}.ap-southeast-1.maas.aliyuncs.com` : `${this.workspaceId}.cn-beijing.maas.aliyuncs.com`;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`wss://${host}/api-ws/v1/inference`, { headers: { Authorization: `bearer ${this.apiKey}`, 'X-DashScope-DataInspection': 'enable' } });
      this.socket = socket;
      socket.once('open', () => {
        socket.send(JSON.stringify({
          header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio', task: 'asr', function: 'recognition',
            model: process.env.ASR_MODEL || 'qwen-audio-3.0-asr-flash-streaming',
            parameters: {
              format: 'pcm', sample_rate: 16000,
              language_hints: config.sourceLanguage === 'auto' ? undefined : [config.sourceLanguage],
              // VAD is preferable to semantic segmentation for low-latency subtitles.
              semantic_punctuation_enabled: false,
              max_sentence_silence: config.mode === 'speed' ? 600 : config.mode === 'balanced' ? 850 : 1100,
              multi_threshold_mode_enabled: true,
              punctuation_prediction_enabled: true,
            },
            input: {},
          },
        }));
      });
      socket.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.header?.event === 'task-started') {
            this.ready = true;
            this.connecting = false;
            this.pending.splice(0).forEach((buffer) => socket.send(buffer));
            this.emit('status', this.getStatus());
            resolve();
          } else if (event.header?.event === 'result-generated') {
            this.consumeResult(event.payload);
          } else if (event.header?.event === 'task-failed') {
            this.connecting = false;
            reject(new Error(event.header?.error_message || '语音识别任务失败'));
          }
        } catch (error) { this.emit('error', error as Error); }
      });
      socket.once('error', (error) => { this.connecting = false; reject(error); });
      socket.once('close', () => { this.ready = false; this.connecting = false; this.emit('status', this.getStatus()); });
    });
  }

  private consumeResult(payload: any) {
    if (!this.config) return;
    const sentence = payload?.output?.sentence ?? payload?.sentence ?? payload?.output ?? {};
    const text = String(sentence.text ?? sentence.transcription ?? '').trim();
    if (!text) return;
    const id = String(sentence.sentence_id ?? sentence.id ?? `asr-${sentence.begin_time ?? Date.now()}`);
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    this.emit('segment', {
      id, sessionId: this.sessionId, sourceText: text, translatedText: '',
      startMs: Number(sentence.begin_time ?? sentence.start_time ?? 0),
      endMs: Number(sentence.end_time ?? sentence.begin_time ?? 0),
      state: sentence.sentence_end || sentence.is_final ? 'stable' : 'partial', version,
      sourceLanguage: this.config.sourceLanguage, targetLanguage: this.config.targetLanguage,
      confidence: sentence.confidence, origin: 'realtime',
    });
  }

  sendAudio(chunk: AudioChunk) {
    const buffer = Buffer.from(chunk.pcm);
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(buffer);
    else if (this.pending.length < 250) this.pending.push(buffer);
  }

  async finish() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' }, payload: { input: {} } }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      this.socket.close();
    }
  }

  getStatus(): ProviderStatus {
    const message = this.ready ? '实时识别已连接' : this.connecting ? '正在连接实时识别…' : 'API 已配置，开始字幕后连接';
    return { configured: true, connected: this.ready, name: '阿里云百炼', message };
  }
}

export function createProvider(): ProviderAdapter {
  const key = process.env.DASHSCOPE_API_KEY;
  const workspace = process.env.DASHSCOPE_WORKSPACE_ID;
  return key && workspace
    ? new DashScopeAsrProvider(key, workspace, process.env.DASHSCOPE_REGION || 'cn-beijing')
    : new UnconfiguredProvider();
}
