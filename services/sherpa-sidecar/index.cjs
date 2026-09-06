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
  const endpointSeconds = Math.max(0.5, Math.min(3, Number(process.env.SHERPA_ENDPOINT_SECONDS) || 0.8))
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

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0
  let dot = 0; let leftNorm = 0; let rightNorm = 0
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i]
    leftNorm += left[i] * left[i]
    rightNorm += right[i] * right[i]
  }
  return dot / Math.max(1e-8, Math.sqrt(leftNorm * rightNorm))
}

function speakerScore(embedding) {
  if (!embedding || !enrollmentEmbeddings.length) return null
  return Math.max(...enrollmentEmbeddings.map((sample) => cosineSimilarity(embedding, sample)))
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
    const score = speakerScore(embedding)
    const canVerify = Boolean(speakerManager && speakerReady && embedding && score !== null)
    const verified = !requiresSpeaker || (canVerify && speakerManager.verify({ name: 'user', v: embedding, threshold }))
    if (requiresSpeaker) {
      if (!canVerify) emit(socket, 'speaker_unavailable', { score: null, reason: '语音片段太短或声纹模型尚未就绪' })
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
          if (!speakerManager) emit(socket, 'enrollment_error', { message: '声纹模型未配置或加载失败' })
          else if (!embedding) emit(socket, 'enrollment_error', { message: `有效声纹音频不足（收到 ${(enrollmentSamples.length / sampleRate).toFixed(1)} 秒）` })
          else {
            enrollmentEmbeddings.push(embedding); speakerManager.remove('user'); speakerManager.addMulti({ name: 'user', v: enrollmentEmbeddings }); speakerReady = true; enrollmentMode = false; enrollmentSamples = []; lastText = ''; utterance = []
            recognizer.reset(stream)
            if (process.env.SHERPA_SPEAKER_EMBEDDING) { fs.mkdirSync(path.dirname(process.env.SHERPA_SPEAKER_EMBEDDING), { recursive: true }); fs.writeFileSync(process.env.SHERPA_SPEAKER_EMBEDDING, JSON.stringify(enrollmentEmbeddings.map(vector => Array.from(vector)))) }
            emit(socket, 'enrolled')
          }
        }
        if (command.type === 'clear_speaker') { speakerManager?.remove('user'); enrollmentEmbeddings = []; speakerReady = false; if (process.env.SHERPA_SPEAKER_EMBEDDING) { try { fs.unlinkSync(process.env.SHERPA_SPEAKER_EMBEDDING) } catch {} } emit(socket, 'speaker_cleared') }
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
  socket.on('close', () => { try { stream?.inputFinished() } catch {} })
})
server.on('error', error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })
