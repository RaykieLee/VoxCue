const test = require('node:test')
const assert = require('node:assert/strict')
const { parseSessionCommand, canRouteSessionCommand } = require('../electron/session-commands.cjs')

test('session voice command extracts Chinese title and removes suffix', () => {
  assert.deepEqual(parseSessionCommand('请切换到产品讨论对话。'), {
    type: 'switch-session',
    query: '产品讨论',
    raw: '请切换到产品讨论对话',
  })
  assert.equal(parseSessionCommand('打开 产品讨论 会话').query, '产品讨论')
})

test('session voice command supports English and ignores ordinary speech', () => {
  assert.equal(parseSessionCommand('switch to the conversation roadmap').query, 'roadmap')
  assert.equal(parseSessionCommand('今天天气很好'), null)
})

test('session routing honors speaker protection', () => {
  assert.equal(canRouteSessionCommand(true, false), false)
  assert.equal(canRouteSessionCommand(true, true), true)
  assert.equal(canRouteSessionCommand(false, false), true)
})
