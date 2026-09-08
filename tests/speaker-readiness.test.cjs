const test = require('node:test')
const assert = require('node:assert/strict')
const { speakerUnavailableReason } = require('../services/sherpa-sidecar/speaker-readiness.cjs')

test('distinguishes a missing voiceprint registration from a missing model', () => {
  assert.match(speakerUnavailableReason({ modelReady: true, profileReady: false, embeddingReady: false }), /尚未注册/)
  assert.doesNotMatch(speakerUnavailableReason({ modelReady: true, profileReady: false, embeddingReady: false }), /模型尚未就绪/)
})

test('reports a short utterance only when model and profile are ready', () => {
  assert.match(speakerUnavailableReason({ modelReady: true, profileReady: true, embeddingReady: false }), /至少 1 秒/)
  assert.match(speakerUnavailableReason({ modelReady: false, profileReady: false, embeddingReady: false }), /模型未加载/)
})
