const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')
const sidecar = fs.readFileSync(path.join(__dirname, '..', 'services', 'sherpa-sidecar', 'index.cjs'), 'utf8')
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8')

test('settings expose persisted hotwords and a bounded boost score', () => {
  assert.match(app, /hotwords: string;/)
  assert.match(app, /hotwordsScore: number;/)
  assert.match(app, /<strong>识别热词<\/strong>/)
  assert.match(main, /Math\.max\(0\.5, Math\.min\(3, Number\(options\.hotwordsScore/)
})

test('hotwords select modified beam search only for compatible transducer models', () => {
  assert.match(main, /supportsHotwords = \(asr\.architecture \|\| "zipformer"\) !== "paraformer"/)
  assert.match(sidecar, /asrType === 'paraformer' \? '' : \(process\.env\.SHERPA_HOTWORDS_FILE \|\| ''\)/)
  assert.match(sidecar, /decodingMethod: hotwordsFile \? 'modified_beam_search' : 'greedy_search'/)
  assert.match(sidecar, /hotwordsFile,/)
})
