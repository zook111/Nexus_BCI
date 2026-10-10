export const SCORING_VERSION = 'doctor-demo-v1'
export const SIGNAL_STALE_AFTER_MS = 3_000
export const SIGNAL_CONFIDENCE_THRESHOLD = 0.55

export type AlphaProof = {
  openAlpha: number
  closedAlpha: number
  alphaLiftPercent: number
  thresholdAlpha: number
  openWindowCount: number
  closedWindowCount: number
}

export type ChallengeScoreInput = {
  alphaLiftPercent: number
  cleanHoldSeconds: number
  challengeDurationSeconds: number
  confidence: number
}

export type SignalGateInput = {
  boardStatus: string
  signalState: string | null | undefined
  confidence: number | null | undefined
  alphaPost: number | null | undefined
  lastAdvancedAtMs: number | null
  lastFeatureAdvancedAtMs: number | null
  nowMs: number
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function validateWindows(values: number[], label: string): void {
  if (!values.length) throw new Error(`At least one clean ${label} window is required`)
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} windows must contain finite positive-or-zero values`)
  }
}

export function calculateAlphaProof(
  openWindows: number[],
  closedWindows: number[],
): AlphaProof {
  validateWindows(openWindows, 'eyes-open')
  validateWindows(closedWindows, 'eyes-closed')

  const openAlpha = mean(openWindows)
  const closedAlpha = mean(closedWindows)
  const response = closedAlpha - openAlpha
  const alphaLiftPercent = openAlpha > 0 ? (response / openAlpha) * 100 : 0
  const thresholdAlpha = openAlpha + Math.max(response * 0.65, openAlpha * 0.08, 0)

  return {
    openAlpha,
    closedAlpha,
    alphaLiftPercent,
    thresholdAlpha,
    openWindowCount: openWindows.length,
    closedWindowCount: closedWindows.length,
  }
}

export function calculateChallengeScore(input: ChallengeScoreInput): {
  score: number
  scoringVersion: string
} {
  const lift = clampUnit(input.alphaLiftPercent / 150)
  const hold = clampUnit(
    input.challengeDurationSeconds > 0
      ? input.cleanHoldSeconds / input.challengeDurationSeconds
      : 0,
  )
  const confidence = clampUnit(input.confidence)
  const performance = lift * 0.55 + hold * 0.45
  const confidenceWeight = 0.55 + confidence * 0.45
  const score = Math.round(clampUnit(performance * confidenceWeight) * 1_000)

  return { score, scoringVersion: SCORING_VERSION }
}

export function deriveSignalGate(input: SignalGateInput): {
  open: boolean
  reason: string
} {
  if (input.boardStatus !== 'streaming') {
    return { open: false, reason: 'Signal paused — start the live stream' }
  }
  if (
    input.lastAdvancedAtMs === null ||
    input.nowMs - input.lastAdvancedAtMs > SIGNAL_STALE_AFTER_MS
  ) {
    return { open: false, reason: 'Signal paused — live samples are stale' }
  }
  if (
    input.lastFeatureAdvancedAtMs === null ||
    input.nowMs - input.lastFeatureAdvancedAtMs > SIGNAL_STALE_AFTER_MS
  ) {
    return { open: false, reason: 'Signal paused — processed features are stale' }
  }
  if (input.signalState !== 'usable') {
    return {
      open: false,
      reason: 'Signal paused — check posterior contacts and movement',
    }
  }
  if ((input.confidence ?? 0) < SIGNAL_CONFIDENCE_THRESHOLD) {
    return { open: false, reason: 'Signal paused — confidence is still settling' }
  }
  if (typeof input.alphaPost !== 'number' || !Number.isFinite(input.alphaPost)) {
    return { open: false, reason: 'Signal paused — posterior alpha is unavailable' }
  }
  return { open: true, reason: 'Signal ready' }
}
