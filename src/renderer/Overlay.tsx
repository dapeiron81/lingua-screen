import { useEffect, useState } from 'react';
import type { AppSettings, SubtitleSegment } from '../shared/types';

export function Overlay() {
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [settings, setSettings] = useState<AppSettings['overlay']>({ alwaysOnTop: true, clickThrough: false, opacity: .92, fontSize: 30, bilingual: true });
  useEffect(() => {
    const merge = (incoming: SubtitleSegment) => setSegments((current) => {
      const next = [...current];
      const index = next.findIndex((item) => item.id === incoming.id);
      if (index >= 0) next[index] = incoming; else next.push(incoming);
      return next.sort((a, b) => a.startMs - b.startMs).slice(-4);
    });
    const offSubtitle = window.subtitleAPI.onSubtitle(merge);
    const offStatus = window.subtitleAPI.onStatus((session) => {
      setSettings((current) => ({ ...current, bilingual: session.config.bilingual }));
      setSegments(session.segments.slice(-4));
    });
    void window.subtitleAPI.getSession().then((session) => {
      if (!session) return;
      setSettings((current) => ({ ...current, bilingual: session.config.bilingual }));
      setSegments(session.segments.slice(-4));
    });
    return () => { offSubtitle(); offStatus(); };
  }, []);
  return <div className="overlay" style={{ fontSize: settings.fontSize }}>
    <div className="overlay-toolbar">
      <span className="overlay-grip" title="按住拖动字幕窗口">⠿ 拖动</span>
      <button className="overlay-close" title="关闭悬浮字幕" onClick={() => window.subtitleAPI.toggleOverlay(false)}>×</button>
    </div>
    {segments.length ? <div className="overlay-feed">{segments.map((segment, index) => <div className="overlay-line" key={segment.id} style={{ opacity: .42 + (index + 1) / segments.length * .58 }}>
      {settings.bilingual ? <><div className="overlay-source">{segment.sourceText}</div><div className="overlay-translation">{segment.translatedText || '翻译中…'}</div></> : <div className="overlay-source">{segment.translatedText || segment.sourceText}</div>}
    </div>)}</div> : <div className="overlay-placeholder">语幕已就绪 · 等待人声</div>}
    <div className={`overlay-dot ${segments.at(-1)?.state || 'partial'}`} />
  </div>;
}
