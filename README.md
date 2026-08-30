# 语幕 LinguaScreen

Windows 视频实时识别、翻译与悬浮字幕 MVP。当前版本提供桌面客户端、窗口/屏幕音频采集、阿里云百炼实时 ASR 适配器、内存字幕会话和 SRT/VTT/TXT 导出。

## 当前完成度

- 可运行的 Electron + React + TypeScript 桌面应用
- 选择窗口或屏幕，采集其可用音频并转换为 16 kHz 单声道 PCM
- 阿里云 `qwen-audio-3.0-asr-flash-streaming` WebSocket 接入及 `qwen-flash` 稳定片段翻译
- 无密钥演示模式：验证捕获链路但绝不伪造识别文本
- 临时/稳定字幕版本合并，字幕会话默认仅保存在内存
- 透明置顶悬浮字幕窗口
- UTF-8 BOM 的 SRT、VTT、TXT 导出

## 本地运行

1. 安装 Node.js 20 或更高版本。
2. 执行 `npm install`。
3. 复制 `.env.example` 为 `.env`，填写阿里云百炼 API Key 和 Workspace ID。
4. 执行 `npm run dev`。

## API 配置

在项目根目录把 `.env.example` 复制为 `.env`，然后填写：

```env
DASHSCOPE_API_KEY=你的阿里云百炼API_Key
DASHSCOPE_WORKSPACE_ID=你的业务空间ID
DASHSCOPE_REGION=cn-beijing
ASR_MODEL=qwen-audio-3.0-asr-flash-streaming
TRANSLATION_MODEL=qwen-flash

BATCH_ASR_MODEL=qwen-audio-3.0-asr-flash-filetrans
BATCH_TRANSLATION_MODEL=qwen-plus
```

两个模型共用同一套阿里云百炼 API Key 和业务空间 ID：

- `qwen-audio-3.0-asr-flash-streaming`：实时接收 PCM 音频并生成原文字幕。
- `qwen-flash`：把已经稳定的原文字幕翻译为目标语言。
- `BATCH_ASR_MODEL` 和 `BATCH_TRANSLATION_MODEL`：只用于本地视频高质量模式，可在软件界面为单次任务覆盖，不影响实时字幕。

修改 `.env` 后必须彻底退出软件，再执行 `npm.cmd start`，配置才会重新加载。不要把真实密钥填写进 `.env.example`、源代码或截图。

## 本地视频高质量字幕

主界面“本地视频 · 高质量模式”支持导入视频或音频。软件先用内置 FFmpeg 在本机提取16kHz单声道、48kbps音频，移除视频画面和元数据；只把提取后的音频上传到百炼48小时临时空间，再提交最长12小时的异步文件转写任务。视频文件和画面不会上传。临时音频上传接口限制单文件不超过1GB，首版只支持北京地域。

音频上传结束后立即删除本机提取的临时音频；退出软件还会再次清理临时工作区。云端临时音频由百炼在48小时后自动清理。字幕结果只保存在当前内存，用户需要主动导出。

生产构建检查：`npm run typecheck && npm run build`。

## 安全边界

API Key 只从本机 `.env` / 环境变量读取，不进入渲染进程，也不应提交到版本库。应用按 PCM 音频流调用 ASR，不上传完整视频文件。字幕会话默认只存在于当前进程内存中，退出软件即清除；只有用户主动导出时才会在用户选择的位置生成 SRT、VTT 或 TXT。旧版本的 `userData/subtitle-cache/sessions.json` 会在新版启动时自动删除。

主界面可以更改“临时缓存位置”。这只控制未来媒体预生成等功能使用的磁盘临时工作区，不能改变操作系统分配 RAM 的位置；该工作区在启动及退出时清理。缓存位置偏好本身会保存在 `userData/preferences.json`，其中不含字幕、音频或 API Key。

## 已知限制与下一步

Electron 自带的桌面采集能力是否能获得“窗口音频”取决于 Windows 与目标应用；选择整个屏幕通常兼容性更好，但可能混入其他系统声音。最终的“只捕获指定应用及其子进程”需要 Windows 10 Build 20348+ 的 WASAPI Process Loopback 原生助手。项目已经把音频来源与上层会话协议解耦，接入原生助手时不需修改字幕、缓存和导出模块。

当前实时 ASR 和文本翻译协议均已接入，但必须用用户自己的百炼账号完成真实服务联调。滚动预生成和媒体指纹缓存将在能够合法取得媒体文件/音频 URL 的来源适配器完成后加入；普通桌面音频捕获无法读取尚未播放的缓存声音。

详细产品与技术依据见 [在线视频实时字幕翻译软件-可行性与实施方案.md](./在线视频实时字幕翻译软件-可行性与实施方案.md)。
