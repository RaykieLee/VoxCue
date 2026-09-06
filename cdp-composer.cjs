const editorSelector = '#prompt-textarea, [data-testid="prompt-textarea"], [role="textbox"][contenteditable="true"], textarea[placeholder], textarea, [contenteditable="true"]'
const detectExpression = `Boolean(document.querySelector(${JSON.stringify(editorSelector)}))`

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

module.exports = { editorSelector, detectExpression, writeScript, sendScript, writeExpression }
