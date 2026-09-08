/*
 * Local sherpa-onnx streaming service.
 *
 * The Electron process sends binary Float32 PCM frames and receives JSON events.
 * Models are deliberately supplied by environment variables so the installer
 * can manage downloads and checksums without baking large model files into JS.
 */
const { WebSocketServer } = require('ws')
const sherpa = require('sherpa-onnx-node')
const fs = require('node:fs')
const path = require('node:path')
const { bestSpeakerMatch } = require('./speaker-profile.cjs')
const { speakerUnavailableReason } = require('./speaker-readiness.cjs')

const port = Number(process.env.SHERPA_PORT || 0)
const sampleRate = 16000
let recognizer
let stream
let vad
let lastText = ''
let utterance = []
let speakerExtractor
let speakerManager
let punctuation
let speakerReady = false
let enrollmentEmbeddings = []
let enrollmentMode = false
let enrollmentSamples = []

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`缺少模型配置 ${name}`)
  return value
}

function createEngine() {
  const encoder = required('SHERPA_ASR_ENCODER')
  const decoder = required('SHERPA_ASR_DECODER')
  const asrType = process.env.SHERPA_ASR_TYPE || 'zipformer'
  const joiner = process.env.SHERPA_ASR_JOINER || ''
  const tokens = required('SHERPA_ASR_TOKENS')
  const vadModel = required('SHERPA_VAD_MODEL')
  const endpointSeconds = Math.max(0.5, Math.min(3, Number(process.env.SHERPA_ENDPOINT_SECONDS) || 1.2))
  const modelConfig = asrType === 'paraformer'
    ? { paraformer: { encoder, decoder }, tokens, numThreads: Number(process.env.SHERPA_THREADS || 2) }
    : { transducer: { encoder, decoder, joiner: required('SHERPA_ASR_JOINER') }, tokens, numThreads: Number(process.env.SHERPA_THREADS || 2) }
  recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate, featureDim: 80 },
    modelConfig,
    decodingMethod: 'greedy_search', enableEndpoint: 1,
    rule1MinTrailingSilence: endpointSeconds, rule2MinTrailingSilence: endpointSeconds, rule3MinUtteranceLength: 20
  })
  stream = recognizer.createStream()
  vad = new sherpa.Vad({ sampleRate, sileroVad: { model: vadModel, threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, windowSize: 512 } }, 30)
  const punctuationModel = process.env.SHERPA_PUNCTUATION_MODEL
  if (punctuationModel && process.env.SHERPA_PUNCTUATION !== '0' && fs.existsSync(punctuationModel)) {
    punctuation = new sherpa.OfflinePunctuation({ model: { ctTransformer: punctuationModel, numThreads: Number(process.env.SHERPA_THREADS || 2) } })
  }
  const speakerModel = process.env.SHERPA_SPEAKER_MODEL
  if (speakerModel) {
    speakerExtractor = new sherpa.SpeakerEmbeddingExtractor({ model: speakerModel, numThreads: Number(process.env.SHERPA_THREADS || 2) })
    speakerManager = new sherpa.SpeakerEmbeddingManager(speakerExtractor.dim)
    const embeddingPath = process.env.SHERPA_SPEAKER_EMBEDDING
    if (embeddingPath && fs.existsSync(embeddingPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(embeddingPath, 'utf8'))
        enrollmentEmbeddings = Array.isArray(saved[0]) ? saved.map(vector => Float32Array.from(vector)) : [Float32Array.from(saved)]
        if (enrollmentEmbeddings.every(vector => vector.length === speakerExtractor.dim)) { speakerManager.addMulti({ name: 'user', v: enrollmentEmbeddings }); speakerReady = true }
      } catch {}
    }
  }
}

function embeddingFromSamples(samples) {
  if (!speakerExtractor || samples.length < sampleRate) return null
  const speakerStream = speakerExtractor.createStream()
  speakerStream.acceptWaveform({ samples: Float32Array.from(samples), sampleRate })
  speakerStream.inputFinished()
  if (!speakerExtractor.isReady(speakerStream)) return null
  // Electron's Node runtime disallows V8 external ArrayBuffers. Ask the addon
  // to return a regular copied Float32Array so enrollment and verification work
  // in the packaged application as well as in standalone Node.
  return speakerExtractor.compute(speakerStream, false)
}

function resetEnrollmentCapture() {
  enrollmentMode = false
  enrollmentSamples = []
  lastText = ''
  utterance = []
  recognizer?.reset(stream)
}

function persistEnrollmentEmbeddings() {
  const embeddingPath = process.env.SHERPA_SPEAKER_EMBEDDING
  if (!embeddingPath) return
  if (!enrollmentEmbeddings.length) {
    try { fs.unlinkSync(embeddingPath) } catch {}
    return
  }
  fs.mkdirSync(path.dirname(embeddingPath), { recursive: true })
  fs.writeFileSync(embeddingPath, JSON.stringify(enrollmentEmbeddings.map(vector => Array.from(vector))))
}

function rebuildSpeakerProfile() {
  if (!speakerManager) return
  try { speakerManager.remove('user') } catch {}
  speakerReady = false
  if (enrollmentEmbeddings.length) {
    speakerManager.addMulti({ name: 'user', v: enrollmentEmbeddings })
    speakerReady = true
  }
}

function emit(socket, type, data = {}) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type, ...data }))
}

function decode(socket) {
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream)
    const text = recognizer.getResult(stream).text || ''
    if (text !== lastText) { lastText = text; emit(socket, 'partial', { text }) }
  }
  if (recognizer.isEndpoint(stream)) {
    const rawText = lastText.trim()
    const requiresSpeaker = process.env.SHERPA_REQUIRE_SPEAKER === '1'
    // Voiceprint tests must not depend on ASR producing text. A short or
    // misrecognized phrase can still contain enough audio for speaker
    // verification, so evaluate the embedding whenever an utterance ends.
    const embedding = embeddingFromSamples(utterance)
    const threshold = Number(process.env.SHERPA_SPEAKER_THRESHOLD || 0.55)
    const match = bestSpeakerMatch(embedding, enrollmentEmbeddings, threshold)
    const score = match.score
    const canVerify = Boolean(speakerManager && speakerReady && embedding && score !== null)
    const verified = !requiresSpeaker || (canVerify && match.verified)
    if (requiresSpeaker) {
      if (!canVerify) emit(socket, 'speaker_unavailable', {
        score: null,
        reason: speakerUnavailableReason({
          modelReady: Boolean(speakerManager),
          profileReady: speakerReady,
          embeddingReady: Boolean(embedding),
        }),
      })
      else emit(socket, verified ? 'speaker_verified' : 'speaker_rejected', { score })
    } else if (rawText) {
      emit(socket, 'speaker_verified', { score })
    }
    if (rawText && verified) {
      const text = punctuation ? punctuation.addPunct(rawText) : rawText
      emit(socket, 'final', { text, rawText, punctuated: Boolean(punctuation), samples: utterance.length })
    }
    emit(socket, 'speech_end')
    recognizer.reset(stream); lastText = ''; utterance = []
  }
}

const server = new WebSocketServer({ host: '127.0.0.1', port })
server.on('listening', () => {
  const address = server.address()
  process.stdout.write(JSON.stringify({ type: 'ready', port: address.port }) + '\n')
})
server.on('connection', socket => {
  let authorized = !process.env.SHERPA_TOKEN
  try { createEngine(); emit(socket, 'ready', { sampleRate }) }
  catch (error) { emit(socket, 'error', { message: error.message }); socket.close(); return }
  socket.on('message', (raw, isBinary) => {
    if (!isBinary) {
      try {
        const command = JSON.parse(raw.toString())
        if (command.type === 'auth') {
          authorized = command.token === process.env.SHERPA_TOKEN
          if (!authorized) { socket.close(1008, 'unauthorized'); return }
          emit(socket, 'authenticated')
          return
        }
        if (!authorized) { socket.close(1008, 'unauthorized'); return }
        if (command.type === 'ping') emit(socket, 'pong')
        if (command.type === 'reset') { recognizer.reset(stream); lastText = ''; utterance = [] }
        if (command.type === 'enroll_start') {
          enrollmentMode = true; enrollmentSamples = []; lastText = ''; utterance = []
          recognizer.reset(stream)
          emit(socket, 'enrollment_started')
        }
        if (command.type === 'enroll_end') {
          const embedding = embeddingFromSamples(enrollmentSamples)
          if (!speakerManager) {
            resetEnrollmentCapture()
            emit(socket, 'enrollment_error', { message: '声纹模型未配置或加载失败' })
          }
          else if (!embedding) {
            const duration = enrollmentSamples.length / sampleRate
            resetEnrollmentCapture()
            emit(socket, 'enrollment_error', { message: `有效声纹音频不足（收到 ${duration.toFixed(1)} 秒）` })
          }
          else {
            enrollmentEmbeddings.push(embedding)
            speakerManager.remove('user')
            speakerManager.addMulti({ name: 'user', v: enrollmentEmbeddings })
            speakerReady = true
            resetEnrollmentCapture()
            persistEnrollmentEmbeddings()
            emit(socket, 'enrolled')
          }
        }
        if (command.type === 'remove_speaker_sample') {
          const index = Number(command.index)
          if (!Number.isInteger(index) || index < 0 || index >= enrollmentEmbeddings.length)
            throw new Error('声纹样本索引无效')
          enrollmentEmbeddings.splice(index, 1)
          rebuildSpeakerProfile()
          persistEnrollmentEmbeddings()
          emit(socket, 'speaker_sample_removed', { index, remaining: enrollmentEmbeddings.length })
        }
        if (command.type === 'clear_speaker') { enrollmentEmbeddings = []; rebuildSpeakerProfile(); persistEnrollmentEmbeddings(); emit(socket, 'speaker_cleared') }
      }
      catch (error) { emit(socket, 'error', { message: `控制消息无效：${error.message}` }) }
      return
    }
    // `ws` may hand us a Buffer whose byteOffset is not 4-byte aligned.
    // Copy into an owned Float32Array so binary PCM frames are always decoded safely.
    const sampleCount = Math.floor(raw.byteLength / 4)
    const samples = new Float32Array(sampleCount)
    new Uint8Array(samples.buffer).set(raw.subarray(0, sampleCount * 4))
    // Enrollment audio is private model-training input. It must never enter the
    // normal VAD/ASR pipeline or become a ChatGPT draft.
    if (enrollmentMode) { enrollmentSamples.push(...samples); return }
    utterance.push(...samples)
    const wasSpeaking = vad.isDetected()
    vad.acceptWaveform(samples)
    if (!wasSpeaking && vad.isDetected()) emit(socket, 'speech_start')
    stream.acceptWaveform({ samples, sampleRate })
    decode(socket)
  })
  socket.on('close', () => { resetEnrollmentCapture(); try { stream?.inputFinished() } catch {} })
})
server.on('error', error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })
