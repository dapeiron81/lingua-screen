export interface CaptureController { stop(): void }

function downsample(input: Float32Array, inputRate: number, outputRate = 16000) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function pcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

export async function startDesktopAudio(sourceId: string): Promise<CaptureController> {
  const constraints = {
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1, maxFrameRate: 1 } },
  } as unknown as MediaStreamConstraints;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('所选窗口没有提供可捕获音频，请改选“整个屏幕”，或安装指定进程音频助手。');
  }
  stream.getVideoTracks().forEach((track) => track.stop());
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain(); silent.gain.value = 0;
  let sequence = 0;
  const started = performance.now();
  processor.onaudioprocess = (event) => {
    const samples = downsample(event.inputBuffer.getChannelData(0), context.sampleRate);
    const data = pcm16(samples);
    const durationMs = samples.length / 16;
    window.subtitleAPI.sendAudioChunk({ sequence: sequence++, startedAtMs: performance.now() - started - durationMs, durationMs, sampleRate: 16000, channels: 1, pcm: data });
  };
  source.connect(processor); processor.connect(silent); silent.connect(context.destination);
  return { stop() { processor.disconnect(); source.disconnect(); silent.disconnect(); stream.getTracks().forEach((track) => track.stop()); void context.close(); } };
}
