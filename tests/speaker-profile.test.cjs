const test = require('node:test')
const assert = require('node:assert/strict')
const { bestSpeakerMatch } = require('../services/sherpa-sidecar/speaker-profile.cjs')

test('adding a voiceprint sample cannot lower the best match score', () => {
  const candidate = Float32Array.from([1, 0])
  const closeSample = Float32Array.from([0.9, 0.1])
  const distantSample = Float32Array.from([0, 1])
  const oneSample = bestSpeakerMatch(candidate, [closeSample], 0.8)
  const twoSamples = bestSpeakerMatch(candidate, [closeSample, distantSample], 0.8)

  assert.equal(oneSample.verified, true)
  assert.equal(twoSamples.verified, true)
  assert.equal(twoSamples.score, oneSample.score)
})

test('speaker matching rejects missing or below-threshold embeddings', () => {
  assert.deepEqual(bestSpeakerMatch(null, [], 0.55), { score: null, verified: false })
  const result = bestSpeakerMatch(Float32Array.from([1, 0]), [Float32Array.from([0, 1])], 0.55)
  assert.equal(result.verified, false)
  assert.equal(result.score, 0)
})
