import { describe, expect, it } from 'vitest';
import { exportSubtitles } from './exporter';
import type { SubtitleSegment } from '../shared/types';

const segment: SubtitleSegment = {
  id: 'one', sessionId: 'session', sourceText: 'Hello', translatedText: '你好',
  startMs: 1_234, endMs: 3_456, state: 'stable', version: 1,
  sourceLanguage: 'en', targetLanguage: 'zh', origin: 'realtime',
};

describe('subtitle exporter', () => {
  it('writes valid SRT timestamps and bilingual text', () => {
    expect(exportSubtitles([segment], 'srt')).toBe('1\n00:00:01,234 --> 00:00:03,456\nHello\n你好\n');
  });
  it('does not export unfinished partial hypotheses', () => {
    expect(exportSubtitles([{ ...segment, state: 'partial' }], 'vtt')).toBe('WEBVTT\n\n\n');
  });
});
