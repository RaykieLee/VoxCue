# sherpa-onnx sidecar

这是 Electron 之外运行的本地流式语音服务。它接收 16 kHz、单声道、Float32 PCM 二进制帧，返回 `speech_start`、`partial`、`speech_end`、`final` 和 `error` JSON 事件。

启动前设置以下模型路径：

```text
SHERPA_ASR_ENCODER
SHERPA_ASR_DECODER
SHERPA_ASR_JOINER
SHERPA_ASR_TOKENS
SHERPA_VAD_MODEL
```

使用任意中文流式 Zipformer/Transducer 模型即可。服务只绑定 `127.0.0.1`，端口设置 `SHERPA_PORT=0` 时自动选择可用端口，并在 stdout 输出一行 `{"type":"ready","port":...}`。

例如官方 `sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30` 模型：

```bash
MODEL_DIR="$PWD/models/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30"
SHERPA_ASR_ENCODER="$MODEL_DIR/encoder.int8.onnx" \
SHERPA_ASR_DECODER="$MODEL_DIR/decoder.onnx" \
SHERPA_ASR_JOINER="$MODEL_DIR/joiner.int8.onnx" \
SHERPA_ASR_TOKENS="$MODEL_DIR/tokens.txt" \
SHERPA_VAD_MODEL="$PWD/models/silero_vad.onnx" \
node services/sherpa-sidecar/index.cjs
```

```bash
node services/sherpa-sidecar/index.cjs
```
