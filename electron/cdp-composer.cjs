const editorSelector = '#prompt-textarea, [data-testid="prompt-textarea"], [role="textbox"][contenteditable="true"], textarea[placeholder], textarea, [contenteditable="true"]'
const detectExpression = `Boolean(document.querySelector(${JSON.stringify(editorSelector)}))`

// ChatGPT's sidebar is rendered by React and its exact class names change
// frequently. These expressions intentionally use stable URL semantics and
// visible labels, and return serializable data for the Electron process.
const sessionsListExpression = `(() => {
  const currentPath = location.pathname || '';
  const currentId = (currentPath.match(/\\/(?:c|conversation)\\/([^/?#]+)/i) || [])[1] || null;
  const links = [...document.querySelectorAll('a[href]')];
  const seen = new Set();
  const sessions = [];
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\\/(?:c|conversation)\\/([^/?#]+)/i);
    if (!match) continue;
    const id = decodeURIComponent(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = [link.getAttribute('aria-label'), link.getAttribute('title'), link.innerText, link.textContent]
      .filter(Boolean).map(value => String(value).replace(/\\s+/g, ' ').trim()).find(Boolean) || '未命名对话';
    const projectNode = link.closest?.('[data-project-id], [data-project-slug], [data-testid*="project"], [aria-label*="项目"], [aria-label*="project"], [title*="项目"], [title*="project"]');
    const projectKey = projectNode?.getAttribute('data-project-id') || projectNode?.getAttribute('data-project-slug') || '';
    const projectLabel = projectNode ? [projectNode.getAttribute('aria-label'), projectNode.getAttribute('title'), projectNode.innerText]
      .filter(Boolean).map(value => String(value).replace(/\\s+/g, ' ').trim()).find(Boolean) || '' : '';
    sessions.push({
      id,
      title: label.slice(0, 160),
      href: new URL(href, location.href).href,
      source: 'chatgpt',
      projectKey: projectKey ? String(projectKey).slice(0, 120) : 'ungrouped',
      projectLabel: projectLabel ? String(projectLabel).slice(0, 120) : '未分组',
      groupKey: projectKey ? 'project:' + String(projectKey).slice(0, 120) : 'ungrouped',
      groupLabel: projectLabel ? String(projectLabel).slice(0, 120) : '未分组',
      current: id === currentId || link.getAttribute('aria-current') === 'page' || /selected|active|bg-token-main-surface-secondary/.test(link.className || '')
    });
  }
  return { ok: true, currentId, currentTitle: sessions.find(item => item.id === currentId)?.title || document.title || '', sessions };
})()`

const conversationSnapshotExpression = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const currentPath = location.pathname || '';
  const currentId = (currentPath.match(/\\/(?:c|conversation)\\/([^/?#]+)/i) || [])[1] || null;
  const nodes = [...document.querySelectorAll('[data-message-author-role], [data-testid^="conversation-turn-"]')];
  const seen = new Set();
  const messages = [];
  for (const node of nodes) {
    const role = node.getAttribute('data-message-author-role') || (node.getAttribute('data-testid') || '').match(/(?:user|assistant)/i)?.[0]?.toLowerCase() || 'unknown';
    const text = clean(node.innerText || node.textContent);
    if (!text || seen.has(role + ':' + text)) continue;
    seen.add(role + ':' + text);
    messages.push({ role: role === 'assistant' ? 'assistant' : role === 'user' ? 'user' : 'unknown', text: text.slice(0, 4000) });
  }
  const assistant = [...messages].reverse().find(item => item.role === 'assistant');
  const user = [...messages].reverse().find(item => item.role === 'user');
  return { ok: true, currentId, title: document.title || 'ChatGPT', messages: messages.slice(-20), latestUser: user?.text || '', latestReply: assistant?.text || '', replySummary: assistant?.text ? assistant.text.slice(0, 280) : '', capturedAt: Date.now() };
})()`

function switchSessionExpression(id, href = '') {
  return `(() => {
    const wanted = ${JSON.stringify(String(id))};
    const fallbackHref = ${JSON.stringify(String(href || ''))};
    const links = [...document.querySelectorAll('a[href]')];
    const link = links.find(item => {
      const href = item.getAttribute('href') || '';
      const match = href.match(/\\/(?:c|conversation)\\/([^/?#]+)/i);
      return match && decodeURIComponent(match[1]) === wanted;
    });
    if (!link) {
      if (!fallbackHref) return { ok: false, reason: '找不到目标对话，可能已被删除或尚未加载' };
      const target = new URL(fallbackHref, location.href);
      if (target.origin !== location.origin || !/^\\/(?:c|conversation)\\//i.test(target.pathname)) return { ok: false, reason: '目标对话地址无效' };
      history.pushState({}, '', target.href);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return { ok: true, id: wanted, method: 'navigate' };
    }
    link.click();
    return { ok: true, id: wanted };
  })()`
}

const waitForComposerExpression = `((timeout = 12000) => new Promise(resolve => {
  const started = Date.now();
  const check = () => {
    const editor = document.querySelector(${JSON.stringify(editorSelector)});
    if (editor) {
      const path = location.pathname || '';
      const match = path.match(/\\/(?:c|conversation)\\/([^/?#]+)/i);
      resolve({ ok: true, currentId: match ? decodeURIComponent(match[1]) : null, title: document.title || '' });
      return;
    }
    if (Date.now() - started >= timeout) { resolve({ ok: false, reason: '切换对话后输入框未就绪' }); return; }
    setTimeout(check, 100);
  };
  check();
}))()`

const newSessionExpression = `(() => {
  const candidates = [...document.querySelectorAll('button, a')];
  const label = element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.innerText, element.textContent]
    .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim();
  const button = candidates.find(element => /^(new chat|new conversation|新聊天|新对话|开始新聊天)$/i.test(label(element)) || /new chat|新聊天|新对话/i.test(label(element)));
  if (!button) return { ok: false, reason: '找不到新建对话按钮' };
  button.click();
  return { ok: true };
})()`

const writeScript = `(text, append) => {
  const editor = document.querySelector(${JSON.stringify(editorSelector)});
  if (!editor) return { ok: false, reason: '找不到 ChatGPT 输入框' };
  const current = editor.tagName === 'TEXTAREA' ? editor.value : editor.innerText;
  const next = append && current.trim() ? current.replace(/\\s+$/, '') + '\\n' + text : text;
  if (editor.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(editor, next); editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    editor.innerText = next;
    editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
  return { ok: true, length: next.length };
}`

const sendScript = `(() => {
  const editor = document.querySelector(${JSON.stringify(editorSelector)});
  const isVisible = element => { const rect = element.getBoundingClientRect?.(); return !rect || (rect.width > 0 && rect.height > 0); };
  const labelOf = element => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' ');
  const isStop = element => /stop|停止|cancel|取消/i.test(labelOf(element));
  const selectors = [
    'button[data-testid*="send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'form button[type="submit"]'
  ];
  let button = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(element => !element.disabled && !isStop(element) && isVisible(element));
  if (button) { button.click(); return {ok:true, method:'button'}; }
  const active = [...document.querySelectorAll('button')].find(element => !element.disabled && isStop(element) && isVisible(element));
  if (active) return {ok:false, reason:'ChatGPT 正在生成回复，请稍后再发送'};
  if (editor) {
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13, bubbles: true }));
    return {ok:true, method:'enter'};
  }
  return {ok:false, reason:'找不到 ChatGPT 输入框'};
})()`

function writeExpression(text, append) {
  return `(${writeScript})(${JSON.stringify(text)}, ${Boolean(append)})`
}

module.exports = {
  editorSelector,
  detectExpression,
  sessionsListExpression,
  conversationSnapshotExpression,
  switchSessionExpression,
  waitForComposerExpression,
  newSessionExpression,
  writeScript,
  sendScript,
  writeExpression,
}
