import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import brandMarkUrl from "./assets/brand-mark.svg";
import { canRouteSessionCommand, parseSessionCommand } from "./session-commands";

type Page =
  | "onboarding"
  | "voice"
  | "voiceprint"
  | "targets"
  | "models"
  | "settings"
  | "diagnostics";
type Status =
  | "idle"
  | "listening"
  | "processing"
  | "verified"
  | "rejected"
  | "error";
type VoiceTestStatus =
  | "idle"
  | "listening"
  | "passed"
  | "failed"
  | "timeout"
  | "error";
type SendStatus = "idle" | "writing" | "written" | "sent" | "failed";
type ModelType = "asr" | "vad" | "speaker";
type ConversationEntry = {
  id: number;
  text: string;
  timestamp: number;
  score: number | null;
  sent: boolean;
  sessionId?: string | null;
  sessionTitle?: string;
  replySummary?: string;
};
type ChatSession = {
  id: string;
  title: string;
  href: string;
  current?: boolean;
  projectKey?: string;
  projectLabel?: string;
  groupKey?: string;
  groupLabel?: string;
};
type ConversationSnapshot = {
  currentId: string | null;
  title: string;
  latestUser?: string;
  latestReply?: string;
  replySummary?: string;
  capturedAt?: number;
};

type Settings = {
  firstRunComplete: boolean;
  onboardingVersion: number;
  microphoneId: string;
  onlyMyVoice: boolean;
  modelLanguage: string;
  endpointSeconds: number;
  punctuation: boolean;
  writeToChatGPT: boolean;
  autoSend: boolean;
  appendDraft: boolean;
  showOrb: boolean;
  orbSize: number;
  launchAtLogin: boolean;
  shortcut: string;
  sessionShortcut: string;
  cdpPort: number;
  speakerThreshold: number;
  stopWords: string;
  cdpConnected: boolean;
  voiceSamples: { id: number; duration: number }[];
  sendMode: "write" | "send";
  conversationHistory: ConversationEntry[];
  asrModelId: string;
  vadModelId: string;
  speakerModelId: string;
  activeSessionId: string | null;
  activeSessionTitle: string;
  activeSessionHref: string;
  pinnedSessionIds: string[];
};

const defaults: Settings = {
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
  asrModelId: "zipformer-zh-int8",
  vadModelId: "silero-vad",
  speakerModelId: "eres2net-base",
  activeSessionId: null,
  activeSessionTitle: "",
  activeSessionHref: "",
  pinnedSessionIds: [],
};
const pageNames: Record<Page, string> = {
  onboarding: "首次引导",
  voice: "语音输入",
  voiceprint: "声纹",
  targets: "目标应用",
  models: "模型管理",
  settings: "设置",
  diagnostics: "权限与诊断",
};
const statusNames: Record<Status, string> = {
  idle: "准备就绪",
  listening: "正在听写",
  processing: "正在验证声纹",
  verified: "声纹已验证",
  rejected: "声纹未通过",
  error: "需要检查设置",
};
function downsample(
  input: Float32Array,
  inputRate: number,
  outputRate = 16000,
) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span className="icon" style={{ fontSize: size }} aria-hidden="true">
      {(
        {
          mic: "♩",
          fingerprint: "◎",
          settings: "⚙",
          sparkle: "✦",
          target: "▦",
          help: "?",
          more: "⋯",
          check: "✓",
          plus: "+",
          trash: "⌫",
          chevron: "›",
          audio: "〽",
          pause: "Ⅱ",
          send: "↑",
          refresh: "↻",
          lock: "▣",
          diagnostics: "✓",
        } as Record<string, string>
      )[name] || "•"}
    </span>
  );
}

function normalizeCommand(value: string) {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?；;：:]+/g, "");
}
function matchesStopWord(text: string, configured: string) {
  const normalized = normalizeCommand(text);
  return configured
    .split(/[，,、;；\n]+/)
    .map(normalizeCommand)
    .filter(Boolean)
    .some((word) => normalized === word || normalized.endsWith(word));
}

function OrbApp() {
  const [state, setState] = useState<{
    listening?: boolean;
    rejected?: boolean;
  }>({});
  const dragRef = useRef({ pointerId: -1, startX: 0, startY: 0, dragged: false });
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    document.body.classList.add("orb-body");
    return () => document.body.classList.remove("orb-body");
  }, []);
  useEffect(() => window.desktop?.orb.onState(setState), []);
  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
  }, []);
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { pointerId: event.pointerId, startX: event.screenX, startY: event.screenY, dragged: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.desktop?.orb.dragStart();
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - drag.startX;
    const deltaY = event.screenY - drag.startY;
    if (!drag.dragged && Math.hypot(deltaX, deltaY) < 4) return;
    drag.dragged = true;
    window.desktop?.orb.move({ deltaX, deltaY });
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    window.desktop?.orb.dragEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setTimeout(() => {
      if (dragRef.current.pointerId === event.pointerId)
        dragRef.current = { pointerId: -1, startX: 0, startY: 0, dragged: false };
    }, 0);
  };
  const onClick = () => {
    if (dragRef.current.dragged) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      window.desktop?.orb.action("toggle");
    }, 240);
  };
  const onDoubleClick = () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    window.desktop?.orb.action("show-main");
  };
  return (
    <div className="orb-page">
      <button
        className={`system-orb ${state.listening ? "listening" : ""} ${state.rejected ? "rejected" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        aria-label={state.listening ? "停止听写" : "开始听写"}
      >
        {state.listening ? (
          <svg className="orb-signal" viewBox="0 0 128 128" aria-hidden="true">
            <circle cx="25" cy="64" r="8" />
            <path className="orb-wave-line" d="M43 64 C53 42 62 42 72 61 S91 84 108 55" />
          </svg>
        ) : (
          <img className="orb-logo" src={brandMarkUrl} alt="VoxCue" />
        )}
      </button>
    </div>
  );
}

export default function App() {
  return new URLSearchParams(window.location.search).get("orb") === "1" ? (
    <OrbApp />
  ) : (
    <MainApp />
  );
}

function MainApp() {
  const [page, setPage] = useState<Page>("onboarding");
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micCheck, setMicCheck] = useState<
    "idle" | "checking" | "ok" | "quiet" | "error"
  >("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [cdpTarget, setCdpTarget] = useState<any>(null);
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [cdpBusy, setCdpBusy] = useState(false);
  const [recordingSample, setRecordingSample] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceTest, setVoiceTest] = useState<VoiceTestStatus>("idle");
  const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [conversationSnapshot, setConversationSnapshot] = useState<ConversationSnapshot | null>(null);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<any[]>([]);
  const [modelBusy, setModelBusy] = useState<string | null>(null);
  const micCheckInProgressRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const startInProgressRef = useRef(false);
  const listeningGenerationRef = useRef(0);
  const audioRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const settingsRef = useRef(settings);
  const speakerVerifiedRef = useRef(false);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSampleDurationRef = useRef(0);
  const voiceTestModeRef = useRef(false);
  const voiceScoreRef = useRef<number | null>(null);
  const voiceTestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSessionRef = useRef<ChatSession | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  const switchSessionRef = useRef<((session: ChatSession, fromVoice?: boolean) => void) | null>(null);
  const draftSessionRef = useRef<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    let active = true;
    window.desktop?.settings
      .get()
      .then(async (value) => {
        const shouldReconnect = Boolean(value.cdpConnected);
        const restored = {
          ...defaults,
          ...value,
          onboardingVersion: Number(value.onboardingVersion || 0),
          cdpConnected: false,
        };
        if (!active) return;
        setSettings(restored);
        setConversationHistory(Array.isArray(restored.conversationHistory) ? restored.conversationHistory : []);
        if (restored.activeSessionId) {
          setCurrentSession({
            id: restored.activeSessionId,
            title: restored.activeSessionTitle || "当前对话",
            href: restored.activeSessionHref || "",
            current: true,
          });
        }
        setLoaded(true);
        setPage(
          value.firstRunComplete && Number(value.onboardingVersion || 0) >= 2
            ? "voice"
            : "onboarding",
        );
        if (!shouldReconnect) return;
        try {
          const target = await window.desktop?.cdp.connect(restored.cdpPort);
          if (!active) return;
          setCdpTarget(target);
          setSettings((old) => ({ ...old, cdpConnected: true }));
        } catch {
          if (!active) return;
          setCdpTarget(null);
          setSettings((old) => ({ ...old, cdpConnected: false }));
          await window.desktop?.settings.set({ cdpConnected: false });
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const refreshModels = useCallback(async () => {
    try {
      const models = await window.desktop?.models.list();
      if (models) setModelCatalog(models);
    } catch {}
  }, []);
  const refreshConversationSnapshot = useCallback(async () => {
    try {
      const value = await window.desktop?.cdp.snapshot();
      if (value?.ok !== false) setConversationSnapshot(value || null);
      return value;
    } catch {
      // A disconnected CDP target should not erase the last known summary.
      return null;
    }
  }, []);
  const refreshSessions = useCallback(async () => {
    try {
      const value = await window.desktop?.cdp.sessions();
      if (!value) return;
      const list = Array.isArray(value.sessions) ? value.sessions : [];
      setSessions(list);
      const active = list.find((item) => item.id === value.currentId) ||
        (value.currentId ? { id: value.currentId, title: value.currentTitle || "当前对话", href: "", current: true } : null);
      if (active) {
        setCurrentSession(active);
        await window.desktop?.settings.set({
          activeSessionId: active.id,
          activeSessionTitle: active.title,
          activeSessionHref: active.href,
        });
      }
      await refreshConversationSnapshot();
    } catch {
      // The selector remains usable with the last known session while CDP reconnects.
    }
  }, [refreshConversationSnapshot]);
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);
  useEffect(() => {
    const remove = window.desktop?.onShortcut?.(() => toggleListening());
    return () => remove?.();
  });
  useEffect(() => {
    const remove = window.desktop?.onSessionShortcut?.(() => {
      if (!settingsRef.current.firstRunComplete) return;
      setSessionPickerOpen(true);
      setError("");
    });
    return () => remove?.();
  }, []);
  useEffect(() => {
    if (!sessionPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSessionPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionPickerOpen]);
  useEffect(() => {
    const remove = window.desktop?.orb.onAction((action) => {
      if (action === "toggle") toggleListening();
      if (action === "send") writeDemo(true);
    });
    return () => remove?.();
  });
  useEffect(() => {
    const remove = window.desktop?.cdp.onEvent((event) => {
      if (event.type === "connected") {
        setCdpTarget({ title: event.title, url: event.url });
        setSettings((old) => ({ ...old, cdpConnected: true }));
        refreshSessions();
      }
      if (event.type === "disconnected") {
        setCdpTarget(null);
        setSettings((old) => ({ ...old, cdpConnected: false }));
      }
    });
    return () => remove?.();
  }, [refreshSessions]);
  const save = useCallback((patch: Partial<Settings>) => {
    setSettings((old) => ({ ...old, ...patch }));
    return window.desktop?.settings.set(patch);
  }, []);
  const recordConversation = useCallback((text: string, sent: boolean, score: number | null, session = currentSessionRef.current) => {
    setConversationHistory((old) => {
      const next = [...old, { id: Date.now(), text, timestamp: Date.now(), score, sent, sessionId: session?.id || null, sessionTitle: session?.title || "当前对话" }].slice(-100);
      window.desktop?.settings.set({ conversationHistory: next });
      return next;
    });
  }, []);
  const loadDiagnostics = useCallback(async () => {
    const value = await window.desktop?.diagnostics.check();
    setDiagnostic(value);
    return value;
  }, []);
  useEffect(() => {
    if (page === "diagnostics")
      loadDiagnostics().catch(() => setDiagnostic(null));
  }, [
    page,
    loadDiagnostics,
    settings.cdpConnected,
    settings.voiceSamples.length,
  ]);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "audioinput"));
    } catch {
      setDevices([]);
    }
  }, []);
  const checkMicrophone = useCallback(async () => {
    if (micCheckInProgressRef.current) return;
    micCheckInProgressRef.current = true;
    setMicCheck("checking");
    setMicLevel(0);
    setError("");
    let stream: MediaStream | null = null;
    let audio: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: settings.microphoneId
          ? { deviceId: { exact: settings.microphoneId } }
          : true,
      });
      audio = new AudioContext();
      await audio.resume();
      const source = audio.createMediaStreamSource(stream);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let peak = 0;
      for (let i = 0; i < 24; i += 1) {
        analyser.getByteTimeDomainData(data);
        for (const value of data)
          peak = Math.max(peak, Math.abs(value - 128) / 128);
        setMicLevel(Math.min(1, peak * 4));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "audioinput"));
      setMicCheck(peak > 0.015 ? "ok" : "quiet");
    } catch {
      setMicCheck("error");
      setError("麦克风检测失败，请在系统设置中允许 VoxCue 使用麦克风。");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      try {
        await audio?.close();
      } finally {
        micCheckInProgressRef.current = false;
      }
    }
  }, [settings.microphoneId]);
  useEffect(() => {
    const remove = window.desktop?.speech.onEvent((event) => {
      if (event.type === "speech_start") {
        voiceScoreRef.current = null;
        speakerVerifiedRef.current = false;
        setStatus("listening");
      }
      if (event.type === "partial") {
        if (!voiceTestModeRef.current) setTranscript(event.text || "");
        setStatus("listening");
      }
      if (event.type === "speaker_verified") {
        voiceScoreRef.current = typeof event.score === "number" ? event.score : null;
        speakerVerifiedRef.current = true;
        if (!voiceTestModeRef.current) setStatus("listening");
        if (voiceTestModeRef.current) {
          if (voiceTestTimerRef.current)
            clearTimeout(voiceTestTimerRef.current);
          setVoiceTest("passed");
          setTimeout(() => {
            stopListening();
            voiceTestModeRef.current = false;
          }, 700);
        }
      }
      if (event.type === "speaker_rejected") {
        voiceScoreRef.current = typeof event.score === "number" ? event.score : null;
        speakerVerifiedRef.current = false;
        if (!voiceTestModeRef.current) setStatus("listening");
        if (voiceTestModeRef.current) {
          if (voiceTestTimerRef.current)
            clearTimeout(voiceTestTimerRef.current);
          setVoiceTest("failed");
          setTimeout(() => {
            stopListening();
            voiceTestModeRef.current = false;
          }, 700);
        }
      }
      if (event.type === "speaker_unavailable") {
        voiceScoreRef.current = null;
        speakerVerifiedRef.current = false;
        if (voiceTestModeRef.current) {
          setVoiceTest("error");
          voiceTestModeRef.current = false;
          if (voiceTestTimerRef.current) clearTimeout(voiceTestTimerRef.current);
          setError(event.reason || "语音片段太短，暂时无法完成声纹验证。");
          setTimeout(stopListening, 300);
        } else {
          setStatus("listening");
        }
      }
      if (event.type === "speech_end" && streamRef.current && !voiceTestModeRef.current) {
        setStatus("listening");
      }
      if (event.type === "final") {
        if (voiceTestModeRef.current) return;
        const text = event.text || "";
        const cfg = settingsRef.current;
        const sessionCommand = parseSessionCommand(text);
        // Session routing is a privileged action when voice protection is
        // enabled. An unverified speaker must never switch the target chat.
        if (sessionCommand && canRouteSessionCommand(cfg.onlyMyVoice, speakerVerifiedRef.current)) {
          const query = sessionCommand.query.trim().toLocaleLowerCase();
          const matches = sessionsRef.current.filter((item) => {
            const title = item.title.toLocaleLowerCase();
            return title === query || title.includes(query) || query.includes(title);
          });
          const exact = matches.find((item) => item.title.toLocaleLowerCase() === query);
          setTranscript("");
          setSendStatus("idle");
          setSessionPickerOpen(true);
          setSessionSearch(sessionCommand.query);
          stopListening();
          if (!cfg.cdpConnected) {
            setError("语音切换需要先连接 ChatGPT，已打开对话选择器。");
          } else if (exact || matches.length === 1) {
            setError("");
            switchSessionRef.current?.(exact || matches[0], true);
          } else if (!matches.length) {
            setError(`没有找到“${sessionCommand.query}”对话，请在选择器中确认标题。`);
          } else {
            setError(`找到 ${matches.length} 个匹配对话，请在选择器中选择。`);
          }
          return;
        }
        if (matchesStopWord(text, cfg.stopWords)) {
          setTranscript("");
          setSendStatus("idle");
          stopListening();
          return;
        }
        setTranscript(text);
        setStatus(speakerVerifiedRef.current ? "verified" : "processing");
        if (
          speakerVerifiedRef.current &&
          cfg.writeToChatGPT &&
          cfg.cdpConnected
        ) {
          const shouldSend = cfg.autoSend || cfg.sendMode === "send";
          setSendStatus("writing");
          draftSessionRef.current = currentSessionRef.current?.id || null;
          const deliverySession = currentSessionRef.current;
          window.desktop?.cdp
            .write(text, cfg.appendDraft)
            .then(() => shouldSend && window.desktop?.cdp.send())
            .then(() => {
              recordConversation(text, shouldSend, voiceScoreRef.current, deliverySession);
              setSendStatus(shouldSend ? "sent" : "written");
              draftSessionRef.current = null;
            })
            .catch((cause) => {
              setSendStatus("failed");
              setError(
                cause instanceof Error ? cause.message : "写入 ChatGPT 失败",
              );
            });
        }
      }
      if (event.type === "enrolled") {
        const duration = pendingSampleDurationRef.current;
        pendingSampleDurationRef.current = 0;
        if (duration)
          setSettings((old) => {
            const voiceSamples = [
              ...old.voiceSamples,
              { id: Date.now(), duration },
            ];
            window.desktop?.settings.set({ voiceSamples });
            return { ...old, voiceSamples };
          });
        setStatus("verified");
        setTranscript("");
        setTimeout(stopListening, 600);
      }
      if (event.type === "error" || event.type === "enrollment_error") {
        pendingSampleDurationRef.current = 0;
        if (voiceTestModeRef.current) {
          setVoiceTest("error");
          voiceTestModeRef.current = false;
          if (voiceTestTimerRef.current)
            clearTimeout(voiceTestTimerRef.current);
        }
        setError(event.message || "本地语音服务错误");
        setStatus("error");
        setTimeout(stopListening, 300);
      }
    });
    return () => {
      remove?.();
      if (voiceTestTimerRef.current) clearTimeout(voiceTestTimerRef.current);
      if (recordStopTimerRef.current) clearTimeout(recordStopTimerRef.current);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      processorRef.current?.disconnect();
      audioRef.current?.close();
      window.desktop?.speech.stop();
    };
  }, [refreshDevices, recordConversation]);

  const stopListening = useCallback(() => {
    listeningGenerationRef.current += 1;
    startInProgressRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioRef.current?.close();
    audioRef.current = null;
    window.desktop?.speech.stop();
    if (meterRef.current) clearInterval(meterRef.current);
    setStatus("idle");
  }, []);
  const startListening = useCallback(
    async (requireSpeaker = settings.onlyMyVoice) => {
      if (startInProgressRef.current || streamRef.current) return;
      const generation = ++listeningGenerationRef.current;
      startInProgressRef.current = true;
      setError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: settings.microphoneId
            ? { deviceId: { exact: settings.microphoneId } }
            : true,
        });
        if (generation !== listeningGenerationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const audio = new AudioContext();
        audioRef.current = audio;
        const source = audio.createMediaStreamSource(stream);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const processor = audio.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          const samples = downsample(
            new Float32Array(event.inputBuffer.getChannelData(0)),
            audio.sampleRate,
          );
          event.outputBuffer.getChannelData(0).fill(0);
          window.desktop?.speech.push(samples.buffer);
        };
        source.connect(processor);
        processor.connect(audio.destination);
        processorRef.current = processor;
        await window.desktop?.speech.start({
          requireSpeaker,
          speakerThreshold: settings.speakerThreshold,
          punctuation: settings.punctuation,
          endpointSeconds: settings.endpointSeconds,
          asrModelId: settings.asrModelId,
          vadModelId: settings.vadModelId,
          speakerModelId: settings.speakerModelId,
        });
        if (generation !== listeningGenerationRef.current) return;
        setStatus("listening");
        if (!voiceTestModeRef.current) setTranscript("正在聆听…");
        const data = new Uint8Array(analyser.frequencyBinCount);
        meterRef.current = setInterval(() => {
          analyser.getByteFrequencyData(data);
        }, 120);
      } catch (cause) {
        if (generation !== listeningGenerationRef.current) return;
        stopListening();
        if (voiceTestModeRef.current) {
          setVoiceTest("error");
          voiceTestModeRef.current = false;
        }
        setStatus("error");
        setError(
          cause instanceof Error
            ? cause.message
          : "无法访问麦克风或本地模型未就绪。",
        );
      } finally {
        if (generation === listeningGenerationRef.current)
          startInProgressRef.current = false;
      }
    },
    [
      settings.microphoneId,
      settings.onlyMyVoice,
      settings.punctuation,
      settings.endpointSeconds,
      settings.speakerThreshold,
      settings.asrModelId,
      settings.vadModelId,
      settings.speakerModelId,
      stopListening,
    ],
  );
  const toggleListening = () =>
    status === "listening" ? stopListening() : startListening();

  const startSample = async () => {
    if (recordingSample) return;
    let enrollmentStarted = false;
    try {
      if (!streamRef.current) {
        await startListening();
        if (!streamRef.current) return;
      }
      const started = await window.desktop?.speech.command({
        type: "enroll_start",
      });
      if (!started?.sent) throw new Error("语音服务尚未连接，请稍后重试。");
      enrollmentStarted = true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      if (recordStopTimerRef.current) clearTimeout(recordStopTimerRef.current);
      recorder.start();
      setRecordingSample(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(
        () => setRecordSeconds((seconds) => seconds + 1),
        1000,
      );
      const startedAt = Date.now();
      recorder.onstop = () => {
        if (recordStopTimerRef.current) {
          clearTimeout(recordStopTimerRef.current);
          recordStopTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        pendingSampleDurationRef.current = Math.max(
          1,
          Math.round((Date.now() - startedAt) / 1000),
        );
        setRecordingSample(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        window.desktop?.speech.command({ type: "enroll_end" });
      };
      recordStopTimerRef.current = setTimeout(() => {
        recordStopTimerRef.current = null;
        if (mediaRecorderRef.current?.state === "recording")
          mediaRecorderRef.current.stop();
      }, 15000);
    } catch {
      if (enrollmentStarted) window.desktop?.speech.command({ type: "enroll_end" });
      setError("声纹录制需要麦克风权限。");
    }
  };
  const stopSample = () => {
    if (mediaRecorderRef.current?.state === "recording")
      mediaRecorderRef.current.stop();
  };
  const runVoiceTest = async () => {
    if (voiceTest === "listening") {
      if (voiceTestTimerRef.current) clearTimeout(voiceTestTimerRef.current);
      voiceTestModeRef.current = false;
      stopListening();
      setVoiceTest("idle");
      return;
    }
    if (!settings.voiceSamples.length) {
      setVoiceTest("error");
      setError("请先登记至少一段声纹样本。");
      return;
    }
    stopListening();
    setError("");
    setVoiceTest("listening");
    voiceTestModeRef.current = true;
    await startListening(true);
    if (!voiceTestModeRef.current) return;
    voiceTestTimerRef.current = setTimeout(() => {
      setVoiceTest("timeout");
      stopListening();
      voiceTestModeRef.current = false;
    }, 20000);
  };

  const connectCdp = async () => {
    setCdpBusy(true);
    setError("");
    try {
      const target = await window.desktop?.cdp.connect(settings.cdpPort);
      setCdpTarget(target);
      await save({ cdpConnected: true });
      await refreshSessions();
    } catch (cause) {
      setCdpTarget(null);
      await save({ cdpConnected: false });
      setError(
        cause instanceof Error
          ? cause.message
          : "CDP 连接失败，请确认 ChatGPT 已开启调试端口。",
      );
    } finally {
      setCdpBusy(false);
    }
  };
  const launchAndConnectCdp = async () => {
    setCdpBusy(true);
    setError("");
    try {
      await window.desktop?.cdp.launchChatGPT(settings.cdpPort);
      const target = await window.desktop?.cdp.connect(settings.cdpPort);
      setCdpTarget(target);
      await save({ cdpConnected: true });
      await refreshSessions();
    } catch (cause) {
      setCdpTarget(null);
      await save({ cdpConnected: false });
      setError(
        cause instanceof Error ? cause.message : "无法启动或连接 ChatGPT。",
      );
    } finally {
      setCdpBusy(false);
    }
  };
  const switchSession = async (session: ChatSession, fromVoice = false) => {
    if (sessionBusy) return false;
    if (!settings.cdpConnected) {
      setError("请先连接 ChatGPT，再切换对话。");
      return false;
    }
    if (!fromVoice && (status === "listening" || status === "processing" || sendStatus === "writing")) {
      setError("请先暂停听写，再切换 ChatGPT 对话。");
      return false;
    }
    if (!fromVoice && transcript.trim() && sendStatus !== "sent") {
      const discard = window.confirm("当前有尚未发送的草稿。切换对话会清除此草稿，是否继续？");
      if (!discard) return false;
      setTranscript("");
      setSendStatus("idle");
      draftSessionRef.current = null;
    }
    if (fromVoice) {
      // The final transcript is the routing command itself. It must never be
      // treated as a ChatGPT draft or trigger a discard confirmation.
      setTranscript("");
      setSendStatus("idle");
      draftSessionRef.current = null;
    }
    setSessionBusy(true);
    setError("");
    try {
      const value = await window.desktop?.cdp.switchSession(session.id, session.href);
      if (!value) throw new Error("切换对话失败");
      const active = (value.sessions || []).find((item: ChatSession) => item.id === value.currentId) || session;
      setSessions(value.sessions || []);
      setCurrentSession(active);
      await save({
        activeSessionId: active.id,
        activeSessionTitle: active.title,
        activeSessionHref: active.href,
      });
      await refreshConversationSnapshot();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "切换 ChatGPT 对话失败";
      if (/CDP 未连接|连接已关闭|输入框未就绪/.test(message)) await save({ cdpConnected: false });
      setError(message);
      return false;
    } finally {
      setSessionBusy(false);
    }
  };
  switchSessionRef.current = switchSession;
  const createSession = async () => {
    if (sessionBusy || !settings.cdpConnected) {
      if (!settings.cdpConnected) setError("请先连接 ChatGPT，再新建对话。");
      return;
    }
    if (status === "listening" || status === "processing" || sendStatus === "writing") {
      setError("请先暂停听写，再新建 ChatGPT 对话。");
      return;
    }
    if (transcript.trim() && sendStatus !== "sent") {
      const discard = window.confirm("当前有尚未发送的草稿。新建对话会清除此草稿，是否继续？");
      if (!discard) return;
      setTranscript("");
      setSendStatus("idle");
      draftSessionRef.current = null;
    }
    setSessionBusy(true);
    setError("");
    try {
      const value = await window.desktop?.cdp.newSession();
      if (!value) throw new Error("新建对话失败");
      const list = value.sessions || [];
      setSessions(list);
      const active = list.find((item: ChatSession) => item.id === value.currentId) || null;
      if (active) {
        setCurrentSession(active);
        await save({ activeSessionId: active.id, activeSessionTitle: active.title, activeSessionHref: active.href });
        await refreshConversationSnapshot();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "新建 ChatGPT 对话失败");
    } finally {
      setSessionBusy(false);
    }
  };
  const toggleSessionPin = async (id: string) => {
    const pinned = Array.isArray(settings.pinnedSessionIds) ? settings.pinnedSessionIds : [];
    const next = pinned.includes(id) ? pinned.filter((item) => item !== id) : [...pinned, id];
    await save({ pinnedSessionIds: next });
  };
  const downloadModel = async (id: string, select?: { type: ModelType; id: string }) => {
    setModelBusy(id);
    setError("");
    try {
      const downloaded = await window.desktop?.models.download(id);
      if (select && downloaded?.installed) {
        const value = await window.desktop?.models.select(select.type, select.id);
        const key = select.type === "asr" ? "asrModelId" : select.type === "vad" ? "vadModelId" : "speakerModelId";
        setSettings((old) => ({ ...old, [key]: select.id, ...(value || {}) }));
      }
      await refreshModels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型下载失败");
    } finally {
      setModelBusy(null);
    }
  };
  const selectModel = async (type: ModelType, id: string) => {
    setError("");
    try {
      const value = await window.desktop?.models.select(type, id);
      const key = type === "asr" ? "asrModelId" : type === "vad" ? "vadModelId" : "speakerModelId";
      setSettings((old) => ({ ...old, [key]: id, ...(value || {}) }));
      await refreshModels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "模型选择失败");
    }
  };
  const writeDemo = async (send = settings.sendMode === "send") => {
    const text = transcript.trim();
    if (!text) {
      setError("当前没有可发送的文字");
      return;
    }
    setSendStatus("writing");
    try {
      if (draftSessionRef.current && currentSessionRef.current?.id !== draftSessionRef.current) {
        setError("当前草稿属于另一个 ChatGPT 对话，请先切回原对话后再发送。");
        setSendStatus("failed");
        return;
      }
      const deliverySession = currentSessionRef.current;
      await window.desktop?.cdp.write(text, settings.appendDraft);
      if (send) await window.desktop?.cdp.send();
      setSendStatus(send ? "sent" : "written");
      recordConversation(text, send, voiceScoreRef.current, deliverySession);
      draftSessionRef.current = null;
      setTranscript(text);
      setStatus("verified");
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "写入 ChatGPT 失败";
      if (/CDP 未连接|连接已关闭/.test(message)) save({ cdpConnected: false });
      setSendStatus("failed");
      setError(message);
      setStatus("error");
    }
  };

  const isListening = status === "listening" || status === "processing";
  useEffect(() => {
    window.desktop?.orb.updateState({
      listening: isListening,
      rejected: status === "rejected",
    });
  }, [isListening, status]);
  if (!loaded) return <div className="app-loading">正在启动…</div>;
  const setupComplete =
    settings.firstRunComplete && settings.onboardingVersion >= 2;
  const visiblePages = setupComplete
    ? (Object.keys(pageNames) as Page[]).filter((item) => item !== "onboarding")
    : (["onboarding"] as Page[]);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <img src={brandMarkUrl} alt="恰言" />
          </span>
          <span>VoxCue</span>
        </div>
        <nav>
          {visiblePages.map((item) => (
            <button
              key={item}
              className={page === item ? "nav-item active" : "nav-item"}
              onClick={() => setPage(item)}
            >
              <Icon
                name={
                  item === "onboarding"
                    ? "sparkle"
                    : item === "voice"
                      ? "mic"
                      : item === "voiceprint"
                        ? "fingerprint"
                      : item === "targets"
                          ? "target"
                          : item === "models"
                            ? "sparkle"
                          : item === "diagnostics"
                            ? "diagnostics"
                            : "settings"
                }
              />
              {pageNames[item]}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={`status-dot ${isListening ? "active" : ""}`} />
          {isListening ? "正在听写" : "本地服务待命"}
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <span>{pageNames[page]}</span>
          <div>
            <button className="icon-button">
              <Icon name="help" />
            </button>
            <button className="icon-button">
              <Icon name="more" />
            </button>
          </div>
        </header>
        <main>
          {page === "onboarding" && (
            <OnboardingFlow
              onFinish={() => {
                save({ firstRunComplete: true, onboardingVersion: 2 });
                setPage("voice");
              }}
              onMic={checkMicrophone}
              onRefreshDevices={refreshDevices}
              devices={devices}
              selectedDevice={settings.microphoneId}
              onDevice={(microphoneId) => {
                setMicCheck("idle");
                save({ microphoneId });
              }}
              micCheck={micCheck}
              micLevel={micLevel}
              samples={settings.voiceSamples}
              recording={recordingSample}
              recordSeconds={recordSeconds}
              onStartSample={startSample}
              onStopSample={stopSample}
              cdpConnected={settings.cdpConnected}
              onConnect={connectCdp}
              onLaunch={launchAndConnectCdp}
              cdpBusy={cdpBusy}
              catalog={modelCatalog}
              settings={settings}
              modelBusy={modelBusy}
              onDownloadModel={downloadModel}
              onSelectModel={selectModel}
            />
          )}
          {page === "voice" && (
            <VoicePage
              status={status}
              transcript={transcript}
              error={error}
              cdpConnected={settings.cdpConnected}
              sendStatus={sendStatus}
              onToggle={toggleListening}
              sendMode={settings.sendMode}
              onMode={(sendMode) => save({ sendMode })}
              onAction={() => writeDemo(settings.sendMode === "send")}
              history={conversationHistory}
              sessions={sessions}
              currentSession={currentSession}
              sessionSearch={sessionSearch}
              onSessionSearch={setSessionSearch}
              sessionBusy={sessionBusy}
              onRefreshSessions={refreshSessions}
              onSwitchSession={switchSession}
              onNewSession={createSession}
              pinnedSessionIds={settings.pinnedSessionIds}
              onTogglePin={toggleSessionPin}
              snapshot={conversationSnapshot}
            />
          )}
          {page === "voiceprint" && (
            <VoiceprintPage
              samples={settings.voiceSamples}
              recording={recordingSample}
              seconds={recordSeconds}
              onStart={startSample}
              onStop={stopSample}
              onDelete={async (id) => {
                const index = settings.voiceSamples.findIndex(
                  (sample) => sample.id === id,
                );
                if (index < 0) return;
                const next = settings.voiceSamples.filter(
                  (sample) => sample.id !== id,
                );
                try {
                  await window.desktop?.speech.removeSpeakerSample(index);
                  await save({ voiceSamples: next });
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "删除声纹样本失败");
                }
              }}
              threshold={Math.round(settings.speakerThreshold * 100)}
              onThreshold={(value) => save({ speakerThreshold: value / 100 })}
              onlyMyVoice={settings.onlyMyVoice}
              onOnlyMyVoice={(value) => save({ onlyMyVoice: value })}
              voiceTest={voiceTest}
              onVoiceTest={runVoiceTest}
              errorMessage={error}
            />
          )}
          {page === "targets" && (
            <TargetsPage
              settings={settings}
              cdpTarget={cdpTarget}
              busy={cdpBusy}
              error={error}
              onPort={(port) => save({ cdpPort: port })}
              onConnect={connectCdp}
              onLaunch={launchAndConnectCdp}
              onDisconnect={() => {
                window.desktop?.cdp.disconnect();
                save({ cdpConnected: false });
                setCdpTarget(null);
              }}
              onSetting={save}
              sessions={sessions}
              currentSession={currentSession}
              sessionSearch={sessionSearch}
              onSessionSearch={setSessionSearch}
              sessionBusy={sessionBusy}
              onRefreshSessions={refreshSessions}
              onSwitchSession={switchSession}
              onNewSession={createSession}
              pinnedSessionIds={settings.pinnedSessionIds}
              onTogglePin={toggleSessionPin}
              snapshot={conversationSnapshot}
            />
          )}
          {page === "models" && (
            <ModelsPage
              catalog={modelCatalog}
              settings={settings}
              busy={modelBusy}
              onDownload={downloadModel}
              onSelect={selectModel}
            />
          )}
          {page === "diagnostics" && (
            <DiagnosticsPage
              diagnostic={diagnostic}
              onRefresh={loadDiagnostics}
              onOpenMicrophone={() =>
                window.desktop?.diagnostics.openSettings("microphone")
              }
            />
          )}
          {page === "settings" && (
            <SettingsPage
              settings={settings}
              onSetting={save}
              onReset={() =>
                window.desktop?.settings
                  .reset()
                  .then((value) => {
                    setSettings({ ...defaults, ...value });
                    setConversationHistory([]);
                  })
              }
              devices={devices}
              onRefreshDevices={refreshDevices}
              onMicCheck={checkMicrophone}
              micCheck={micCheck}
            />
          )}
        </main>
      </section>
      {sessionPickerOpen && setupComplete && (
        <div
          className="session-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="切换 ChatGPT 对话"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSessionPickerOpen(false);
          }}
        >
          <div className="session-picker-modal">
            <div className="session-modal-heading">
              <div>
                <strong>切换 ChatGPT 对话</strong>
                <small>选择后，后续语音输入会写入这个对话</small>
              </div>
              <button className="icon-button" onClick={() => setSessionPickerOpen(false)} aria-label="关闭对话选择器">×</button>
            </div>
            <SessionPicker
              sessions={sessions}
              currentSession={currentSession}
              search={sessionSearch}
              onSearch={setSessionSearch}
              busy={sessionBusy}
              onRefresh={refreshSessions}
              onSwitch={(session) => {
                switchSession(session).then((switched) => {
                  if (switched) setSessionPickerOpen(false);
                });
              }}
              onNew={() => {
                createSession();
                setSessionPickerOpen(false);
              }}
              pinnedSessionIds={settings.pinnedSessionIds}
              onTogglePin={toggleSessionPin}
              snapshot={conversationSnapshot}
              autoFocus
            />
          </div>
        </div>
      )}
      {error && (
        <div className="toast error-toast" role="alert">
          {error}
          <button onClick={() => setError("")}>×</button>
        </div>
      )}
    </div>
  );
}

function PageHead({
  title,
  description,
  step,
}: {
  title: string;
  description: string;
  step?: string;
}) {
  return (
    <div className="page-head">
      {step && <span className="step-label">{step}</span>}
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Onboarding({
  onFinish,
  onMic,
  devices,
  selectedDevice,
  onDevice,
  micCheck,
  micLevel,
}: {
  onFinish: () => void;
  onMic: () => void;
  devices: MediaDeviceInfo[];
  selectedDevice: string;
  onDevice: (id: string) => void;
  micCheck: "idle" | "checking" | "ok" | "quiet" | "error";
  micLevel: number;
}) {
  const message =
    micCheck === "checking"
      ? "正在检测，请对着麦克风说话…"
      : micCheck === "ok"
        ? "麦克风正常，已检测到声音。"
        : micCheck === "quiet"
          ? "麦克风已连接，但没有检测到声音，请检查静音开关。"
          : micCheck === "error"
            ? "无法访问麦克风。"
            : "说几句话，确认设备可以正常接收声音。";
  return (
    <>
      <PageHead
        title="设置你的语音输入"
        description="完成麦克风、声纹和目标应用配置。"
        step="首次设置 · 1 / 4"
      />
      <div className="progress">
        <span className="done" />
        <span />
        <span />
        <span />
      </div>
      <div className="onboarding-card">
        <div className="onboarding-visual">
          <div className="big-orb">
            <Icon name="mic" size={30} />
          </div>
          <strong>麦克风权限</strong>
          <small>{devices.length ? "已获得访问权限" : "等待授权"}</small>
        </div>
        <div className="onboarding-form">
          <label>
            选择麦克风
            <select
              value={selectedDevice}
              onChange={(event) => onDevice(event.target.value)}
            >
              <option value="">系统默认麦克风</option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `麦克风 ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </label>
          <p className={`hint mic-result ${micCheck}`}>{message}</p>
          <div className="meter" aria-label="麦克风音量">
            {Array.from({ length: 8 }, (_, index) => (
              <i
                key={index}
                style={{
                  opacity:
                    micCheck === "checking" || micCheck === "ok"
                      ? Math.max(
                          0.2,
                          Math.min(1, micLevel * 1.7 - index * 0.08),
                        )
                      : 0.35,
                }}
              />
            ))}
          </div>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={onMic}
              disabled={micCheck === "checking"}
            >
              {micCheck === "checking"
                ? "检测中…"
                : micCheck === "ok"
                  ? "重新检测"
                  : "检测麦克风"}
            </button>
            <button className="primary-button" onClick={onFinish}>
              继续
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ModelSetup({
  catalog,
  settings,
  busy,
  onDownload,
  onSelect,
}: {
  catalog: any[];
  settings: Settings;
  busy: string | null;
  onDownload: (id: string, select?: { type: ModelType; id: string }) => void;
  onSelect: (type: ModelType, id: string) => void;
}) {
  const groups = [
    { type: "asr" as ModelType, label: "ASR 识别", key: "asrModelId" as const },
    { type: "vad" as ModelType, label: "VAD 检测", key: "vadModelId" as const },
    { type: "speaker" as ModelType, label: "声纹", key: "speakerModelId" as const },
  ];
  return (
    <div className="model-setup">
      <strong>选择本机模型</strong>
      <small>选择未下载的模型会先下载，下载完成后自动启用。</small>
      {groups.map((group) => {
        const models = catalog.filter((item) => item.type === group.type);
        const current = models.find((item) => item.id === settings[group.key]);
        return (
          <div className="model-setup-row" key={group.type}>
            <label>
              {group.label}
              <select
                value={current?.id || ""}
                onChange={(event) => {
                  const next = models.find((model) => model.id === event.target.value);
                  if (next?.installed) onSelect(group.type, next.id);
                  else if (next) onDownload(next.id, { type: group.type, id: next.id });
                }}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.installed ? "" : "（选择后下载）"}
                  </option>
                ))}
              </select>
            </label>
            {current && !current.installed && (
              <button
                className="secondary-button"
                onClick={() => onDownload(current.id, { type: group.type, id: current.id })}
                disabled={busy === current.id}
              >
                {busy === current.id ? "下载中…" : "下载并启用"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OnboardingFlow({
  onFinish,
  onMic,
  onRefreshDevices,
  devices,
  selectedDevice,
  onDevice,
  micCheck,
  micLevel,
  samples,
  recording,
  recordSeconds,
  onStartSample,
  onStopSample,
  cdpConnected,
  onConnect,
  onLaunch,
  cdpBusy,
  catalog,
  settings,
  modelBusy,
  onDownloadModel,
  onSelectModel,
}: {
  onFinish: () => void;
  onMic: () => void;
  onRefreshDevices: () => void;
  devices: MediaDeviceInfo[];
  selectedDevice: string;
  onDevice: (id: string) => void;
  micCheck: "idle" | "checking" | "ok" | "quiet" | "error";
  micLevel: number;
  samples: { id: number; duration: number }[];
  recording: boolean;
  recordSeconds: number;
  onStartSample: () => void;
  onStopSample: () => void;
  cdpConnected: boolean;
  onConnect: () => void;
  onLaunch: () => void;
  cdpBusy: boolean;
  catalog: any[];
  settings: Settings;
  modelBusy: string | null;
  onDownloadModel: (id: string, select?: { type: ModelType; id: string }) => void;
  onSelectModel: (type: ModelType, id: string) => void;
}) {
  const [step, setStep] = useState(0);
  const autoMicCheckStartedRef = useRef(false);
  useEffect(() => {
    if (step !== 0 || autoMicCheckStartedRef.current) return;
    autoMicCheckStartedRef.current = true;
    onMic();
  }, [onMic, step]);
  const modelsReady = ["asrModelId", "vadModelId", "speakerModelId"].every((key) => {
    const selected = settings[key as keyof Settings];
    return catalog.some((model) => model.id === selected && model.installed);
  });
  const canNext =
    step === 0
      ? micCheck === "ok"
      : step === 1
        ? modelsReady
        : step === 2
          ? samples.length > 0
          : step === 3
            ? cdpConnected
            : true;
  const next = () => {
    if (!canNext) return;
    if (step < titles.length - 1) setStep(step + 1);
    else onFinish();
  };
  const titles = ["连接麦克风", "选择模型", "登记声纹", "连接 ChatGPT", "完成设置"];
  return (
    <>
      <PageHead
        title={titles[step]}
        description="完成五步设置后，VoxCue 才会进入正常语音输入页面。"
        step={`首次设置 · ${step + 1} / ${titles.length}`}
      />
      <div className="progress">
        {titles.map((_, index) => (
          <span key={index} className={index <= step ? "done" : ""} />
        ))}
      </div>
      <div className="onboarding-card">
        <div className="onboarding-visual">
          <div className="big-orb">
            <Icon
              name={
                step === 0
                  ? "mic"
                  : step === 1
                    ? "sparkle"
                    : step === 2
                        ? "fingerprint"
                        : step === 3
                          ? "target"
                          : "check"
              }
              size={30}
            />
          </div>
          <strong>{titles[step]}</strong>
          <small>
            {step === 0
              ? devices.length
                ? "已发现麦克风"
                : "尚未检测"
              : step === 1
                ? (modelsReady ? "模型已就绪" : "请选择并下载模型")
                : step === 2
                  ? samples.length
                    ? `已登记 ${samples.length} 段`
                    : "建议登记至少 1 段"
                  : step === 3
                    ? cdpConnected
                      ? "ChatGPT 已连接"
                      : "等待连接"
                    : "可以开始使用"}
          </small>
        </div>
        <div className="onboarding-form">
          {step === 0 && (
            <>
              <label>
                选择麦克风
                <select
                  value={selectedDevice}
                  onChange={(event) => onDevice(event.target.value)}
                >
                  <option value="">系统默认麦克风</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `麦克风 ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
              <p className={`hint mic-result ${micCheck}`}>
                {micCheck === "checking"
                  ? "正在检测，请对着麦克风说话…"
                  : micCheck === "ok"
                    ? "麦克风正常，已检测到声音。"
                    : micCheck === "quiet"
                      ? "麦克风已连接，但没有检测到声音。"
                      : micCheck === "error"
                        ? "无法访问麦克风。"
                        : "正在准备自动检测麦克风…"}
              </p>
              <div className="meter">
                {Array.from({ length: 8 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      opacity:
                        micCheck === "checking" || micCheck === "ok"
                          ? Math.max(
                              0.2,
                              Math.min(1, micLevel * 1.7 - index * 0.08),
                            )
                          : 0.35,
                    }}
                  />
                ))}
              </div>
              <button
                className="secondary-button"
                onClick={onRefreshDevices}
              >
                刷新麦克风列表
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <p className="hint">为 ASR、VAD 和声纹分别选择模型。声纹模型必须在登记声纹前下载就绪。</p>
              <ModelSetup catalog={catalog} settings={settings} busy={modelBusy} onDownload={onDownloadModel} onSelect={onSelectModel} />
            </>
          )}
          {step === 2 && (
            <>
              <p className="hint">
                录制一段自然语音作为声纹样本。内容只保存在本机，不会发送到
                ChatGPT。
              </p>
              <div className="sample-onboarding-status">
                {samples.length
                  ? `已登记 ${samples.length} 段样本`
                  : "还没有声纹样本"}
                {recording && ` · 正在录制 ${recordSeconds}s`}
              </div>
              <button
                className="secondary-button"
                onClick={recording ? onStopSample : onStartSample}
              >
                {recording ? "停止录制" : "录制声纹样本"}
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <p className="hint">
                连接后，识别结果可以自动写入 ChatGPT
                输入框。你也可以稍后在“目标应用”中重新连接。
              </p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  onClick={onConnect}
                  disabled={cdpBusy || cdpConnected}
                >
                  {cdpConnected ? "已连接" : "检测连接"}
                </button>
                <button
                  className="primary-button"
                  onClick={onLaunch}
                  disabled={cdpBusy || cdpConnected}
                >
                  {cdpBusy ? "正在启动…" : "启动 ChatGPT 并连接"}
                </button>
              </div>
            </>
          )}
          {step === 4 && (
            <div className="onboarding-summary">
              <p>麦克风、模型、声纹和 ChatGPT 连接均已完成。</p>
              <p className="hint">
                你可以在设置中调整断句间隔、停止词、悬浮窗和快捷键。
              </p>
            </div>
          )}
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() => setStep((value) => Math.max(0, value - 1))}
              disabled={step === 0}
            >
              上一步
            </button>
            <button
              className="primary-button"
              onClick={next}
              disabled={!canNext}
            >
              {step === titles.length - 1 ? "开始使用" : "继续"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
function SessionPicker({
  sessions,
  currentSession,
  search,
  onSearch,
  busy,
  onRefresh,
  onSwitch,
  onNew,
  pinnedSessionIds,
  onTogglePin,
  snapshot,
  autoFocus = false,
}: {
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  search: string;
  onSearch: (value: string) => void;
  busy: boolean;
  onRefresh: () => void;
  onSwitch: (session: ChatSession) => void;
  onNew: () => void;
  pinnedSessionIds: string[];
  onTogglePin: (id: string) => void;
  snapshot: ConversationSnapshot | null;
  autoFocus?: boolean;
}) {
  const normalized = search.trim().toLocaleLowerCase();
  const pinned = new Set(pinnedSessionIds || []);
  const pinnedOrder = new Map((pinnedSessionIds || []).map((id, index) => [id, index]));
  const filtered = sessions
    .filter((item) => !normalized || item.title.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => {
      const pinDelta = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      if (pinDelta) return pinDelta;
      if (pinned.has(a.id) && pinned.has(b.id)) return (pinnedOrder.get(a.id) ?? 0) - (pinnedOrder.get(b.id) ?? 0);
      return Number(Boolean(b.current)) - Number(Boolean(a.current));
    });
  const visible = filtered.slice(0, 12);
  return (
    <section className="section-card session-picker">
      <div className="section-heading">
        <div>
          <h2>当前 ChatGPT 对话</h2>
          <p>{currentSession?.title || "尚未读取对话列表"}</p>
          {snapshot?.replySummary && <small className="session-reply-summary">最近回复：{snapshot.replySummary}</small>}
        </div>
        <div className="session-picker-actions">
          <button className="secondary-button" onClick={onRefresh} disabled={busy}>刷新</button>
          <button className="primary-button" onClick={onNew} disabled={busy}>新建对话</button>
        </div>
      </div>
      <input
        className="session-search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="搜索对话标题…"
        aria-label="搜索 ChatGPT 对话"
        autoFocus={autoFocus}
      />
      {!sessions.length ? (
        <div className="empty-state">连接 ChatGPT 后点击“刷新”，即可读取最近对话。</div>
      ) : !visible.length ? (
        <div className="empty-state">没有匹配的对话。</div>
      ) : (
        <div className="session-list">
          {visible.map((session) => (
            <div className={`session-row ${currentSession?.id === session.id ? "active" : ""}`} key={session.id}>
              <button className="session-row-select" onClick={() => onSwitch(session)} disabled={busy || currentSession?.id === session.id}>
                <span className="session-row-main"><strong>{session.title}</strong><small>{session.groupLabel || "未分组"} · {session.id}</small></span>
                {currentSession?.id === session.id ? <span className="tag ok">当前</span> : <span className="tag">切换</span>}
              </button>
              <button className={`session-pin ${pinned.has(session.id) ? "pinned" : ""}`} onClick={() => onTogglePin(session.id)} aria-label={pinned.has(session.id) ? "取消固定" : "固定对话"} title={pinned.has(session.id) ? "取消固定" : "固定对话"}>
                {pinned.has(session.id) ? "★" : "☆"}
              </button>
            </div>
          ))}
        </div>
      )}
      {filtered.length > visible.length && <p className="hint session-more">显示最近匹配的 {visible.length} 个对话，请输入关键词继续筛选。</p>}
    </section>
  );
}

function VoicePage({
  status,
  transcript,
  error,
  cdpConnected,
  sendStatus,
  sendMode,
  onMode,
  onToggle,
  onAction,
  history,
  sessions,
  currentSession,
  sessionSearch,
  onSessionSearch,
  sessionBusy,
  onRefreshSessions,
  onSwitchSession,
  onNewSession,
  pinnedSessionIds,
  onTogglePin,
  snapshot,
}: {
  status: Status;
  transcript: string;
  error: string;
  cdpConnected: boolean;
  sendStatus: SendStatus;
  sendMode: "write" | "send";
  onMode: (mode: "write" | "send") => void;
  onToggle: () => void;
  onAction: () => void;
  history: ConversationEntry[];
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  sessionSearch: string;
  onSessionSearch: (value: string) => void;
  sessionBusy: boolean;
  onRefreshSessions: () => void;
  onSwitchSession: (session: ChatSession) => void;
  onNewSession: () => void;
  pinnedSessionIds: string[];
  onTogglePin: (id: string) => void;
  snapshot: ConversationSnapshot | null;
}) {
  return (
    <>
      <PageHead title="语音输入" description="查看连接状态并控制当前听写。" />
      <SessionPicker
        sessions={sessions}
        currentSession={currentSession}
        search={sessionSearch}
        onSearch={onSessionSearch}
        busy={sessionBusy}
        onRefresh={onRefreshSessions}
        onSwitch={onSwitchSession}
        onNew={onNewSession}
        pinnedSessionIds={pinnedSessionIds}
        onTogglePin={onTogglePin}
        snapshot={snapshot}
      />
      <div className="status-card">
        <div>
          <span className="status-dot" />
          <strong>{statusNames[status]}</strong>
          <small>{cdpConnected ? "ChatGPT 已连接" : "尚未连接 ChatGPT"}</small>
        </div>
        <button className="primary-button" onClick={onToggle}>
          <Icon name={status === "listening" ? "pause" : "mic"} />
          {status === "listening" ? "暂停听写" : "开始听写"}
        </button>
      </div>
      <section className="section-card">
        <div className="section-heading">
          <div>
            <h2>实时预览</h2>
            <p>识别文字会在发送前显示在这里。</p>
          </div>
          <div className="status-tags">
            <span className="tag">{statusNames[status]}</span>
            <span
              className={
                sendStatus === "failed"
                  ? "tag bad"
                  : sendStatus === "sent"
                    ? "tag ok"
                    : "tag"
              }
            >
              {sendStatus === "writing"
                ? "正在写入…"
                : sendStatus === "written"
                  ? "已写入"
                  : sendStatus === "sent"
                    ? "已发送"
                    : sendStatus === "failed"
                      ? "发送失败"
                      : "未发送"}
            </span>
          </div>
        </div>
        <div className="transcript-box">
          {transcript || "开始说话后，这里将显示识别结果…"}
        </div>
        <div className="send-mode-row">
          <div className="mode-switch" role="group" aria-label="发送方式">
            <button className={sendMode === "write" ? "active" : ""} onClick={() => onMode("write")}>写入</button>
            <button className={sendMode === "send" ? "active" : ""} onClick={() => onMode("send")}>写入并发送</button>
          </div>
          <button className="primary-button" onClick={onAction}>
            {sendMode === "send" ? "执行：写入并发送" : "执行：写入"}
          </button>
        </div>
      </section>
      {error && <div className="inline-error">{error}</div>}
      <section className="section-card history-card">
        <div className="section-heading"><div><h2>语音发送历史</h2><p>每条记录对应一次写入或发送，并保留声纹相似度。</p></div></div>
        {!history.length ? <div className="empty-state">完成一次写入或发送后，历史记录会显示在这里。</div> : <div className="history-list">{[...history].reverse().map((item) => <div className="history-row" key={item.id}><div className="history-text">{item.text}</div><div className="history-meta"><span>{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>{item.sent ? "已发送" : "已写入"}</span><span>{item.sessionTitle || "当前对话"}</span><span>{item.sessionId ? `会话 ${item.sessionId.slice(0, 8)}…` : "会话未读取"}</span><span>{item.score === null ? "未取得分值" : `声纹 ${(Math.max(0, Math.min(1, item.score)) * 100).toFixed(0)}%`}</span></div></div>)}</div>}
      </section>
    </>
  );
}
function VoiceprintPage({
  samples,
  recording,
  seconds,
  onStart,
  onStop,
  onDelete,
  threshold,
  onThreshold,
  onlyMyVoice,
  onOnlyMyVoice,
  voiceTest,
  onVoiceTest,
  errorMessage,
}: {
  samples: { id: number; duration: number }[];
  recording: boolean;
  seconds: number;
  onStart: () => void;
  onStop: () => void;
  onDelete: (id: number) => void;
  threshold: number;
  onThreshold: (value: number) => void;
  onlyMyVoice: boolean;
  onOnlyMyVoice: (value: boolean) => void;
  voiceTest: VoiceTestStatus;
  onVoiceTest: () => void;
  errorMessage: string;
}) {
  const testMessage =
    voiceTest === "listening"
      ? "正在聆听，请自然地说一句完整的话…"
      : voiceTest === "passed"
        ? "验证通过，这是你的声音。"
        : voiceTest === "failed"
          ? "验证未通过，当前声音与已登记声纹不匹配。"
          : voiceTest === "timeout"
            ? "没有检测到完整语句，请重新测试。"
            : voiceTest === "error"
              ? errorMessage || "声纹测试未能完成，请检查样本和麦克风。"
              : "点击测试后说一句话；测试内容不会转写或发送到 ChatGPT。";
  return (
    <>
      <PageHead title="声纹" description="登记你的声音，过滤其他人的语音。" />
      <div className="profile-card">
        <div className="avatar">
          <Icon name="fingerprint" size={22} />
        </div>
        <div>
          <strong>我的声纹</strong>
          <p>
            {samples.length
              ? `已登记 ${samples.length} 段语音`
              : "还没有登记声纹"}
          </p>
        </div>
        <span className={samples.length ? "tag ok" : "tag"}>
          {samples.length ? "可用" : "未设置"}
        </span>
      </div>
      <section className={`section-card voice-test ${voiceTest}`}>
        <div className="section-heading">
          <div>
            <h2>测试我的声纹</h2>
            <p>{testMessage}</p>
          </div>
          <button
            className={
              voiceTest === "listening" ? "secondary-button" : "primary-button"
            }
            onClick={onVoiceTest}
            disabled={!samples.length || recording}
          >
            <Icon name={voiceTest === "listening" ? "pause" : "fingerprint"} />
            {voiceTest === "listening"
              ? "停止测试"
              : voiceTest === "idle"
                ? "开始测试"
                : "重新测试"}
          </button>
        </div>
        {voiceTest !== "idle" && (
          <div className="voice-test-result">
            <span className="voice-test-dot" />
            {testMessage}
          </div>
        )}
      </section>
      <section className="section-card">
        <ToggleRow
          title="启用声纹保护"
          description="只处理匹配已登记声纹的语音。关闭后将识别所有说话人。"
          value={onlyMyVoice}
          onChange={onOnlyMyVoice}
        />
      </section>
      <section className="section-card">
        <div className="section-heading">
          <div>
            <h2>声纹样本</h2>
            <p>建议登记 5 段不同语气的短句。</p>
          </div>
          <button
            className="secondary-button"
            onClick={recording ? onStop : onStart}
            disabled={voiceTest === "listening"}
          >
            <Icon name={recording ? "pause" : "plus"} />
            {recording ? `停止 ${seconds}s` : "录制样本"}
          </button>
        </div>
        {samples.length === 0 && (
          <div className="empty-state">
            点击“录制样本”，朗读任意一句话（最长 15 秒）。
          </div>
        )}
        {samples.map((sample, index) => (
          <div className="sample-row" key={sample.id}>
            <span>样本 {String(index + 1).padStart(2, "0")}</span>
            <div className="wave">▂▅▃▆▂▇▅▃▆▂▅▃▆</div>
            <small>{sample.duration} 秒</small>
            <button
              className="icon-button"
              onClick={() => onDelete(sample.id)}
              aria-label="删除"
            >
              <Icon name="trash" />
            </button>
          </div>
        ))}
      </section>
      <section className="section-card">
        <div className="setting-row">
          <div>
            <strong>验证灵敏度</strong>
            <p>当前阈值 {threshold} / 100，越高越严格。</p>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={threshold}
            onChange={(event) => onThreshold(Number(event.target.value))}
          />
        </div>
      </section>
    </>
  );
}
function TargetsPage({
  settings,
  cdpTarget,
  busy,
  error,
  onPort,
  onConnect,
  onLaunch,
  onDisconnect,
  onSetting,
  sessions,
  currentSession,
  sessionSearch,
  onSessionSearch,
  sessionBusy,
  onRefreshSessions,
  onSwitchSession,
  onNewSession,
  pinnedSessionIds,
  onTogglePin,
  snapshot,
}: {
  settings: Settings;
  cdpTarget: any;
  busy: boolean;
  error: string;
  onPort: (port: number) => void;
  onConnect: () => void;
  onLaunch: () => void;
  onDisconnect: () => void;
  onSetting: (patch: Partial<Settings>) => void;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  sessionSearch: string;
  onSessionSearch: (value: string) => void;
  sessionBusy: boolean;
  onRefreshSessions: () => void;
  onSwitchSession: (session: ChatSession) => void;
  onNewSession: () => void;
  pinnedSessionIds: string[];
  onTogglePin: (id: string) => void;
  snapshot: ConversationSnapshot | null;
}) {
  return (
    <>
      <PageHead title="目标应用" description="选择语音文字要输入到哪个应用。" />
      <section className="section-card">
        <div className="section-heading">
          <div>
            <h2>ChatGPT 桌面端</h2>
            <p>通过本机 CDP 调试端口写入输入框。</p>
          </div>
          <span className={settings.cdpConnected ? "tag ok" : "tag"}>
            {settings.cdpConnected ? "已连接" : "未连接"}
          </span>
        </div>
        <div className="cdp-form">
          <label>
            CDP 端口
            <input
              type="number"
              min="1"
              max="65535"
              value={settings.cdpPort}
              onChange={(event) => onPort(Number(event.target.value))}
            />
          </label>
          {settings.cdpConnected ? (
            <button className="secondary-button" onClick={onDisconnect}>
              断开连接
            </button>
          ) : (
            <>
              <button
                className="secondary-button"
                onClick={onConnect}
                disabled={busy}
              >
                仅检测连接
              </button>
              <button
                className="primary-button"
                onClick={onLaunch}
                disabled={busy}
              >
                {busy ? "正在启动…" : "启动 ChatGPT 并连接"}
              </button>
            </>
          )}
        </div>
        {cdpTarget && (
          <div className="target-detail">
            <span className="app-icon">C</span>
            <div>
              <strong>{cdpTarget.title}</strong>
              <small>{cdpTarget.url}</small>
            </div>
          </div>
        )}
        <p className="hint">
          “启动 ChatGPT 并连接”会重启 ChatGPT，自动开放本机端口{" "}
          {settings.cdpPort}，然后完成连接。
        </p>
        {error && <div className="inline-error">{error}</div>}
      </section>
      <SessionPicker
        sessions={sessions}
        currentSession={currentSession}
        search={sessionSearch}
        onSearch={onSessionSearch}
        busy={sessionBusy}
        onRefresh={onRefreshSessions}
        onSwitch={onSwitchSession}
        onNew={onNewSession}
        pinnedSessionIds={pinnedSessionIds}
        onTogglePin={onTogglePin}
        snapshot={snapshot}
      />
      <section className="section-card">
        <h2>输入行为</h2>
        <ToggleRow
          title="识别后写入输入框"
          description="不会自动发送消息。"
          value={settings.writeToChatGPT}
          onChange={(value) => onSetting({ writeToChatGPT: value })}
        />
        <ToggleRow
          title="识别完成后自动发送"
          description="每段语音在断句后自动提交；关闭后只写入输入框。"
          value={settings.autoSend}
          onChange={(value) => onSetting({ autoSend: value })}
        />
        <ToggleRow
          title="保留输入框原有文字"
          description="新识别内容追加在现有文字后。"
          value={settings.appendDraft}
          onChange={(value) => onSetting({ appendDraft: value })}
        />
      </section>
    </>
  );
}
function ModelsPage({
  catalog,
  settings,
  busy,
  onDownload,
  onSelect,
}: {
  catalog: any[];
  settings: Settings;
  busy: string | null;
  onDownload: (id: string, select?: { type: ModelType; id: string }) => void;
  onSelect: (type: ModelType, id: string) => void;
}) {
  const groups = [
    { type: "asr" as ModelType, title: "ASR 语音识别", key: "asrModelId" as const, note: "决定实时转写的语言、准确率和延迟。" },
    { type: "vad" as ModelType, title: "VAD 语音检测", key: "vadModelId" as const, note: "负责判断何时开始和结束说话。" },
    { type: "speaker" as ModelType, title: "声纹识别", key: "speakerModelId" as const, note: "只让登记过的声音进入转写结果。" },
  ];
  return (
    <>
      <PageHead title="模型管理" description="分别选择 ASR、VAD 和声纹模型；下载完成后才可启用。" />
      {groups.map((group) => (
        <section className="section-card model-section" key={group.type}>
          <div className="section-heading"><div><h2>{group.title}</h2><p>{group.note}</p></div></div>
          <div className="model-grid">
            {catalog.filter((model) => model.type === group.type).map((model) => {
              const selected = settings[group.key] === model.id;
              return (
                <article className={`model-card ${selected ? "selected" : ""}`} key={model.id}>
                  <div className="model-card-head"><strong>{model.name}</strong>{selected && <span className="tag ok">当前使用</span>}</div>
                  <p>{model.description}</p>
                  <div className="model-meta"><span>{model.languages}</span><span>{model.streaming ? "适合流式" : "非流式"}</span><span>{model.size}</span></div>
                  <div className="model-actions">
                    {model.installed ? <span className="tag ok">已下载</span> : <button className="secondary-button" onClick={() => onDownload(model.id)} disabled={busy === model.id}>{busy === model.id ? "下载中…" : "下载模型"}</button>}
                    {model.installed && !selected && <button className="primary-button" onClick={() => onSelect(group.type, model.id)}>使用此模型</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function DiagnosticsPage({
  diagnostic,
  onRefresh,
  onOpenMicrophone,
}: {
  diagnostic: any;
  onRefresh: () => void;
  onOpenMicrophone: () => void;
}) {
  const [micPermission, setMicPermission] = useState("查询中…");
  const cleanupPermissionRef = useRef<() => void>(() => {});
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((result) => {
        setMicPermission(
          result.state === "granted"
            ? "已授权"
            : result.state === "denied"
              ? "已拒绝"
              : "未决定",
        );
        const update = () =>
          setMicPermission(
            result.state === "granted"
              ? "已授权"
              : result.state === "denied"
                ? "已拒绝"
                : "未决定",
          );
        result.addEventListener("change", update);
        cleanupPermissionRef.current = () =>
          result.removeEventListener("change", update);
      })
      .catch(() => setMicPermission("请点击检查"));
    return () => cleanupPermissionRef.current();
  }, []);
  const row = (title: string, value: string, ok?: boolean) => (
    <div className="diagnostic-row">
      <div>
        <strong>{title}</strong>
      </div>
      <span className={ok === undefined ? "tag" : ok ? "tag ok" : "tag bad"}>
        {value}
      </span>
    </div>
  );
  return (
    <>
      <PageHead
        title="权限与诊断"
        description="检查系统权限、本地模型、CDP 和快捷键状态。"
      />
      <section className="section-card">
        <h2>系统权限</h2>
        {row("麦克风权限", micPermission, micPermission === "已授权")}
        <div className="button-row">
          <button className="secondary-button" onClick={onOpenMicrophone}>
            打开系统麦克风设置
          </button>
          <button className="secondary-button" onClick={onRefresh}>
            重新检查
          </button>
        </div>
      </section>
      <section className="section-card">
        <h2>运行环境</h2>
        {row(
          "本地语音模型",
          diagnostic
            ? `${diagnostic.modelFiles}/${diagnostic.modelTotal} 个文件`
            : "检查中…",
          Boolean(diagnostic?.models),
        )}
        {row(
          "声纹文件",
          diagnostic?.voiceprint ? "已登记" : "未登记",
          diagnostic ? diagnostic.voiceprint : undefined,
        )}
        {row(
          "全局快捷键",
          diagnostic?.shortcutRegistered ? "已注册" : "未注册",
          diagnostic ? diagnostic.shortcutRegistered : undefined,
        )}
        {row(
          "ChatGPT CDP",
          diagnostic?.cdpReachable ? "端口可访问" : "未检测到",
          diagnostic ? diagnostic.cdpReachable : undefined,
        )}
        {diagnostic &&
          row(
            "运行平台",
            `${diagnostic.platform} · VoxCue ${diagnostic.appVersion}`,
          )}
      </section>
      <section className="section-card">
        <h2>诊断说明</h2>
        <p>
          语音识别、声纹验证和 CDP
          写入都在本机处理。若模型缺失或权限被拒绝，请先处理上面的状态，再开始听写。
        </p>
      </section>
    </>
  );
}

function SettingsPage({
  settings,
  onSetting,
  onReset,
  devices,
  onRefreshDevices,
  onMicCheck,
  micCheck,
}: {
  settings: Settings;
  onSetting: (patch: Partial<Settings>) => void;
  onReset: () => void;
  devices: MediaDeviceInfo[];
  onRefreshDevices: () => void;
  onMicCheck: () => void;
  micCheck: "idle" | "checking" | "ok" | "quiet" | "error";
}) {
  return (
    <>
      <PageHead title="设置" description="调整启动、显示和语音识别选项。" />
      <section className="section-card">
        <h2>常规</h2>
        <div className="setting-row mic-setting-row">
          <div>
            <strong>麦克风</strong>
            <p>
              {devices.length
                ? `已发现 ${devices.length} 个输入设备`
                : "尚未授权或未检测到设备"}
            </p>
          </div>
          <div className="setting-actions">
            <button className="secondary-button" onClick={onRefreshDevices}>
              刷新设备
            </button>
            <button
              className="secondary-button"
              onClick={onMicCheck}
              disabled={micCheck === "checking"}
            >
              {micCheck === "checking" ? "检测中…" : "检查麦克风"}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>使用的麦克风</strong>
          </div>
          <select
            value={settings.microphoneId}
            onChange={(event) =>
              onSetting({ microphoneId: event.target.value })
            }
          >
            <option value="">系统默认麦克风</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `麦克风 ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
        <ToggleRow
          title="开机时启动"
          description="登录系统后在后台运行。"
          value={settings.launchAtLogin}
          onChange={(value) => onSetting({ launchAtLogin: value })}
        />
        <ToggleRow
          title="显示悬浮按钮"
          description="作为独立小窗，始终显示在整个屏幕和其他应用上方。"
          value={settings.showOrb}
          onChange={(value) => onSetting({ showOrb: value })}
        />
        <div className="setting-row">
          <div>
            <strong>悬浮按钮尺寸</strong>
          </div>
          <select
            value={settings.orbSize}
            onChange={(event) =>
              onSetting({ orbSize: Number(event.target.value) })
            }
          >
            <option value="40">小 · 40 px</option>
            <option value="48">标准 · 48 px</option>
            <option value="56">大 · 56 px</option>
          </select>
        </div>
      </section>
      <section className="section-card">
        <h2>识别</h2>
        <div className="setting-row">
          <div>
            <strong>语言模型</strong>
            <p>中文和英文混合识别。</p>
          </div>
          <select
            value={settings.modelLanguage}
            onChange={(event) =>
              onSetting({ modelLanguage: event.target.value })
            }
          >
            <option>中英双语</option>
            <option>中文</option>
            <option>English</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>句尾停顿</strong>
            <p>
              连续停顿 {settings.endpointSeconds.toFixed(1)}{" "}
              秒后确认文字并执行自动发送，下次开始录音时生效。
            </p>
          </div>
          <div className="interval-control">
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={settings.endpointSeconds}
              onChange={(event) =>
                onSetting({ endpointSeconds: Number(event.target.value) })
              }
            />
            <output>{settings.endpointSeconds.toFixed(1)} 秒</output>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <strong>停止词</strong>
            <p>识别到后立即关闭录音，且不会写入 ChatGPT；多个词用逗号分隔。</p>
          </div>
          <input
            className="setting-input"
            value={settings.stopWords}
            placeholder="例如：停止录音"
            onChange={(event) => onSetting({ stopWords: event.target.value })}
          />
        </div>
        <ToggleRow
          title="自动标点"
          description="为最终文本添加标点。"
          value={settings.punctuation}
          onChange={(value) => onSetting({ punctuation: value })}
        />
      </section>
      <section className="section-card">
        <h2>快捷键</h2>
        <div className="setting-row">
          <div>
            <strong>开始 / 暂停听写</strong>
          </div>
          <select
            value={settings.shortcut}
            onChange={(event) => onSetting({ shortcut: event.target.value })}
          >
            <option value="Alt+Space">⌥ Space</option>
            <option value="CommandOrControl+Alt+Space">⌃⌥ Space</option>
            <option value="Alt+Shift+Space">⌥⇧ Space</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>打开对话选择器</strong>
            <p>从任意应用快速打开 ChatGPT 对话列表。</p>
          </div>
          <select
            value={settings.sessionShortcut}
            onChange={(event) => onSetting({ sessionShortcut: event.target.value })}
          >
            <option value="Alt+Shift+Space">⌥⇧ Space</option>
            <option value="CommandOrControl+Alt+Shift+Space">⌃⌥⇧ Space</option>
            <option value="Alt+Command+K">⌥⌘ K</option>
          </select>
        </div>
      </section>
      <button className="text-button" onClick={onReset}>
        恢复默认设置
      </button>
    </>
  );
}
function ToggleRow({
  title,
  description,
  value,
  onChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        className={value ? "switch on" : "switch"}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span />
      </button>
    </div>
  );
}
