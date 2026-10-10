/** Two-channel teaching maths. No recordings, model weights or API calls are used. */
export type Symmetric2 = readonly [number, number, number] // C11, C12, C22
export type Features3 = readonly [number, number, number]

export function teachingSignals(correlation: number, amplitudeB: number, mains: number) {
  const samples = 250
  const times = Array.from({ length: samples }, (_, i) => i / samples)
  const channelA = times.map(t => Math.SQRT2 * 10 * Math.sin(2 * Math.PI * 12 * t))
  const channelB = times.map(t => Math.SQRT2 * amplitudeB * (
    correlation * Math.sin(2 * Math.PI * 12 * t)
    + Math.sqrt(1 - correlation ** 2) * Math.cos(2 * Math.PI * 12 * t)
  ))
  const rawA = times.map((t, i) => channelA[i] + mains * Math.sin(2 * Math.PI * 50 * t) + 12 * Math.sin(2 * Math.PI * t))
  return { times, rawA, channelA, channelB }
}

export function covariance(a: number[], b: number[]): Symmetric2 {
  if (a.length !== b.length || a.length < 2) throw new Error('Use two equally sized channels')
  const n = a.length
  const meanA = a.reduce((sum, x) => sum + x, 0) / n
  const meanB = b.reduce((sum, x) => sum + x, 0) / n
  return [
    a.reduce((sum, x) => sum + (x - meanA) ** 2, 0) / n,
    a.reduce((sum, x, i) => sum + (x - meanA) * (b[i] - meanB), 0) / n,
    b.reduce((sum, x) => sum + (x - meanB) ** 2, 0) / n,
  ]
}

export function shrink(c: Symmetric2, amount = 0.1): Symmetric2 {
  const target = (c[0] + c[2]) / 2
  return [(1 - amount) * c[0] + amount * target, (1 - amount) * c[1], (1 - amount) * c[2] + amount * target]
}

/** Spectral matrix logarithm, not a logarithm applied separately to each entry. */
export function matrixLog(c: Symmetric2): Symmetric2 {
  const [a, b, d] = c
  const mid = (a + d) / 2
  const radius = Math.hypot((a - d) / 2, b)
  if (mid - radius <= 0) throw new Error('Matrix must be positive definite')
  if (radius < 1e-12) return [Math.log(mid), 0, Math.log(mid)]
  const high = Math.log(mid + radius)
  const low = Math.log(mid - radius)
  const average = (high + low) / 2
  const scale = (high - low) / (2 * radius)
  return [average + scale * (a - mid), scale * b, average + scale * (d - mid)]
}

/** Exact Riemannian tangent coordinates for the teaching reference R = 100 I. */
export function tangentFeatures(c: Symmetric2): Features3 {
  const s = matrixLog([c[0] / 100, c[1] / 100, c[2] / 100])
  return [s[0], Math.SQRT2 * s[1], s[2]]
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
}

export function classify(features: Features3, couplingWeight: number, intercept: number) {
  const contributions: Features3 = [-features[0], couplingWeight * features[1], features[2]]
  const z = intercept + contributions.reduce((sum, value) => sum + value, 0)
  return { contributions, z, probability: sigmoid(z) }
}
