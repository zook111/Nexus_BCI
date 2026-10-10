import { describe, expect, it } from 'vitest'

import {
  SCORING_VERSION,
  calculateAlphaProof,
  calculateChallengeScore,
  deriveSignalGate,
} from './model'

describe('calculateAlphaProof', () => {
  it('derives a personalized threshold from clean eyes-open and eyes-closed windows', () => {
    const proof = calculateAlphaProof([1, 1.2, 1.4], [2.4, 2.6, 2.8])

    expect(proof.openAlpha).toBeCloseTo(1.2)
    expect(proof.closedAlpha).toBeCloseTo(2.6)
    expect(proof.alphaLiftPercent).toBeCloseTo(116.6667, 3)
    expect(proof.thresholdAlpha).toBeCloseTo(2.11)
    expect(proof.openWindowCount).toBe(3)
    expect(proof.closedWindowCount).toBe(3)
  })

  it('rejects missing or non-finite clean windows', () => {
    expect(() => calculateAlphaProof([], [2, 3])).toThrow('clean eyes-open')
    expect(() => calculateAlphaProof([1, Number.NaN], [2, 3])).toThrow('finite')
  })

  it('keeps lift finite when the eyes-open mean is zero', () => {
    const proof = calculateAlphaProof([0, 0], [1, 1])

    expect(proof.alphaLiftPercent).toBe(0)
    expect(proof.thresholdAlpha).toBeCloseTo(0.65)
  })
})

describe('calculateChallengeScore', () => {
  it('rewards personalized lift and clean hold while confidence weights the result', () => {
    const confident = calculateChallengeScore({
      alphaLiftPercent: 120,
      cleanHoldSeconds: 18,
      challengeDurationSeconds: 30,
      confidence: 0.95,
    })
    const uncertain = calculateChallengeScore({
      alphaLiftPercent: 120,
      cleanHoldSeconds: 18,
      challengeDurationSeconds: 30,
      confidence: 0.3,
    })

    expect(confident.score).toBeGreaterThan(uncertain.score)
    expect(confident.score).toBeGreaterThan(0)
    expect(confident.scoringVersion).toBe(SCORING_VERSION)
  })

  it('always returns a score between zero and one thousand', () => {
    expect(
      calculateChallengeScore({
        alphaLiftPercent: -500,
        cleanHoldSeconds: -20,
        challengeDurationSeconds: 0,
        confidence: -1,
      }).score,
    ).toBe(0)
    expect(
      calculateChallengeScore({
        alphaLiftPercent: 5000,
        cleanHoldSeconds: 5000,
        challengeDurationSeconds: 30,
        confidence: 4,
      }).score,
    ).toBe(1000)
  })
})

describe('deriveSignalGate', () => {
  const liveInput = {
    boardStatus: 'streaming',
    signalState: 'usable',
    confidence: 0.9,
    alphaPost: 2.2,
    lastAdvancedAtMs: 8_500,
    lastFeatureAdvancedAtMs: 8_500,
    nowMs: 10_000,
  }

  it('opens only for fresh, usable posterior data', () => {
    expect(deriveSignalGate(liveInput)).toEqual({ open: true, reason: 'Signal ready' })
  })

  it('closes after three seconds without an advancing stream timestamp', () => {
    expect(deriveSignalGate({ ...liveInput, lastAdvancedAtMs: 6_999 })).toEqual({
      open: false,
      reason: 'Signal paused — live samples are stale',
    })
  })

  it('closes when processed features stop refreshing despite fresh raw samples', () => {
    expect(deriveSignalGate({ ...liveInput, lastFeatureAdvancedAtMs: 6_999 })).toEqual({
      open: false,
      reason: 'Signal paused — processed features are stale',
    })
  })

  it('explains confidence and quality pauses without implying a result', () => {
    expect(deriveSignalGate({ ...liveInput, confidence: 0.4 })).toEqual({
      open: false,
      reason: 'Signal paused — confidence is still settling',
    })
    expect(deriveSignalGate({ ...liveInput, signalState: 'noisy' })).toEqual({
      open: false,
      reason: 'Signal paused — check posterior contacts and movement',
    })
  })
})
