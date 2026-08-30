import { useEffect, useMemo, useState } from 'react';
import type { AudioSource, BatchProgress, LocalMediaFile, ProviderStatus, SessionSnapshot, StorageSettings, SubtitleSegment } from '../shared/types';
import { startDesktopAudio, type CaptureController } from './audio';

const languages = [['auto', '自动检测'], ['zh', '中文'], ['en', '英语'], ['ja', '日语'], ['ko', '韩语'], ['fr', '法语'], ['de', '德语'], ['es', '西班牙语']];
let capture: CaptureController | null = null;

export function App() {
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [bilingual, setBilingual] = useState(true);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [storage, setStorage] = useState<StorageSettings | null>(null);
  const [localFile, setLocalFile] = useState<LocalMediaFile | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchAsrModel, setBatchAsrModel] = useState('qwen-audio-3.0-asr-flash-filetrans');
  const [batchTranslationModel, setBatchTranslationModel] = useState('qwen-plus');
  const [batchRunning, setBatchRunning] = useState(false);

  const refresh = async () => {
    const found = await window.subtitleAPI.listSources();
    setSources(found); if (!sourceId && found[0]) setSourceId(found[0].id);
  };

  useEffect(() => {
    void refresh(); void window.subtitleAPI.providerStatus().then(setProvider); void window.subtitleAPI.getSession().then(setSession); void window.subtitleAPI.getStorageSettings().then(setStorage);
    void window.subtitleAPI.getBatchDefaults().then((defaults) => { setBatchAsrModel(defaults.asrModel); setBatchTranslationModel(defaults.translationModel); });
    const offSegment = window.subtitleAPI.onSubtitle((segment) => setSession((old) => old ? merge(old, segment) : old));
    const offStatus = window.subtitleAPI.onStatus((snapshot) => {
      setSession(snapshot);
      void window.subtitleAPI.providerStatus().then((status) => setProvider(
        snapshot.status === 'error' ? { ...status, connected: false, message: snapshot.providerMessage || '实时识别连接失败' } : status,
      ));
    });
    const offBatch = window.subtitleAPI.onBatchProgress(setBatchProgress);
    return () => { offSegment(); offStatus(); offBatch(); capture?.stop(); };
  }, []);

  const start = async () => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;
    setError(''); setStarting(true);
    try {
      const next = await window.subtitleAPI.startSession({ source, sourceLanguage, targetLanguage, bilingual, mode: 'speed' });
      setSession(next);
      capture = await startDesktopAudio(source.id);
      setProvider(await window.subtitleAPI.providerStatus());
    } catch (reason) {
      await window.subtitleAPI.stopSession();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setStarting(false); }
  };

  const stop = async () => { capture?.stop(); capture = null; setSession(await window.subtitleAPI.stopSession()); };
  const startBatch = async () => {
    if (!localFile) return;
    setBatchRunning(true); setError(''); setBatchProgress({ stage: 'uploading', percent: 1, message: '准备高质量字幕任务…' });
    try {
      setSession(await window.subtitleAPI.startBatchSubtitle({ file: localFile, sourceLanguage, targetLanguage, asrModel: batchAsrModel, translationModel: batchTranslationModel }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBatchRunning(false); }
  };
  const isActive = session?.status === 'capturing' || session?.status === 'reconnecting';
  const current = [...(session?.segments ?? [])].reverse().slice(0, 2);

  return <div className="app-shell">
    <header><div className="brand-mark">语</div><div><h1>语幕 <span>LinguaScreen</span></h1><p>视频人声实时识别与双语字幕</p></div><div className={`status ${provider?.connected ? 'online' : ''}`}><i />{provider?.message || '正在检查服务'}</div></header>
    <main>
      <section className="hero panel">
        <div className="eyebrow">01 选择声音来源</div>
        <div className="source-row">
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={isActive}>{sources.map((item) => <option key={item.id} value={item.id}>{item.kind === 'screen' ? '屏幕' : '窗口'} · {item.displayName}</option>)}</select>
          <button className="icon-btn" onClick={refresh} disabled={isActive} title="刷新">↻</button>
        </div>
        <p className="hint">当前兼容采集层优先使用窗口音频；若窗口不提供音频，请选择整个屏幕。指定进程隔离助手接口已预留。</p>
        <div className="storage-row">
          <div><span>临时缓存位置</span><strong title={storage?.temporaryDirectory}>{storage?.temporaryDirectory || '正在读取…'}</strong><small>字幕默认仅保存在内存；退出时清除临时数据</small></div>
          <button onClick={() => window.subtitleAPI.chooseTemporaryDirectory().then(setStorage)} disabled={isActive}>更改位置</button>
        </div>
        <div className="config-grid">
          <label><span>源语言</span><select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}>{languages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <div className="arrow">→</div>
          <label><span>翻译为</span><select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value)}>{languages.slice(1).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="toggle"><input type="checkbox" checked={bilingual} onChange={(e) => { setBilingual(e.target.checked); void window.subtitleAPI.updateOverlay({ bilingual: e.target.checked }); }} /><i /><span>显示双语</span></label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          {!isActive ? <button className="primary" onClick={start} disabled={starting || !sourceId}>{starting ? '正在连接…' : '开始生成字幕'}</button> : <button className="danger" onClick={stop}>停止并保存</button>}
          <button className="secondary" onClick={() => window.subtitleAPI.toggleOverlay(true)}>显示悬浮字幕</button>
        </div>
      </section>
      <aside className="panel now-card">
        <div className="eyebrow">02 当前字幕</div>
        <div className="wave"><span/><span/><span/><span/><span/><span/><span/></div>
        {current.length ? current.map((item) => <div className="caption" key={`${item.id}-${item.version}`}>{bilingual ? <><b>{item.sourceText}</b>{item.translatedText && <span>{item.translatedText}</span>}</> : <b>{item.translatedText || item.sourceText}</b>}<small>{item.state === 'stable' ? '已稳定' : '识别中…'} · {(item.startMs / 1000).toFixed(1)}s</small></div>) : <div className="empty"><strong>{isActive ? '正在聆听视频声音' : '准备就绪'}</strong><span>{isActive ? '字幕会在检测到人声后出现' : '选择一个正在播放视频的窗口'}</span></div>}
      </aside>
      <section className="panel transcript">
        <div className="section-title"><div><div className="eyebrow">03 字幕记录</div><h2>{session ? `${session.segments.length} 个片段` : '尚无会话'}</h2></div><div className="exports"><button onClick={() => window.subtitleAPI.exportSubtitles('srt')}>导出 SRT</button><button onClick={() => window.subtitleAPI.exportSubtitles('vtt')}>VTT</button><button onClick={() => window.subtitleAPI.exportSubtitles('txt')}>TXT</button></div></div>
        <div className="timeline">{session?.segments.length ? session.segments.map((item) => <Segment key={item.id} segment={item} bilingual={bilingual} />) : <div className="timeline-empty">字幕仅保留在当前内存中，需要时请主动导出</div>}</div>
      </section>
      <section className="panel batch-panel">
        <div className="section-title"><div><div className="eyebrow">04 本地视频 · 高质量模式</div><h2>导入完整视频生成字幕</h2></div><span className="batch-badge">非实时 · 完整上下文</span></div>
        <p className="batch-intro">适合电影、课程和访谈。软件在本机提取单声道音频，只上传音频到百炼48小时临时空间；视频画面和视频文件不会上传。</p>
        <div className="batch-file"><div><strong>{localFile?.name || '尚未选择本地视频'}</strong><small>{localFile ? `${formatBytes(localFile.size)} · ${localFile.path}` : '支持 MP4、MKV、MOV、MP3、WAV 等；上传前会在本机提取音频'}</small></div><button disabled={batchRunning || isActive} onClick={() => window.subtitleAPI.chooseLocalMedia().then((file) => file && setLocalFile(file))}>选择视频</button></div>
        <div className="batch-models"><label><span>批量识别模型</span><input value={batchAsrModel} onChange={(event) => setBatchAsrModel(event.target.value)} disabled={batchRunning} /></label><label><span>批量翻译模型</span><input value={batchTranslationModel} onChange={(event) => setBatchTranslationModel(event.target.value)} disabled={batchRunning} /></label></div>
        {batchProgress && <div className={`batch-progress ${batchProgress.stage}`}><div><i style={{ width: `${batchProgress.percent}%` }} /></div><span>{batchProgress.message}</span><b>{batchProgress.percent}%</b></div>}
        <div className="batch-actions"><button className="primary" disabled={!localFile || batchRunning || isActive} onClick={startBatch}>{batchRunning ? '正在生成，请保持软件开启…' : '开始高质量生成'}</button><small>默认不保存会话；完成后请主动导出 SRT/VTT/TXT</small></div>
      </section>
    </main>
    <footer><span>实时极速模式</span><span>批量高质量模式</span><span>字幕仅存内存</span><span>主动导出</span></footer>
  </div>;
}

function Segment({ segment, bilingual }: { segment: SubtitleSegment; bilingual: boolean }) {
  return <article className={segment.state}><time>{formatTime(segment.startMs)}</time><div>{bilingual ? <><p>{segment.sourceText}</p><p className="translation">{segment.translatedText || '等待翻译…'}</p></> : <p>{segment.translatedText || segment.sourceText}</p>}</div><em>{segment.state === 'stable' ? '稳定' : '临时'}</em></article>;
}

function merge(session: SessionSnapshot, segment: SubtitleSegment): SessionSnapshot {
  const segments = [...session.segments]; const index = segments.findIndex((item) => item.id === segment.id);
  if (index >= 0 && segment.version > segments[index].version) segments[index] = segment; else if (index < 0) segments.push(segment);
  return { ...session, segments: segments.sort((a, b) => a.startMs - b.startMs) };
}
function formatTime(ms: number) { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function formatBytes(bytes: number) { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
