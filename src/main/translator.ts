import type { SubtitleSegment } from '../shared/types';

const languageNames: Record<string, string> = { zh: '简体中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };

export async function translateStableSegment(segment: SubtitleSegment): Promise<SubtitleSegment> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID;
  if (!apiKey || !workspaceId || !segment.sourceText.trim() || segment.sourceLanguage === segment.targetLanguage) return segment;
  const region = process.env.DASHSCOPE_REGION || 'cn-beijing';
  const host = `${workspaceId}.${region}.maas.aliyuncs.com`;
  const response = await fetch(`https://${host}/compatible-mode/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.TRANSLATION_MODEL || 'qwen-flash',
      temperature: 0.1,
      messages: [
        { role: 'system', content: `你是视频字幕翻译器。把输入准确、自然、简洁地翻译成${languageNames[segment.targetLanguage] || segment.targetLanguage}。保留人名和语气，只输出译文，不解释。` },
        { role: 'user', content: segment.sourceText },
      ],
    }),
  });
  if (!response.ok) throw new Error(`翻译请求失败：HTTP ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const translatedText = data.choices?.[0]?.message?.content?.trim();
  return translatedText ? { ...segment, translatedText, version: segment.version + 1 } : segment;
}
