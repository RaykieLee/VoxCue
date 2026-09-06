export type SessionCommand = {
  type: "switch-session";
  query: string;
  raw: string;
};

/** Data-only parser: add patterns here as speech commands grow. */
export function parseSessionCommand(input: string): SessionCommand | null {
  const text = String(input || "").trim().replace(/[。！？!?]+$/u, "");
  if (!text) return null;
  const patterns = [
    /^(?:请)?(?:切换|跳转|打开)到?(?:chatgpt的?)?(?:对话|会话)?\s*(.+)$/iu,
    /^(?:请)?(?:切换到|打开)\s*(.+?)(?:对话|会话)$/iu,
    /^(?:switch|go)\s+to\s+(?:the\s+)?(?:conversation|chat)\s+(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const query = match?.[1]
      ?.trim()
      .replace(/^(?:对话|会话)\s*/u, "")
      .replace(/\s*(?:对话|会话)$/u, "")
      .trim();
    if (query) return { type: "switch-session", query, raw: text };
  }
  return null;
}

/** Voice routing must honor the app's speaker-protection setting. */
export function canRouteSessionCommand(
  onlyMyVoice: boolean,
  speakerVerified: boolean,
): boolean {
  return !onlyMyVoice || speakerVerified;
}
