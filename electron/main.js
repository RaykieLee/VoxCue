import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
} from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { WebSocket } from "ws";
import composer from "./cdp-composer.cjs";
import modelArchive from "./model-archive.cjs";

const { extractTarBz2File } = modelArchive;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
let window;
let orbWindow = null;
let orbDragOrigin = null;
let isQuitting = false;
let shortcutRegistered = false;
let shortcutAccelerator = "Alt+Space";
let sessionShortcutRegistered = false;
let sessionShortcutAccelerator = "Alt+Shift+Space";
let tray = null;
let cdpSocket = null;
let cdpPort = 9222;
let cdpShouldReconnect = false;
let cdpReconnectTimer = null;
let speechProcess = null;
let speechSocket = null;
let cdpSequence = 0;
const cdpWaiters = new Map();

const modelCatalog = [
  { id: "zipformer-zh-int8", type: "asr", name: "Zipformer 中文流式（int8）", description: "当前默认模型，低延迟、资源占用较低。", languages: "中文", streaming: true, size: "约 160 MB", archive: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30.tar.bz2", directory: "sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30", files: ["encoder.int8.onnx", "decoder.onnx", "joiner.int8.onnx", "tokens.txt"] },
  { id: "zipformer-zh-xlarge-int8", type: "asr", name: "Zipformer 中文流式 XLarge（int8）", description: "更大容量的中文模型，优先考虑准确率。", languages: "中文", streaming: true, size: "约 740 MB", archive: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30.tar.bz2", directory: "sherpa-onnx-streaming-zipformer-zh-xlarge-int8-2025-06-30", files: ["encoder.int8.onnx", "decoder.onnx", "joiner.int8.onnx", "tokens.txt"] },
  { id: "paraformer-bilingual", type: "asr", name: "Paraformer 中英双语流式", description: "适合中文、英文混合输入，并兼顾部分中文方言。", languages: "中文 + English", streaming: true, size: "约 230 MB（int8）", archive: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2", directory: "sherpa-onnx-streaming-paraformer-bilingual-zh-en", files: ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"], architecture: "paraformer" },
  { id: "paraformer-trilingual", type: "asr", name: "Paraformer 中英粤语流式", description: "支持普通话、粤语、英语和部分中文方言。", languages: "中文 + 粤语 + English", streaming: true, size: "约 230 MB（int8）", archive: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en.tar.bz2", directory: "sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en", files: ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"], architecture: "paraformer" },
  { id: "silero-vad", type: "vad", name: "Silero VAD（标准）", description: "稳定的语音活动检测，当前默认模型。", languages: "不适用", streaming: true, size: "632 KB", file: "silero_vad.onnx", download: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" },
  { id: "silero-vad-int8", type: "vad", name: "Silero VAD（int8）", description: "量化版本，资源占用更低。", languages: "不适用", streaming: true, size: "约 208 KB", file: "silero_vad.int8.onnx", download: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.int8.onnx" },
  { id: "eres2net-base", type: "speaker", name: "3D-Speaker ERes2Net Base", description: "当前默认中文声纹模型，适合本地单人验证。", languages: "中文", streaming: true, size: "38 MB", file: "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx", download: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" },
  { id: "eres2net-large", type: "speaker", name: "3D-Speaker ERes2Net Large", description: "更大容量的声纹模型，适合准确率优先场景。", languages: "中文", streaming: true, size: "约 100 MB", file: "3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx", download: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx" }
];

const defaultSettings = {
  firstRunComplete: false,
  onboardingVersion: 2,
  microphoneId: "",
  onlyMyVoice: true,
  speakerThreshold: 0.55,
  modelLanguage: "中英双语",
  endpointSeconds: 1.2,
  punctuation: true,
  writeToChatGPT: true,
  autoSend: false,
  appendDraft: true,
  showOrb: true,
  orbSize: 48,
  stopWords: "停止录音",
  launchAtLogin: false,
  shortcut: "Alt+Space",
  sessionShortcut: "Alt+Shift+Space",
  cdpPort: 9222,
  cdpConnected: false,
  voiceSamples: [],
  sendMode: "write",
  conversationHistory: [],
  pinnedSessionIds: [],
  asrModelId: "zipformer-zh-int8",
  vadModelId: "silero-vad",
  speakerModelId: "eres2net-base",
};

const modelSettingKeys = { asr: "asrModelId", vad: "vadModelId", speaker: "speakerModelId" };
function modelRootPath() {
  return app.isPackaged ? path.join(app.getPath("userData"), "models") : path.join(root, "models");
}
function modelRoots() {
  const roots = [modelRootPath()];
  if (app.isPackaged) roots.push(path.join(process.resourcesPath, "models"));
  else roots.push(path.join(root, "models"));
  return [...new Set(roots)];
}
function modelLocation(model) {
  return modelRoots().find((base) => {
    if (model.directory) return model.files.every((file) => fs.existsSync(path.join(base, model.directory, file)));
    return Boolean(model.file && fs.existsSync(path.join(base, model.file)));
  });
}
function modelRecord(id) {
  const model = modelCatalog.find((item) => item.id === id);
  if (!model) throw new Error(`未知模型：${id}`);
  return model;
}
function modelInstalled(model) {
  return Boolean(modelLocation(model));
}
function listModels() {
  const settings = readSettings();
  return modelCatalog.map((model) => ({
    id: model.id,
    type: model.type,
    name: model.name,
    description: model.description,
    languages: model.languages,
    streaming: model.streaming,
    size: model.size,
    installed: modelInstalled(model),
    selected: settings[modelSettingKeys[model.type]] === model.id,
  }));
}
async function downloadModelFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`模型下载失败（${response.status}）`);
  await new Promise(async (resolve, reject) => {
    const output = fs.createWriteStream(destination);
    output.on("finish", resolve);
    output.on("error", reject);
    try {
      for await (const chunk of response.body) output.write(chunk);
      output.end();
    } catch (error) {
      output.destroy();
      reject(error);
    }
  });
}
async function extractModelArchive(archive, destination) {
  try {
    await extractTarBz2File(archive, destination);
  } catch (error) {
    throw new Error(
      `模型压缩包解压失败：${error instanceof Error ? error.message : "压缩包无效"}`,
    );
  }
}
async function installModel(id) {
  const model = modelRecord(id);
  const modelRoot = modelRootPath();
  fs.mkdirSync(modelRoot, { recursive: true });
  if (model.archive) {
    const archivePath = path.join(app.getPath("temp"), `vox-cue-${model.id}-${Date.now()}.tar.bz2`);
    try {
      await downloadModelFile(model.archive, archivePath);
      await extractModelArchive(archivePath, modelRoot);
    } finally {
      try { fs.unlinkSync(archivePath); } catch {}
    }
  } else if (model.download && model.file) {
    const destination = path.join(modelRoot, model.file);
    const temporary = `${destination}.download`;
    try {
      await downloadModelFile(model.download, temporary);
      fs.renameSync(temporary, destination);
    } finally {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
  if (!modelInstalled(model)) throw new Error("模型下载完成但文件校验未通过");
  return listModels().find((item) => item.id === id);
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function readSettings() {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")),
    };
  } catch {
    return { ...defaultSettings };
  }
}
function writeSettings(value) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(
    settingsPath(),
    JSON.stringify({ ...defaultSettings, ...value }, null, 2),
  );
  app.setLoginItemSettings({ openAtLogin: Boolean(value.launchAtLogin) });
  registerGlobalShortcuts(value.shortcut, value.sessionShortcut);
  syncOrbWindow(value);
  return readSettings();
}

function registerGlobalShortcuts(value = "Alt+Space", sessionValue = "Alt+Shift+Space") {
  if (!app.isReady()) return false;
  const accelerator =
    value ||
    (process.platform === "darwin"
      ? "Alt+Space"
      : "CommandOrControl+Alt+Space");
  if (shortcutAccelerator) globalShortcut.unregister(shortcutAccelerator);
  if (sessionShortcutAccelerator) globalShortcut.unregister(sessionShortcutAccelerator);
  shortcutAccelerator = accelerator;
  shortcutRegistered = globalShortcut.register(accelerator, () => {
    if (window && !window.isDestroyed())
      window.webContents.send("shortcut:toggle");
  });
  const sessionAccelerator = sessionValue || "Alt+Shift+Space";
  if (sessionAccelerator === accelerator) {
    sessionShortcutRegistered = false;
  } else {
    sessionShortcutAccelerator = sessionAccelerator;
    sessionShortcutRegistered = globalShortcut.register(sessionAccelerator, () => {
      if (window && !window.isDestroyed()) {
        window.show();
        window.focus();
        window.webContents.send("shortcut:session-picker");
      }
    });
  }
  return shortcutRegistered;
}

function registerGlobalShortcut(value = "Alt+Space") {
  const settings = readSettings();
  return registerGlobalShortcuts(value, settings.sessionShortcut);
}

function syncOrbWindow(settings = readSettings()) {
  if (!orbWindow || orbWindow.isDestroyed()) return;
  const size = Math.max(40, Math.min(56, Number(settings.orbSize) || 48));
  const bounds = orbWindow.getBounds();
  orbWindow.setBounds({
    x: bounds.x + bounds.width - size,
    y: bounds.y + bounds.height - size,
    width: size,
    height: size,
  });
  settings.showOrb ? orbWindow.showInactive() : orbWindow.hide();
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(2500, () => req.destroy(new Error("CDP 请求超时")));
    req.on("error", reject);
  });
}

async function discoverCdp(port) {
  const targets = await getJson(`http://127.0.0.1:${Number(port)}/json/list`);
  const candidates = targets.filter(
    (target) =>
      ["page", "webview"].includes(target.type) && target.webSocketDebuggerUrl,
  );
  const inspected = await Promise.all(
    candidates.map(async (target) => ({
      target,
      hasComposer: await targetHasComposer(target),
    })),
  );
  const ranked = inspected
    .filter((item) => item.hasComposer)
    .map((item) => ({
      ...item,
      score:
        (/chatgpt\.com|chat\.openai/i.test(item.target.url || "") ? 40 : 0) +
        (/^app:\/\/-\/index\.html(?:$|#)/i.test(item.target.url || "")
          ? 100
          : 0) +
        (/chatgpt/i.test(item.target.title || "") ? 20 : 0) -
        (/avatar-overlay/i.test(item.target.url || "") ? 200 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const preferred = ranked[0]?.target;
  if (!preferred)
    throw new Error(
      "没有找到带输入框的 ChatGPT 主窗口，请先打开一个 ChatGPT 对话页面",
    );
  return {
    id: preferred.id,
    title: preferred.title || "ChatGPT",
    url: preferred.url,
    webSocketDebuggerUrl: preferred.webSocketDebuggerUrl,
  };
}

function targetHasComposer(target) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(value);
    };
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => finish(false), 2500);
    socket.once("open", () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: composer.detectExpression,
            returnByValue: true,
          },
        }),
      ),
    );
    socket.once("error", () => finish(false));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.id === 1) finish(Boolean(message.result?.result?.value));
      } catch {
        finish(false);
      }
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAndWait(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

function runAndCapture(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.once("error", () => resolve(output));
    child.once("exit", () => resolve(output));
  });
}

async function findWindowsChatGptExecutable() {
  const powershell = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const command = [
    "$paths = @()",
    "Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $paths += $_.Path }",
    "Get-AppxPackage | Where-Object { $_.Name -like 'OpenAI.*' } | ForEach-Object { $paths += (Join-Path $_.InstallLocation 'app\\ChatGPT.exe') }",
    "$paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique",
  ].join("; ");
  const output = await runAndCapture(powershell, [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command,
  ]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\\ChatGPT\.exe$/i.test(line));
}

async function launchChatGpt(portValue) {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("CDP 端口必须在 1–65535 之间");
  try {
    return { ...(await discoverCdp(port)), alreadyRunning: true };
  } catch {}

  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ];
  if (process.platform === "darwin") {
    await runAndWait("osascript", ["-e", 'tell application "ChatGPT" to quit']);
    await wait(1200);
    const child = spawn("open", ["-a", "ChatGPT", "--args", ...args], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else if (process.platform === "win32") {
    const detectedExecutable = await findWindowsChatGptExecutable();
    await runAndWait("taskkill", ["/IM", "ChatGPT.exe", "/T"]);
    await wait(1200);
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Programs",
        "ChatGPT",
        "ChatGPT.exe",
      ),
      path.join(process.env.LOCALAPPDATA || "", "ChatGPT", "ChatGPT.exe"),
      path.join(
        process.env.LOCALAPPDATA || "",
        "Microsoft",
        "WindowsApps",
        "ChatGPT.exe",
      ),
    ];
    const executable =
      detectedExecutable || candidates.find((candidate) => fs.existsSync(candidate));
    if (!executable)
      throw new Error("没有找到 ChatGPT 桌面端，请先安装 ChatGPT");
    const child = spawn(executable, args, { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    throw new Error("当前系统暂不支持自动启动 ChatGPT");
  }

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await wait(500);
    try {
      return { ...(await discoverCdp(port)), alreadyRunning: false };
    } catch {}
  }
  throw new Error(
    `ChatGPT 已启动，但 ${port} 端口未就绪。请完全退出 ChatGPT 后重试。`,
  );
}

function closeCdp() {
  if (cdpSocket) {
    try {
      cdpSocket.close();
    } catch {}
  }
  cdpSocket = null;
  cdpWaiters.forEach((waiter) => waiter.reject(new Error("CDP 连接已关闭")));
  cdpWaiters.clear();
}

function emitCdp(event) {
  if (window && !window.isDestroyed())
    window.webContents.send("cdp:event", event);
}

function scheduleCdpReconnect() {
  if (!cdpShouldReconnect || cdpReconnectTimer) return;
  cdpReconnectTimer = setTimeout(() => {
    cdpReconnectTimer = null;
    connectCdp(cdpPort).catch(() => scheduleCdpReconnect());
  }, 2500);
}

function stopSpeech() {
  try {
    speechSocket?.close();
  } catch {}
  speechSocket = null;
  if (speechProcess && !speechProcess.killed) speechProcess.kill();
  speechProcess = null;
}

function emitSpeech(event) {
  if (window && !window.isDestroyed())
    window.webContents.send("speech:event", event);
}

async function startSpeech(options = {}) {
  stopSpeech();
  const sessionToken = crypto.randomBytes(24).toString("hex");
  const script = path.join(root, "services", "sherpa-sidecar", "index.cjs");
  const configured = readSettings();
  const modelRoot = modelRootPath();
  const asr = modelRecord(options.asrModelId || configured.asrModelId);
  const vadModel = modelRecord(options.vadModelId || configured.vadModelId);
  const speaker = modelRecord(options.speakerModelId || configured.speakerModelId);
  for (const model of [asr, vadModel, speaker]) {
    if (!modelInstalled(model)) throw new Error(`模型“${model.name}”尚未下载，请先在模型管理中下载`);
  }
  const asrBase = modelLocation(asr) || modelRoot;
  const vadBase = modelLocation(vadModel) || modelRoot;
  const speakerBase = modelLocation(speaker) || modelRoot;
  const punctuationRelative = path.join("sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8", "model.int8.onnx");
  const punctuationBase = modelRoots().find((base) => fs.existsSync(path.join(base, punctuationRelative))) || modelRoot;
  const asrDir = asr.directory ? path.join(asrBase, asr.directory) : asrBase;
  const defaultModels = {
    SHERPA_ASR_TYPE: asr.architecture || "zipformer",
    SHERPA_ASR_ENCODER: path.join(asrDir, asr.files?.find((file) => file.startsWith("encoder")) || "encoder.int8.onnx"),
    SHERPA_ASR_DECODER: path.join(asrDir, asr.files?.find((file) => file.startsWith("decoder")) || "decoder.onnx"),
    SHERPA_ASR_JOINER: asr.architecture === "paraformer" ? "" : path.join(asrDir, asr.files?.find((file) => file.startsWith("joiner")) || "joiner.int8.onnx"),
    SHERPA_ASR_TOKENS: path.join(asrDir, "tokens.txt"),
    SHERPA_VAD_MODEL: path.join(vadBase, vadModel.file),
    SHERPA_SPEAKER_MODEL: path.join(speakerBase, speaker.file),
    SHERPA_PUNCTUATION_MODEL: path.join(
      punctuationBase,
      punctuationRelative,
    ),
    SHERPA_SPEAKER_EMBEDDING: path.join(app.getPath("userData"), "voiceprint.json"),
  };
  const child = spawn(
    process.env.VOICE_NODE_PATH || process.execPath,
    [script],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        SHERPA_PORT: "0",
        SHERPA_TOKEN: sessionToken,
        SHERPA_REQUIRE_SPEAKER: options.requireSpeaker ? "1" : "0",
        SHERPA_PUNCTUATION: options.punctuation === false ? "0" : "1",
        SHERPA_SPEAKER_THRESHOLD: String(options.speakerThreshold ?? 0.55),
        SHERPA_ENDPOINT_SECONDS: String(
          Math.max(0.5, Math.min(3, Number(options.endpointSeconds) || 1.2)),
        ),
        ...defaultModels,
        ...options.models,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  speechProcess = child;
  child.stderr.on("data", (data) =>
    emitSpeech({ type: "error", message: data.toString().trim() }),
  );
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("语音服务启动超时")), 5000);
    child.stdout.on("data", (data) => {
      output += data.toString();
      const line = output
        .split("\n")
        .find((item) => item.includes('"type":"ready"'));
      if (line) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line).port);
        } catch {
          reject(new Error("语音服务返回无效端口"));
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`语音服务退出（${code ?? "未知"}）`));
    });
  });
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("语音服务连接超时"));
    }, 5000);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.send(JSON.stringify({ type: "auth", token: sessionToken }));
      speechSocket = socket;
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("message", (raw) => {
      try {
        emitSpeech(JSON.parse(raw.toString()));
      } catch {}
    });
    socket.on("close", () => {
      speechSocket = null;
      emitSpeech({ type: "disconnected" });
    });
  });
  return { connected: true, port };
}

function cdpCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN)
      return reject(new Error("CDP 未连接"));
    const id = ++cdpSequence;
    cdpWaiters.set(id, { resolve, reject });
    cdpSocket.send(JSON.stringify({ id, method, params }));
  });
}

async function connectCdp(port) {
  const target = await discoverCdp(port);
  cdpPort = Number(port);
  cdpShouldReconnect = true;
  closeCdp();
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP WebSocket 连接超时"));
    }, 4000);
    socket.once("open", () => {
      clearTimeout(timer);
      cdpSocket = socket;
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && cdpWaiters.has(message.id)) {
        const waiter = cdpWaiters.get(message.id);
        cdpWaiters.delete(message.id);
        message.error
          ? waiter.reject(new Error(message.error.message))
          : waiter.resolve(message.result);
      }
    });
    socket.on("close", () => {
      closeCdp();
      emitCdp({ type: "disconnected" });
      scheduleCdpReconnect();
    });
  });
  await cdpCommand("Runtime.enable");
  emitCdp({ type: "connected", title: target.title, url: target.url });
  return { ...target, connected: true };
}

async function writeToComposer(text, append = true) {
  if (typeof text !== "string" || !text.trim())
    throw new Error("不能写入空文本");
  const result = await cdpCommand("Runtime.evaluate", {
    expression: composer.writeExpression(text, append),
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result?.result?.value;
  if (!value?.ok) throw new Error(value?.reason || "ChatGPT 输入失败");
  return value;
}

async function sendComposer() {
  const result = await cdpCommand("Runtime.evaluate", {
    expression: composer.sendScript,
    returnByValue: true,
  });
  const value = result?.result?.value;
  if (!value?.ok) throw new Error(value?.reason || "ChatGPT 发送失败");
  return value;
}

async function evaluateCdp(expression, awaitPromise = false) {
  const result = await cdpCommand("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  return result?.result?.value;
}

async function listCdpSessions() {
  const value = await evaluateCdp(composer.sessionsListExpression);
  if (!value?.ok) throw new Error(value?.reason || "无法读取 ChatGPT 对话列表");
  return value;
}

async function snapshotCdpConversation() {
  const value = await evaluateCdp(composer.conversationSnapshotExpression);
  if (!value?.ok) throw new Error(value?.reason || "无法读取当前 ChatGPT 回复");
  return value;
}

async function switchCdpSession(id, href = "") {
  if (!id) throw new Error("未指定 ChatGPT 对话");
  const value = await evaluateCdp(composer.switchSessionExpression(id, href));
  if (!value?.ok) throw new Error(value?.reason || "切换 ChatGPT 对话失败");
  const ready = await evaluateCdp(composer.waitForComposerExpression, true);
  if (!ready?.ok) throw new Error(ready?.reason || "切换对话后输入框未就绪");
  const sessions = await listCdpSessions();
  const current = sessions.sessions?.find((item) => item.id === String(id));
  return {
    ...sessions,
    currentId: current?.id || ready.currentId || String(id),
    currentTitle: current?.title || ready.title || sessions.currentTitle || "ChatGPT",
  };
}

async function createCdpSession() {
  const value = await evaluateCdp(composer.newSessionExpression);
  if (!value?.ok) throw new Error(value?.reason || "新建 ChatGPT 对话失败");
  const ready = await evaluateCdp(composer.waitForComposerExpression, true);
  if (!ready?.ok) throw new Error(ready?.reason || "新建对话后输入框未就绪");
  // New chats often receive an id asynchronously. Poll briefly so the
  // renderer can immediately display the newly selected conversation.
  let latest = await listCdpSessions();
  for (let attempt = 0; attempt < 12 && !latest.currentId; attempt += 1) {
    await wait(150);
    latest = await listCdpSessions();
  }
  return latest;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  // Always show a normal window at launch. The orb remains available inside it,
  // but a transparent 84px window is too easy to mistake for a failed launch.
  const initialExpanded = true;
  window = new BrowserWindow({
    width: initialExpanded ? 1000 : 84,
    height: initialExpanded ? 700 : 84,
    x: initialExpanded
      ? Math.max(0, Math.round((width - 1000) / 2))
      : width - 116,
    y: initialExpanded
      ? Math.max(0, Math.round((height - 700) / 2))
      : height - 148,
    frame: true,
    transparent: false,
    backgroundColor: "#f7f7f5",
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: true,
    autoHideMenuBar: process.platform === "win32",
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === "win32") window.setMenu(null);

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
  if (!app.isPackaged) window.loadURL(devUrl);
  else window.loadFile(path.join(root, "dist", "index.html"));
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });

  const settings = readSettings();
  const orbSize = Math.max(40, Math.min(56, Number(settings.orbSize) || 48));
  orbWindow = new BrowserWindow({
    width: orbSize,
    height: orbSize,
    x: width - orbSize - 24,
    y: height - orbSize - 24,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(root, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  orbWindow.setAlwaysOnTop(true, "floating");
  if (process.platform === "darwin")
    orbWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (!app.isPackaged) orbWindow.loadURL(`${devUrl}?orb=1`);
  else
    orbWindow.loadFile(path.join(root, "dist", "index.html"), {
      query: { orb: "1" },
    });
  orbWindow.once("ready-to-show", () => syncOrbWindow(settings));

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("VoxCue");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 / 隐藏悬浮按钮",
        click: () =>
          orbWindow?.isVisible() ? orbWindow.hide() : orbWindow?.showInactive(),
      },
      { type: "separator" },
      { label: "退出 VoxCue", click: () => app.quit() },
    ]),
  );
  tray.on("click", () => {
    window?.show();
    window?.focus();
  });
  registerGlobalShortcuts(settings.shortcut, settings.sessionShortcut);
}

async function diagnostics() {
  const models = listModels();
  const installed = models.filter((model) => model.installed);
  let cdpReachable = false;
  try {
    await getJson(
      `http://127.0.0.1:${Number(readSettings().cdpPort)}/json/version`,
    );
    cdpReachable = true;
  } catch {}
  return {
    models: installed.length >= 3,
    modelFiles: installed.length,
    modelTotal: models.length,
    selectedModels: models.filter((model) => model.selected).map((model) => model.name),
    voiceprint: fs.existsSync(
      path.join(app.getPath("userData"), "voiceprint.json"),
    ),
    shortcutRegistered,
    cdpReachable,
    platform: process.platform,
    appVersion: app.getVersion(),
  };
}

app.on("web-contents-created", (_event, contents) => {
  contents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const url = _webContents.getURL() || "";
      const trusted =
        url.startsWith("file://") ||
        url.startsWith("http://localhost") ||
        url.startsWith("http://127.0.0.1");
      callback(permission === "media" && trusted);
    },
  );
});

ipcMain.handle("settings:get", () => readSettings());
ipcMain.handle("settings:set", (_event, patch) =>
  writeSettings({ ...readSettings(), ...patch }),
);
ipcMain.handle("settings:reset", () => {
  try {
    fs.unlinkSync(path.join(app.getPath("userData"), "voiceprint.json"));
  } catch {}
  return writeSettings({ ...defaultSettings });
});
ipcMain.handle("diagnostics:check", () => diagnostics());
ipcMain.handle("models:list", () => listModels());
ipcMain.handle("models:download", (_event, id) => installModel(id));
ipcMain.handle("models:select", (_event, { type, id }) => {
  if (!modelSettingKeys[type]) throw new Error("模型类型无效");
  const model = modelRecord(id);
  if (model.type !== type) throw new Error("模型类型不匹配");
  if (!modelInstalled(model)) throw new Error("请先下载模型");
  return writeSettings({ ...readSettings(), [modelSettingKeys[type]]: id });
});
ipcMain.handle("shell:open-settings", (_event, area) => {
  const url =
    process.platform === "darwin"
      ? area === "microphone"
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        : "x-apple.systempreferences:com.apple.preference.general"
      : area === "microphone"
        ? "ms-settings:privacy-microphone"
        : "ms-settings:privacy";
  return shell.openExternal(url);
});
ipcMain.on("orb:action", (_event, action) => {
  if (action === "show-main") {
    window?.show();
    window?.focus();
    return;
  }
  if (window && !window.isDestroyed())
    window.webContents.send("orb:action", action);
});
ipcMain.on("orb:drag-start", () => {
  orbDragOrigin = orbWindow && !orbWindow.isDestroyed() ? orbWindow.getBounds() : null;
});
ipcMain.on("orb:move", (_event, { deltaX = 0, deltaY = 0 } = {}) => {
  if (!orbDragOrigin || !orbWindow || orbWindow.isDestroyed()) return;
  orbWindow.setPosition(
    Math.round(orbDragOrigin.x + Number(deltaX)),
    Math.round(orbDragOrigin.y + Number(deltaY)),
  );
});
ipcMain.on("orb:drag-end", () => {
  orbDragOrigin = null;
});
ipcMain.on("orb:state", (_event, state) => {
  if (orbWindow && !orbWindow.isDestroyed())
    orbWindow.webContents.send("orb:state", state);
});
ipcMain.handle("cdp:discover", async (_event, port) => discoverCdp(port));
ipcMain.handle("cdp:launch-chatgpt", async (_event, port) =>
  launchChatGpt(port),
);
ipcMain.handle("cdp:connect", async (_event, port) => {
  const result = await connectCdp(port);
  writeSettings({
    ...readSettings(),
    cdpPort: Number(port),
    cdpConnected: true,
  });
  return result;
});
ipcMain.handle("cdp:disconnect", () => {
  cdpShouldReconnect = false;
  if (cdpReconnectTimer) {
    clearTimeout(cdpReconnectTimer);
    cdpReconnectTimer = null;
  }
  closeCdp();
  emitCdp({ type: "disconnected" });
  writeSettings({ ...readSettings(), cdpConnected: false });
  return { connected: false };
});
ipcMain.handle("cdp:write", async (_event, { text, append }) =>
  writeToComposer(text, append),
);
ipcMain.handle("cdp:send", () => sendComposer());
ipcMain.handle("cdp:sessions", () => listCdpSessions());
ipcMain.handle("cdp:sessions-switch", (_event, { id, href }) =>
  switchCdpSession(id, href),
);
ipcMain.handle("cdp:sessions-new", () => createCdpSession());
ipcMain.handle("cdp:snapshot", () => snapshotCdpConversation());
ipcMain.handle("shell:open-external", (_event, url) => shell.openExternal(url));
ipcMain.handle("speech:start", async (_event, options) => {
  try {
    return await startSpeech(options);
  } catch (error) {
    stopSpeech();
    throw error;
  }
});
ipcMain.handle("speech:push", (_event, samples) => {
  if (!speechSocket || speechSocket.readyState !== WebSocket.OPEN)
    return { sent: false };
  const data = Buffer.from(samples);
  speechSocket.send(data);
  return { sent: true };
});
ipcMain.handle("speech:command", (_event, command) => {
  if (!speechSocket || speechSocket.readyState !== WebSocket.OPEN)
    return { sent: false };
  speechSocket.send(JSON.stringify(command));
  return { sent: true };
});
ipcMain.handle("speech:remove-speaker-sample", (_event, indexValue) => {
  const index = Number(indexValue);
  const embeddingPath = path.join(app.getPath("userData"), "voiceprint.json");
  if (!Number.isInteger(index) || index < 0)
    throw new Error("声纹样本索引无效");
  let embeddings = [];
  try {
    const saved = JSON.parse(fs.readFileSync(embeddingPath, "utf8"));
    embeddings = Array.isArray(saved[0]) ? saved : [saved];
  } catch {}
  if (index >= embeddings.length) throw new Error("声纹样本不存在");
  embeddings.splice(index, 1);
  if (embeddings.length) fs.writeFileSync(embeddingPath, JSON.stringify(embeddings));
  else {
    try { fs.unlinkSync(embeddingPath); } catch {}
  }
  if (speechSocket?.readyState === WebSocket.OPEN)
    speechSocket.send(JSON.stringify({ type: "remove_speaker_sample", index }));
  return { removed: true, remaining: embeddings.length };
});
ipcMain.handle("speech:clear-speaker", () => {
  try {
    fs.unlinkSync(path.join(app.getPath("userData"), "voiceprint.json"));
  } catch {}
  if (speechSocket?.readyState === WebSocket.OPEN)
    speechSocket.send(JSON.stringify({ type: "clear_speaker" }));
  return { cleared: true };
});
ipcMain.handle("speech:stop", () => {
  stopSpeech();
  return { stopped: true };
});

ipcMain.on("window:set-expanded", (_event, expanded) => {
  if (!window) return;
  if (expanded) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  const [x, y] = window.getPosition();
  const nextWidth = expanded ? 330 : 84;
  const nextHeight = expanded ? 196 : 84;
  window.setBounds(
    {
      x: x - (nextWidth - window.getBounds().width),
      y: y - (nextHeight - window.getBounds().height),
      width: nextWidth,
      height: nextHeight,
    },
    true,
  );
});

ipcMain.on("window:close", () => app.quit());

app.on("second-instance", () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

if (gotSingleInstanceLock) app.whenReady().then(createWindow);
app.on("before-quit", () => {
  isQuitting = true;
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  stopSpeech();
});
app.on("window-all-closed", () => {
  stopSpeech();
  app.quit();
});
