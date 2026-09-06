const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const composer = require('../electron/cdp-composer.cjs')

function runWrite({ value = '', contentEditable = false, append = true, text = '你好 ChatGPT\n第二行' } = {}) {
  const events = []
  const editor = { tagName: contentEditable ? 'DIV' : 'TEXTAREA', value, innerText: value, dispatchEvent: event => events.push(event.type) }
  const document = { querySelector: selector => selector.includes('contenteditable') && contentEditable ? editor : selector.includes('textarea') && !contentEditable ? editor : null }
  const context = {
    document, HTMLTextAreaElement: function HTMLTextAreaElement() {},
    Event: class Event { constructor(type) { this.type = type } },
    InputEvent: class InputEvent { constructor(type) { this.type = type } }
  }
  Object.defineProperty(context.HTMLTextAreaElement.prototype, 'value', { set(next) { editor.value = next } })
  const result = vm.runInNewContext(composer.writeExpression(text, append), context) 
  return { result, editor, events }
}

test('textarea write replaces or appends exactly once', () => {
  const output = runWrite({ value: '已有内容', append: true })
  assert.equal(output.result.ok, true)
  assert.equal(output.result.length, 19)
  assert.equal(output.editor.value, '已有内容\n你好 ChatGPT\n第二行')
  assert.deepEqual(output.events, ['input'])
})

test('contenteditable write dispatches beforeinput and input', () => {
  const output = runWrite({ contentEditable: true, value: '草稿', append: false, text: '新文本' })
  assert.equal(output.result.ok, true)
  assert.equal(output.result.length, 3)
  assert.equal(output.editor.innerText, '新文本')
  assert.deepEqual(output.events, ['beforeinput', 'input'])
})

test('empty text is represented as a safe rejected operation by main validation', () => {
  assert.match(composer.writeExpression('', false), /""/)
})

test('composer detection covers current ChatGPT editor selectors', () => {
  assert.match(composer.editorSelector, /#prompt-textarea/)
  assert.match(composer.editorSelector, /role="textbox"/)
})

test('send script clicks a labeled send button', () => {
  const calls = []
  const button = { disabled: false, click: () => calls.push('clicked'), getAttribute: name => name === 'aria-label' ? '发送' : null, textContent: '', getBoundingClientRect: () => ({ width: 30, height: 30, x: 10, y: 10, bottom: 40 }) }
  const context = { document: { querySelector: () => null, querySelectorAll: selector => selector.includes('发送') ? [button] : [] } }
  const result = vm.runInNewContext(composer.sendScript, context)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['clicked'])
})

test('send script never clicks the stop button while ChatGPT is generating', () => {
  const stop = { disabled: false, click: () => { throw new Error('must not click stop') }, getAttribute: name => name === 'aria-label' ? '停止' : null, textContent: '', getBoundingClientRect: () => ({ width: 30, height: 30 }) }
  const context = { document: { querySelector: () => null, querySelectorAll: selector => selector === 'button' ? [stop] : [] } }
  const result = vm.runInNewContext(composer.sendScript, context)
  assert.equal(result.ok, false)
  assert.match(result.reason, /正在生成回复/)
})

test('session list extracts unique conversation links and marks the current one', () => {
  const links = [
    { getAttribute: name => name === 'href' ? '/c/abc-123' : null, innerText: '产品讨论', textContent: '产品讨论', className: '' },
    { getAttribute: name => name === 'href' ? '/c/abc-123' : null, innerText: '重复入口', textContent: '重复入口', className: '' },
    { getAttribute: name => name === 'href' ? '/c/def-456' : name === 'aria-current' ? 'page' : null, innerText: '当前对话', textContent: '当前对话', className: '' },
  ]
  const context = {
    location: { pathname: '/c/def-456', href: 'https://chatgpt.com/c/def-456' },
    document: { querySelectorAll: () => links, title: 'ChatGPT' },
    URL,
    decodeURIComponent,
  }
  const result = vm.runInNewContext(composer.sessionsListExpression, context)
  assert.equal(result.ok, true)
  assert.equal(result.currentId, 'def-456')
  assert.equal(result.sessions.length, 2)
  assert.equal(result.currentTitle, '当前对话')
  assert.equal(result.sessions[0].id, 'abc-123')
})

test('session switch clicks the matching conversation link', () => {
  const calls = []
  const link = {
    getAttribute: name => name === 'href' ? '/c/abc-123' : null,
    click: () => calls.push('clicked'),
  }
  const context = {
    document: { querySelectorAll: () => [link] },
    location: { href: 'https://chatgpt.com/c/old', origin: 'https://chatgpt.com' },
    URL,
    decodeURIComponent,
  }
  const result = vm.runInNewContext(composer.switchSessionExpression('abc-123'), context)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['clicked'])
})

test('session switch rejects an unsafe fallback URL', () => {
  const context = {
    document: { querySelectorAll: () => [] },
    location: { href: 'https://chatgpt.com/c/old', origin: 'https://chatgpt.com' },
    URL,
    decodeURIComponent,
  }
  const result = vm.runInNewContext(composer.switchSessionExpression('abc-123', 'https://evil.example/c/abc-123'), context)
  assert.equal(result.ok, false)
  assert.match(result.reason, /地址无效/)
})

test('new session expression clicks the localized new-chat control', () => {
  const calls = []
  const button = {
    getAttribute: name => name === 'aria-label' ? '新对话' : null,
    innerText: '', textContent: '', click: () => calls.push('clicked'),
  }
  const context = { document: { querySelectorAll: () => [button] } }
  const result = vm.runInNewContext(composer.newSessionExpression, context)
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['clicked'])
})

test('conversation snapshot returns the latest user message and assistant summary', () => {
  const node = (role, text) => ({
    getAttribute: name => name === 'data-message-author-role' ? role : null,
    innerText: text,
    textContent: text,
  })
  const context = {
    location: { pathname: '/c/abc-123' },
    document: {
      querySelectorAll: () => [
        node('user', '请总结这段内容'),
        node('assistant', '这是一个很长的回复，用于验证摘要会被截取并返回。'),
      ],
      title: '产品讨论 - ChatGPT',
    },
  }
  const result = vm.runInNewContext(composer.conversationSnapshotExpression, context)
  assert.equal(result.ok, true)
  assert.equal(result.currentId, 'abc-123')
  assert.equal(result.latestUser, '请总结这段内容')
  assert.match(result.replySummary, /这是一个很长的回复/)
})
