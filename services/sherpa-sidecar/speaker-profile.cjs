function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }
  return dot / Math.max(1e-8, Math.sqrt(leftNorm * rightNorm))
}

function bestSpeakerMatch(candidate, samples, threshold = 0.55) {
  if (!candidate || !Array.isArray(samples) || !samples.length)
    return { score: null, verified: false }
  const score = Math.max(...samples.map((sample) => cosineSimilarity(candidate, sample)))
  return { score, verified: score >= Number(threshold) }
}

module.exports = { bestSpeakerMatch, cosineSimilarity }
