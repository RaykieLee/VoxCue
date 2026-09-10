const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8')

test('main onboarding state automatically starts every idle microphone check', () => {
  assert.match(
    source,
    /if \(!loaded \|\| page !== "onboarding" \|\| micCheck !== "idle"\) return;[\s\S]{0,120}void checkMicrophone\(\)/,
  )
  assert.doesNotMatch(source, /autoMicCheckStartedRef/)
})

test('onboarding uses a compact refresh icon that refreshes and retests', () => {
  assert.match(source, /className="microphone-select-row"[\s\S]{0,900}className="icon-button mic-refresh-button"/)
  assert.match(source, /className="icon-button mic-refresh-button"/)
  assert.match(source, /aria-label="刷新麦克风列表并重新检测"/)
  assert.doesNotMatch(source, />\s*刷新麦克风列表\s*</)
})
