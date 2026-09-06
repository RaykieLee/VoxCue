// Keep voice-command parsing deliberately small and data-only so it can be
// extended without coupling recognition to the React or Electron layers.
function parseSessionCommand(input) {
  const text = String(input || '').trim().replace(/[。！？!?]+$/u, '');
  if (!text) return null;
  const patterns = [
    /^(?:请)?(?:切换|跳转|打开)到?(?:chatgpt的?)?(?:对话|会话)?\s*(.+)$/iu,
    /^(?:请)?(?:切换到|打开)\s*(.+?)(?:对话|会话)$/iu,
    /^(?:switch|go)\s+to\s+(?:the\s+)?(?:conversation|chat)\s+(.+)$/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const query = match?.[1]?.trim()
      .replace(/^(?:对话|会话)\s*/u, '')
      .replace(/\s*(?:对话|会话)$/u, '')
      .trim();
    if (query) return { type: 'switch-session', query, raw: text };
  }
  return null;
}

function canRouteSessionCommand(onlyMyVoice, speakerVerified) {
  return !onlyMyVoice || Boolean(speakerVerified);
}

module.exports = { parseSessionCommand, canRouteSessionCommand };
