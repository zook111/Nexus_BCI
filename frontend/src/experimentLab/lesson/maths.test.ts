import { describe, expect, it } from 'vitest'
import { classify, covariance, matrixLog, shrink, sigmoid, tangentFeatures, teachingSignals } from './maths'

describe('teaching maths', () => {
  it('matches the hand-calculated covariance and quadratic amplitude scaling', () => {
    const a = [-2, -1, 1, 2], b = [-1, -2, 2, 1]
    expect(covariance(a, b)).toEqual([2.5, 2, 2.5])
    expect(covariance(a.map(v => 2 * v), b.map(v => 2 * v))).toEqual([10, 8, 10])
  })
  it('changes interference without changing the retained signal', () => {
    const quiet = teachingSignals(0.6, 10, 0)
    const noisy = teachingSignals(0.6, 10, 40)
    expect(noisy.channelA).toEqual(quiet.channelA)
    expect(noisy.rawA).not.toEqual(quiet.rawA)
    const c = covariance(noisy.channelA, noisy.channelB)
    expect(c[0]).toBeCloseTo(100, 9)
    expect(c[1]).toBeCloseTo(60, 9)
    expect(c[2]).toBeCloseTo(100, 9)
  })
  it('maps the reference to zero and reciprocal scalar variances to opposite logs', () => {
    expect(tangentFeatures([100, 0, 100])).toEqual([0, 0, 0])
    expect(tangentFeatures([200, 0, 200])[0]).toBeCloseTo(Math.log(2), 12)
    expect(tangentFeatures([50, 0, 50])[0]).toBeCloseTo(-Math.log(2), 12)
    expect(() => matrixLog([1, 2, 1])).toThrow('positive definite')
  })
  it('matches pyRiemann 0.9 tangent-space reference values including sqrt(2) weighting', () => {
    // Generated independently with tangent_space(C, 100 * eye(2), metric='riemann').
    const expected = [-0.17237318653672928, 0.8544050474929329, -0.17237318653672928]
    tangentFeatures(shrink([100, 60, 100])).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10))
  })
  it('handles unequal variances and negative off-diagonal terms against pyRiemann', () => {
    const expected = [0.6728474576953853, -0.3300722356944988, -0.26073780686855247]
    tangentFeatures([200, -30, 80]).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10))
  })
  it('keeps every reachable lesson matrix positive definite and outputs finite', () => {
    for (const correlation of [-0.9, 0, 0.9]) for (const sd of [5, 10, 25]) {
      const signals = teachingSignals(correlation, sd, 40)
      const features = tangentFeatures(shrink(covariance(signals.channelA, signals.channelB)))
      expect(features.every(Number.isFinite)).toBe(true)
      for (const w of [-3, 0, 3]) for (const b of [-3, 0, 3]) {
        const result = classify(features, w, b)
        expect(result.probability).toBeGreaterThan(0)
        expect(result.probability).toBeLessThan(1)
      }
    }
  })
  it('uses a stable sigmoid and applies the weighted sum', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(1000)).toBe(1)
    expect(sigmoid(-1000)).toBe(0)
    expect(classify([1, 2, 3], 2, -1).z).toBe(5)
  })
})
