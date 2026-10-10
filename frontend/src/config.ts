export const DEFAULT_LINE_FREQUENCY_HZ = 50

export function normalizeLineFrequencyHz(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 120
    ? value
    : DEFAULT_LINE_FREQUENCY_HZ
}
