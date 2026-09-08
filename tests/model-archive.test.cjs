const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const tar = require('tar-stream')
const { Bzip2 } = require('compressjs')
const { extractTarBz2Stream } = require('../electron/model-archive.cjs')

function archiveFixture() {
  const pack = tar.pack()
  const chunks = []
  pack.on('data', (chunk) => chunks.push(chunk))
  return new Promise((resolve, reject) => {
    pack.on('error', reject)
    pack.on('end', () => resolve(Buffer.concat(chunks)))
    pack.entry({ name: 'model/encoder.onnx' }, 'model-data')
    pack.finalize()
  })
}

test('extracts tar.bz2 models without invoking a system tar executable', async () => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'voxcue-model-'))
  const tarBuffer = await archiveFixture()
  const compressed = Buffer.from(Bzip2.compressFile(tarBuffer))
  try {
    await extractTarBz2Stream(Readable.from(compressed), destination)
    assert.equal(
      fs.readFileSync(path.join(destination, 'model', 'encoder.onnx'), 'utf8'),
      'model-data',
    )
  } finally {
    fs.rmSync(destination, { recursive: true, force: true })
  }
})
