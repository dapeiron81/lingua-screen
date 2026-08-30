import type { SubtitleSegment } from '../shared/types';

const pad = (value: number, width = 2) => String(value).padStart(width, '0');
function timestamp(ms: number, separator: ',' | '.') {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(safe % 1000, 3)}`;
}
function body(segment: SubtitleSegment) { return [segment.sourceText, segment.translatedText].filter(Boolean).join('\n'); }

export function exportSubtitles(segments: SubtitleSegment[], format: 'srt' | 'vtt' | 'txt') {
  const stable = segments.filter((item) => item.state === 'stable' || item.origin === 'manual');
  if (format === 'txt') return stable.map(body).join('\n\n');
  if (format === 'vtt') return `WEBVTT\n\n${stable.map((item) => `${timestamp(item.startMs, '.')} --> ${timestamp(item.endMs, '.')}\n${body(item)}`).join('\n\n')}\n`;
  return `${stable.map((item, index) => `${index + 1}\n${timestamp(item.startMs, ',')} --> ${timestamp(item.endMs, ',')}\n${body(item)}`).join('\n\n')}\n`;
}
