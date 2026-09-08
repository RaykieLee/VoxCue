const fs = require('node:fs')
const { pipeline } = require('node:stream/promises')
const tarFs = require('tar-fs')
const unbzip2 = require('unbzip2-stream')

async function extractTarBz2Stream(input, destination) {
  await pipeline(input, unbzip2(), tarFs.extract(destination))
}

async function extractTarBz2File(archive, destination) {
  await extractTarBz2Stream(fs.createReadStream(archive), destination)
}

module.exports = { extractTarBz2File, extractTarBz2Stream }
