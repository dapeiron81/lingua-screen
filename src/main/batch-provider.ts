import { openAsBlob } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import type { BatchProgress, BatchSubtitleRequest, SubtitleSegment } from '../shared/types';

type ProgressCallback = (progress: BatchProgress) => void;

interface UploadPolicy {
  upload_dir: string; upload_host: string; oss_access_key_id: string; signature: string; policy: string;
  x_oss_object_acl: string; x_oss_forbid_overwrite: string;
}

export async function generateBatchSubtitles(sessionId: string, request: BatchSubtitleRequest, progress: ProgressCallback, temporaryDirectory: string): Promise<SubtitleSegment[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID;
  const region = process.env.DASHSCOPE_REGION || 'cn-beijing';
  if (!apiKey || !workspaceId) throw new Error('请先配置 DASHSCOPE_API_KEY 和 DASHSCOPE_WORKSPACE_ID');
  if (region !== 'cn-beijing') throw new Error('本地视频临时上传首版仅支持 cn-beijing 地域');

  const audioPath = join(temporaryDirectory, `audio-${sessionId}.mp3`);
  progress({ stage: 'uploading', percent: 4, message: '正在本机提取音轨；视频画面不会上传…' });
  await extractAudioOnly(request.file.path, audioPath);
  const audioInfo = await stat(audioPath);
  if (audioInfo.size > 1024 ** 3) throw new Error('提取后的音频超过百炼临时上传1GB限制');
  progress({ stage: 'uploading', percent: 12, message: '音轨提取完成，正在获取安全临时上传凭证…' });
  let ossUrl: string;
  try { ossUrl = await uploadTemporaryFile(apiKey, request.asrModel, audioPath, (message) => progress({ stage: 'uploading', percent: 18, message })); }
  finally { await rm(audioPath, { force: true }); }
  progress({ stage: 'transcribing', percent: 30, message: '上传完成，正在提交高质量转写任务…' });

  const host = `${workspaceId}.${region}.maas.aliyuncs.com`;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-OssResourceResolve': 'enable' };
  const submit = await fetch(`https://${host}/api/v1/services/audio/asr/transcription`, {
    method: 'POST', headers: { ...headers, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model: request.asrModel,
      input: { file_urls: [ossUrl] },
      parameters: { language_hints: request.sourceLanguage === 'auto' ? undefined : [request.sourceLanguage] },
    }),
  });
  const submitted = await readJson(submit, '提交批量转写失败');
  const taskId = submitted.output?.task_id;
  if (!taskId) throw new Error('百炼没有返回批量任务 ID');

  let task: any;
  for (let attempt = 0; attempt < 240; attempt++) {
    await delay(Math.min(5000, 1800 + attempt * 80));
    const response = await fetch(`https://${host}/api/v1/tasks/${taskId}`, { headers });
    task = await readJson(response, '查询批量转写失败');
    const status = String(task.output?.task_status || task.output?.status || '').toUpperCase();
    if (status === 'SUCCEEDED') break;
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) throw new Error(task.output?.message || task.message || `转写任务${status}`);
    progress({ stage: 'transcribing', percent: Math.min(68, 34 + Math.floor(attempt / 5)), message: `高质量转写处理中（${status || '等待'}）…` });
  }
  const resultUrl = task?.output?.results?.[0]?.transcription_url || task?.output?.result?.transcription_url;
  if (!resultUrl) throw new Error('转写任务超时或未返回结果文件');
  const transcriptResponse = await fetch(resultUrl);
  const transcript = await readJson(transcriptResponse, '下载转写结果失败');
  const sentences = (transcript.transcripts || []).flatMap((item: any) => item.sentences || []);
  if (!sentences.length) throw new Error('转写完成，但没有识别到可用的人声句子');

  let segments: SubtitleSegment[] = sentences.map((sentence: any, index: number) => ({
    id: `batch-${index + 1}`, sessionId, sourceText: String(sentence.text || '').trim(), translatedText: '',
    startMs: Number(sentence.begin_time || 0), endMs: Number(sentence.end_time || sentence.begin_time || 0),
    state: 'stable', version: 1, sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage,
    confidence: sentence.confidence, origin: 'prefetch',
  })).filter((item: SubtitleSegment) => item.sourceText);

  progress({ stage: 'translating', percent: 72, message: `识别完成，共 ${segments.length} 句，正在进行上下文翻译…` });
  segments = await translateInGroups(apiKey, host, request.translationModel, request.targetLanguage, segments, (done, total) => {
    progress({ stage: 'translating', percent: 72 + Math.round(done / total * 26), message: `高质量翻译 ${done}/${total} 组…` });
  });
  progress({ stage: 'completed', percent: 100, message: `已生成 ${segments.length} 条稳定字幕，可校对或导出` });
  return segments;
}

async function uploadTemporaryFile(apiKey: string, model: string, filePath: string, update: (message: string) => void) {
  const policyResponse = await fetch(`https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  const policyJson = await readJson(policyResponse, '获取临时上传凭证失败');
  const policy = policyJson.data as UploadPolicy;
  if (!policy?.upload_host) throw new Error('临时上传凭证不完整');
  update('仅上传提取后的单声道音频，不上传视频画面…');
  const fileName = basename(filePath);
  const key = `${policy.upload_dir}/${fileName}`;
  const form = new FormData();
  form.set('OSSAccessKeyId', policy.oss_access_key_id); form.set('Signature', policy.signature); form.set('policy', policy.policy);
  form.set('x-oss-object-acl', policy.x_oss_object_acl); form.set('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.set('key', key); form.set('success_action_status', '200'); form.set('file', await openAsBlob(filePath), fileName);
  const uploaded = await fetch(policy.upload_host, { method: 'POST', body: form });
  if (!uploaded.ok) throw new Error(`视频临时上传失败：HTTP ${uploaded.status}`);
  return `oss://${key}`;
}

async function translateInGroups(apiKey: string, host: string, model: string, targetLanguage: string, segments: SubtitleSegment[], update: (done: number, total: number) => void) {
  const groups: SubtitleSegment[][] = [];
  for (let i = 0; i < segments.length; i += 12) groups.push(segments.slice(i, i + 12));
  const output: SubtitleSegment[] = [];
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const response = await fetch(`https://${host}/compatible-mode/v1/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.1, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `你是专业影视字幕翻译。结合上下句语境翻译为${targetLanguage}，保持简洁自然。严格返回JSON对象：{"translations":[{"id":"原ID","text":"译文"}]}，不得遗漏。` },
        { role: 'user', content: JSON.stringify(group.map((item) => ({ id: item.id, text: item.sourceText }))) },
      ] }),
    });
    const json = await readJson(response, '批量字幕翻译失败');
    const content = json.choices?.[0]?.message?.content || '{}';
    let translated: Array<{ id: string; text: string }> = [];
    try { translated = JSON.parse(content).translations || []; } catch {}
    const map = new Map(translated.map((item) => [String(item.id), String(item.text || '')]));
    output.push(...group.map((item) => ({ ...item, translatedText: map.get(item.id) || '', version: item.version + 1 })));
    update(index + 1, groups.length);
  }
  return output;
}

async function readJson(response: Response, prefix: string): Promise<any> {
  const text = await response.text();
  let json: any = {}; try { json = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${prefix}：${json.message || json.code || `HTTP ${response.status}`}`);
  return json;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractAudioOnly(videoPath: string, audioPath: string) {
  const executable = ffmpegPath;
  if (!executable) throw new Error('软件内置 FFmpeg 不可用');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-y', '-i', videoPath, '-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-b:a', '48k', audioPath], { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', (data: Buffer) => errorText = (errorText + data.toString()).slice(-1600));
    child.once('error', (error: Error) => reject(new Error(`音频提取启动失败：${error.message}`)));
    child.once('exit', (code: number | null) => code === 0 ? resolve() : reject(new Error(`音频提取失败（${code}）：${errorText}`)));
  });
}
