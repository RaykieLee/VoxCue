const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8')

test('an active microphone stream is always stopped by the toggle action', () => {
  assert.match(
    appSource,
    /const toggleListening = \(\) =>\s*streamRef\.current \|\| startInProgressRef\.current\s*\? stopListening\(\)\s*: startListening\(\)/,
  )
})

test('terminal recognition events stop the microphone session', () => {
  const finalHandler = appSource.match(/if \(event\.type === "final"\) \{([\s\S]*?)if \(event\.type === "enrolled"\)/)?.[1] || ''
  assert.match(finalHandler, /stopListening\(\)/)

  const rejectedHandler = appSource.match(/if \(event\.type === "speaker_rejected"\) \{([\s\S]*?)if \(event\.type === "speaker_unavailable"\)/)?.[1] || ''
  assert.match(rejectedHandler, /stopListening\(\)/)

  const unavailableHandler = appSource.match(/if \(event\.type === "speaker_unavailable"\) \{([\s\S]*?)if \(event\.type === "speech_end"/)?.[1] || ''
  assert.match(unavailableHandler, /stopListening\(\)/)
})
