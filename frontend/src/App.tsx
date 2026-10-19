import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BarChart3,
  BrainCircuit,
  BookOpen,
  Cable,
  Check,
  CircleAlert,
  CircleDot,
  CircleCheck,
  Cpu,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Headphones,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Radio,
  SkipBack,
  SkipForward,
  Square,
  Pencil,
  Trash2,
  Waves,
  X,
} from 'lucide-react'
import {
  api,
  API_BASE_URL,
  recordingCalibrationReportUrl,
  recordingDownloadUrl,
  STREAM_WS_URL,
} from './api'
import calibrationBedLoopUrl from './assets/audio/feedback/calibration-bed.mp3'
import calmTrendLoopUrl from './assets/audio/feedback/calm-trend.mp3'
import confidenceGateOpenLoopUrl from './assets/audio/feedback/confidence-gate-open.mp3'
import focusToneLoopUrl from './assets/audio/feedback/focus-tone.mp3'
import pausedLowConfidenceLoopUrl from './assets/audio/feedback/paused-low-confidence.mp3'
import signalClarityLoopUrl from './assets/audio/feedback/signal-clarity.mp3'
import { DEFAULT_LINE_FREQUENCY_HZ, normalizeLineFrequencyHz } from './config'
import {
  formatBoardActionError,
  isDeviceSelectionLocked,
  resolveAutomaticDeviceSetup,
} from './deviceSetup'
import { DoctorDemo } from './doctorDemo/DoctorDemo'
import { ExperimentLab } from './experimentLab/ExperimentLab'
import { StudentHelp } from './StudentHelp'
import { connectLiveStream, sharedBoardState } from './liveStream'
import type {
  BoardKind,
  BoardState,
  CalmCalibrationState,
  CalmFeatureResponse,
  ChannelSnapshot,
  DspChannelSummary,
  DspSummary,
  HealthResponse,
  RecordingPreview,
  RecordingCalibrationMarker,
  RecordingSpectralAnalysis,
  RecordingState,
  SerialPortInfo,
  SignalQuality,
  SignalQualityChannel,
  StreamSnapshot,
} from './api'
import './App.css'

const emptyBoard: BoardState = {
  status: 'idle',
  eeg_channels: [],
  eeg_names: [],
}

const emptyStream: StreamSnapshot = {
  status: 'idle',
  sample_count: 0,
  timestamps: [],
  channels: [],
}

const emptyRecording: RecordingState = {
  active: false,
  sample_count: 0,
  eeg_names: [],
  setup_quality_snapshots: [],
  calibration_markers: [],
}

const emptyCalmBaseline: CalmCalibrationState = {
  status: 'inactive',
  elapsed_seconds: 0,
  target_duration_seconds: 30,
  accepted_windows: 0,
  required_windows: 3,
  line_frequency_hz: DEFAULT_LINE_FREQUENCY_HZ,
  window_size: 1000,
  posterior_labels: ['P7', 'P8', 'O1', 'O2'],
}

const dspBandOrder = ['delta', 'theta', 'alpha', 'beta', 'gamma']
const replayWindowSizeOptions = [250, 500, 1000, 2000]
const dspWindowSizeOptions = [250, 500, 1000, 2000, 5000]
const feedbackMinimumSamples = 64
const syntheticDemoBaselineDurationSeconds = 6
const hardwareBaselineDurationSeconds = 30
const dspLimits = {
  windowMin: 64,
  windowMax: 5000,
  bandpassLowMin: 0.01,
  bandpassLowMax: 100,
  bandpassHighMin: 1,
  bandpassHighMax: 120,
  notchMin: 1,
  notchMax: 120,
}
const calmAudioConfidenceThreshold = 0.55
const calmAudioVoices = {
  tide: { label: 'Tide', baseHz: 174.61, spread: 1.5, filterHz: 720 },
  air: { label: 'Air', baseHz: 220, spread: 1.333, filterHz: 1040 },
  ember: { label: 'Ember', baseHz: 196, spread: 1.25, filterHz: 860 },
}
type CalmAudioVoice = keyof typeof calmAudioVoices
const lyriaAudioLoops = {
  'calm-trend': { label: 'Calm trend', src: calmTrendLoopUrl },
  'focus-tone': { label: 'Focus tone', src: focusToneLoopUrl },
  'signal-clarity': { label: 'Signal clarity', src: signalClarityLoopUrl },
  'confidence-gate-open': { label: 'Gate open', src: confidenceGateOpenLoopUrl },
  'paused-low-confidence': { label: 'Paused', src: pausedLowConfidenceLoopUrl },
  'calibration-bed': { label: 'Calibration bed', src: calibrationBedLoopUrl },
}
type LyriaAudioLoop = keyof typeof lyriaAudioLoops
type FeedbackMode = 'calm' | 'focus' | 'clarity'
type VisualizerKind = 'aurora' | 'constellation' | 'resonance' | 'bloom' | 'current'
type FeedbackAudioVoice = CalmAudioVoice | LyriaAudioLoop
type CalibrationStatus = 'idle' | 'running' | 'complete'

type FeedbackState = {
  mode: FeedbackMode
  label: string
  score?: number | null
  confidence: number
  signalState: CalmFeatureResponse['signal_state']
  title: string
  detail: string
  driverLabel: string
  driverValue: string
  flags: string[]
  hue: number
  features: Array<{ label: string; value: string }>
}

type CalibrationStep = {
  id: string
  label: string
  cue: string
  durationSeconds: number
  detail: string
}

type CalibrationMarker = {
  stepId: string
  label: string
  cue: string
  timestamp: string
  elapsedSeconds: number
  streamSampleCount: number
  calmScore?: number | null
  confidence?: number | null
  alphaPost?: number | null
  highFrequencyRatio?: number | null
  signalState?: CalmFeatureResponse['signal_state'] | null
  qualityGood?: number | null
  qualityQuestionable?: number | null
  qualityBad?: number | null
}

type FeedbackExperiencePreset = {
  id: string
  label: string
  detail: string
  mode: FeedbackMode
  visualizer: VisualizerKind
  audio: LyriaAudioLoop
}

const feedbackModeOrder: FeedbackMode[] = ['calm', 'focus', 'clarity']
const visualizerOrder: VisualizerKind[] = ['aurora', 'constellation', 'resonance', 'bloom', 'current']
const calibrationProtocol: CalibrationStep[] = [
  {
    id: 'settle-open',
    label: 'Eyes open',
    cue: 'Open eyes. Look softly ahead.',
    durationSeconds: 10,
    detail: 'Settle posture and keep jaw relaxed.',
  },
  {
    id: 'eyes-closed',
    label: 'Eyes closed',
    cue: 'Close eyes now.',
    durationSeconds: 20,
    detail: 'Stay still while posterior alpha response is sampled.',
  },
  {
    id: 'eyes-open',
    label: 'Open eyes',
    cue: 'Open eyes now.',
    durationSeconds: 15,
    detail: 'Return to a soft gaze without moving the headset.',
  },
  {
    id: 'blink-check',
    label: 'Blink check',
    cue: 'Blink twice, then relax.',
    durationSeconds: 8,
    detail: 'Create a short eye-artifact marker for replay review.',
  },
  {
    id: 'stillness',
    label: 'Stillness',
    cue: 'Relax and stay still.',
    durationSeconds: 15,
    detail: 'Final clean window for confidence and fit stability.',
  },
]
const visualizers: Record<VisualizerKind, { label: string; detail: string }> = {
  aurora: {
    label: 'Aurora Field',
    detail: 'Signal ribbons',
  },
  constellation: {
    label: 'Constellation Map',
    detail: 'Band nodes',
  },
  resonance: {
    label: 'Resonance Rings',
    detail: 'Rhythm arcs',
  },
  bloom: {
    label: 'Signal Bloom',
    detail: 'Band petals',
  },
  current: {
    label: 'Clarity Current',
    detail: 'Flow lanes',
  },
}
const defaultFeedbackAudioLoops: Record<FeedbackMode, LyriaAudioLoop> = {
  calm: 'calm-trend',
  focus: 'focus-tone',
  clarity: 'signal-clarity',
}
const feedbackExperiencePresets: FeedbackExperiencePreset[] = [
  {
    id: 'calm-room',
    label: 'Calm room',
    detail: 'Aurora with calm trend MP3',
    mode: 'calm',
    visualizer: 'aurora',
    audio: 'calm-trend',
  },
  {
    id: 'focus-tunnel',
    label: 'Focus tunnel',
    detail: 'Rings with focus tone MP3',
    mode: 'focus',
    visualizer: 'resonance',
    audio: 'focus-tone',
  },
  {
    id: 'clarity-field',
    label: 'Clarity field',
    detail: 'Current with clarity MP3',
    mode: 'clarity',
    visualizer: 'current',
    audio: 'signal-clarity',
  },
]
const feedbackModes: Record<
  FeedbackMode,
  {
    label: string
    shortLabel: string
    idleTitle: string
    idleDetail: string
    driverLabel: string
    hue: number
  }
> = {
  calm: {
    label: 'Calm trend',
    shortLabel: 'Calm',
    idleTitle: 'Calm signal paused',
    idleDetail: 'Capture a baseline or choose a saved replay before showing this trend.',
    driverLabel: 'Alpha lift',
    hue: 205,
  },
  focus: {
    label: 'Focus tone',
    shortLabel: 'Focus',
    idleTitle: 'Focus tone waiting',
    idleDetail: 'Start streaming or open a saved replay to estimate a relative focus tone.',
    driverLabel: 'Beta/theta balance',
    hue: 162,
  },
  clarity: {
    label: 'Signal clarity',
    shortLabel: 'Clarity',
    idleTitle: 'Clarity waiting',
    idleDetail: 'Start streaming or open a saved replay to show signal confidence.',
    driverLabel: 'Good-channel ratio',
    hue: 33,
  },
}
type HeadsetSensorPosition = {
  label: string
  x: number
  y: number
  region: string
  fitHint: string
}

const wiredHeadsetSensors: HeadsetSensorPosition[] = [
  {
    label: 'Fp1',
    x: 37,
    y: 18,
    region: 'front left',
    fitHint: 'Seat the front-left sensor below the hairline and keep the lead slack.',
  },
  {
    label: 'Fp2',
    x: 63,
    y: 18,
    region: 'front right',
    fitHint: 'Seat the front-right sensor below the hairline and keep the lead slack.',
  },
  {
    label: 'C3',
    x: 28,
    y: 48,
    region: 'left crown',
    fitHint: 'Part hair under the left crown contact and press the holder flat to the scalp.',
  },
  {
    label: 'C4',
    x: 72,
    y: 48,
    region: 'right crown',
    fitHint: 'Part hair under the right crown contact and press the holder flat to the scalp.',
  },
  {
    label: 'P7',
    x: 22,
    y: 68,
    region: 'left rear',
    fitHint: 'Check the left rear contact where hair density and cable tug can lift the sensor.',
  },
  {
    label: 'P8',
    x: 78,
    y: 68,
    region: 'right rear',
    fitHint: 'Check the right rear contact where hair density and cable tug can lift the sensor.',
  },
  {
    label: 'O1',
    x: 40,
    y: 83,
    region: 'back left',
    fitHint: 'Seat the back-left contact low on the rear scalp and route the wire without pull.',
  },
  {
    label: 'O2',
    x: 60,
    y: 83,
    region: 'back right',
    fitHint: 'Seat the back-right contact low on the rear scalp and route the wire without pull.',
  },
]

const headsetPositions = wiredHeadsetSensors.reduce<Record<string, { x: number; y: number }>>(
  (positions, sensor) => ({
    ...positions,
    [sensor.label]: { x: sensor.x, y: sensor.y },
  }),
  {},
)

const passiveHeadsetHolders = [
  { x: 50, y: 8 },
  { x: 29, y: 29 },
  { x: 71, y: 29 },
  { x: 16, y: 55 },
  { x: 84, y: 55 },
  { x: 29, y: 86 },
  { x: 71, y: 86 },
  { x: 50, y: 95 },
]

function formatBoardName(board?: BoardKind | null) {
  if (!board) return 'No board'
  if (board === 'cyton_daisy') return 'Cyton Daisy'
  if (board === 'cyton') return 'Cyton'
  return 'Synthetic'
}

function formatPort(port: SerialPortInfo) {
  const prefix = port.recommended ? 'Recommended' : port.transport.toUpperCase()
  return [prefix, port.device, port.manufacturer, port.description].filter(Boolean).join(' · ')
}

function buildPath(samples: number[], width: number, height: number, sampleLimit = 160) {
  if (samples.length < 2) return ''

  const trimmed = sampleLimit > 0 ? samples.slice(-sampleLimit) : samples
  const min = Math.min(...trimmed)
  const max = Math.max(...trimmed)
  const span = max - min || 1
  const xStep = width / (trimmed.length - 1)

  return trimmed
    .map((sample, index) => {
      const x = index * xStep
      const y = height - ((sample - min) / span) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function buildReplayChannels(preview: RecordingPreview | null): ChannelSnapshot[] {
  if (!preview) return []

  return preview.headers.slice(1).map((label, offset) => ({
    index: offset + 1,
    label,
    samples: preview.rows
      .map((row) => row[offset + 1])
      .filter((sample) => Number.isFinite(sample)),
  }))
}

function statusTone(status: BoardState['status']) {
  if (status === 'streaming') return 'status--streaming'
  if (status === 'prepared') return 'status--prepared'
  if (status === 'error') return 'status--error'
  return 'status--idle'
}

function aggregateBandPowers(dsp: { channels: DspChannelSummary[] } | null) {
  if (!dsp?.channels.length) return []

  return dspBandOrder.map((name) => {
    const values = dsp.channels
      .map((channel) => channel.band_powers.find((band) => band.name === name)?.relative_power ?? 0)
      .filter((value) => Number.isFinite(value))

    return {
      name,
      value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    }
  })
}

function qualityTone(status: string) {
  if (status === 'good') return 'quality--good'
  if (status === 'questionable') return 'quality--questionable'
  return 'quality--bad'
}

function formatIssues(issues: string[]) {
  if (!issues.length) return 'clear'
  return issues
    .slice(0, 2)
    .map((issue) => issue.replaceAll('_', ' '))
    .join(', ')
}

function formatSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

function formatMarkerTime(marker: RecordingCalibrationMarker, samplingRate?: number | null) {
  if (!samplingRate) return `sample ${marker.recording_sample_index}`
  return formatSeconds(marker.recording_sample_index / samplingRate)
}

function markerReplayOffset(
  marker: RecordingCalibrationMarker,
  windowSize: number,
  totalRows: number,
) {
  const leadingContext = Math.floor(windowSize * 0.2)
  const maxOffset = Math.max(0, totalRows - windowSize)
  return Math.min(Math.max(0, marker.recording_sample_index - leadingContext), maxOffset)
}

function replayMarkerInWindow(
  marker: RecordingCalibrationMarker,
  offset: number,
  rowCount: number,
) {
  return (
    rowCount > 0 &&
    marker.recording_sample_index >= offset &&
    marker.recording_sample_index < offset + rowCount
  )
}

function replayMarkerPositions(
  markers: RecordingCalibrationMarker[],
  offset: number,
  rowCount: number,
  width: number,
) {
  if (!rowCount) return []
  const windowStart = offset
  const denominator = Math.max(1, rowCount - 1)
  return markers
    .filter((marker) => replayMarkerInWindow(marker, offset, rowCount))
    .map((marker) => ({
      marker,
      x: Math.max(
        0,
        Math.min(width, ((marker.recording_sample_index - windowStart) / denominator) * width),
      ),
    }))
}

function headsetSensorQuality(
  label: string,
  index: number,
  channels: ChannelSnapshot[],
  qualityByLabel: Map<string, SignalQualityChannel>,
) {
  const fallbackChannel = channels[index]
  const fallbackQuality = fallbackChannel ? qualityByLabel.get(fallbackChannel.label) : undefined
  const hasCanonicalQuality = wiredHeadsetSensors.every((sensor) => qualityByLabel.has(sensor.label))
  return hasCanonicalQuality ? qualityByLabel.get(label) : fallbackQuality
}

function headsetSensorSeen(label: string, index: number, channels: ChannelSnapshot[]) {
  const hasCanonicalChannels = wiredHeadsetSensors.every((sensor) =>
    channels.some((channel) => channel.label === sensor.label),
  )
  return hasCanonicalChannels ? channels.some((channel) => channel.label === label) : Boolean(channels[index])
}

function setupStepTone(done: boolean, active: boolean) {
  if (done) return 'quality--good'
  if (active) return 'quality--questionable'
  return 'quality--unknown'
}

function countQualityChannels(channels: SignalQualityChannel[]) {
  return channels.reduce(
    (counts, channel) => ({
      ...counts,
      [channel.status]: counts[channel.status] + 1,
    }),
    { good: 0, questionable: 0, bad: 0 },
  )
}

function wearerReadiness(channels: SignalQualityChannel[]) {
  if (!channels.length) {
    return {
      title: 'Waiting for quality window',
      detail: 'Start streaming and let the headset settle for a few seconds.',
      tone: 'quality--questionable',
    }
  }

  const counts = countQualityChannels(channels)

  if (counts.bad > 0) {
    return {
      title: `${counts.bad} visible electrode${counts.bad === 1 ? '' : 's'} need attention`,
      detail: 'Refit marked channels before recording a baseline.',
      tone: 'quality--bad',
    }
  }

  if (counts.questionable > 0) {
    return {
      title: `${counts.questionable} visible channel${counts.questionable === 1 ? '' : 's'} to check`,
      detail: 'Signals are usable for setup, but improve contact if possible.',
      tone: 'quality--questionable',
    }
  }

  return {
    title: 'Visible channels pass quality checks',
    detail: 'Shown channels are within current quality thresholds.',
    tone: 'quality--good',
  }
}

function replayReadiness(replay: RecordingPreview) {
  const start = replay.total_rows && replay.row_count ? replay.offset + 1 : 0
  const end = replay.offset + replay.row_count

  return {
    title: 'Replay window loaded',
    detail: `${start}-${end} of ${replay.total_rows || replay.recording.sample_count} saved samples`,
    tone: 'quality--good',
  }
}

function calmReadiness(calm: CalmFeatureResponse | null, channels: SignalQualityChannel[]) {
  if (!calm) {
    return {
      title: 'Calm signal not sampled yet',
      detail: 'Start the stream and let the baseline controls update.',
      tone: 'quality--questionable',
    }
  }

  if (calm.flags.includes('saved_replay')) {
    if (calm.signal_state !== 'usable' || calm.calm_score === null || calm.calm_score === undefined) {
      return {
        title: 'Replay window paused',
        detail: calm.flags.includes('short_window')
          ? 'Select a longer saved window before using this demo state.'
          : 'The selected saved window is not usable for the demo state.',
        tone: 'quality--questionable',
      }
    }

    return {
      title: 'Saved replay mirror',
      detail: 'The demo is driven by the selected saved spectral window.',
      tone: 'quality--good',
    }
  }

  if (calm.signal_state === 'usable' && calm.calm_score !== null && calm.calm_score !== undefined) {
    return {
      title: 'Settling signal is live',
      detail: 'The mirror is showing a relative calm attention trend.',
      tone: 'quality--good',
    }
  }

  if (calm.flags.includes('baseline_required')) {
    return {
      title: 'Baseline needed',
      detail: 'Capture a personal baseline before showing a calm trend.',
      tone: 'quality--questionable',
    }
  }

  if (calm.flags.includes('baseline_mismatch')) {
    return {
      title: 'Baseline settings changed',
      detail: 'Reset and capture a new baseline for these calm settings.',
      tone: 'quality--questionable',
    }
  }

  if (calm.signal_state === 'noisy') {
    return {
      title: 'Signal paused',
      detail: 'Interpretation is paused while posterior channels or noise need attention.',
      tone: 'quality--bad',
    }
  }

  return wearerReadiness(channels)
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--'
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function formatFeature(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '--'
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function bandRelativePower(channel: DspChannelSummary, bandName: string) {
  return channel.band_powers.find((band) => band.name === bandName)?.relative_power ?? 0
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageBandPower(channels: DspChannelSummary[], bandName: string) {
  return average(channels.map((channel) => bandRelativePower(channel, bandName)))
}

function buildStateFeatures(
  pairs: Array<[string, number | undefined | null]>,
): Array<{ label: string; value: string }> {
  return pairs.map(([label, value]) => ({
    label,
    value: typeof value === 'number' && Number.isFinite(value) ? formatFeature(value) : '--',
  }))
}

function feedbackSampleWindow(
  dspSummary: DspSummary | RecordingSpectralAnalysis,
  requestedWindowSize?: number,
) {
  return 'window_size' in dspSummary
    ? dspSummary.window_size
    : requestedWindowSize ?? dspSummary.sample_count
}

function buildReplayCalmState(
  replay: RecordingPreview | null,
  analysis: RecordingSpectralAnalysis | null,
): CalmFeatureResponse | null {
  if (!replay || !analysis?.channels.length) return null

  const channels = analysis.channels
  const alpha = average(channels.map((channel) => bandRelativePower(channel, 'alpha')))
  const beta = average(channels.map((channel) => bandRelativePower(channel, 'beta')))
  const gamma = average(channels.map((channel) => bandRelativePower(channel, 'gamma')))
  const windowSize = replay.row_count || analysis.sample_count
  const sampleConfidence = clampUnit(analysis.sample_count / Math.max(1, windowSize))
  const channelConfidence = clampUnit(channels.length / 4)
  const confidence = clampUnit(sampleConfidence * channelConfidence)
  const usable = analysis.sample_count >= 64 && confidence > 0
  const calmScore = usable ? clampUnit(0.5 + alpha - beta * 0.75 - gamma * 0.5) : null

  return {
    status: 'prepared',
    board: replay.recording.board,
    board_id: replay.recording.board_id,
    sample_count: analysis.sample_count,
    sampling_rate: analysis.sampling_rate,
    window_size: windowSize,
    line_frequency_hz: analysis.notch_frequency_hz ?? DEFAULT_LINE_FREQUENCY_HZ,
    posterior_labels: replay.recording.eeg_names.slice(-4),
    used_labels: channels.map((channel) => channel.label),
    signal_state: usable ? 'usable' : 'unavailable',
    confidence,
    calm_score: calmScore,
    trend: calmScore,
    flags: usable ? ['saved_replay'] : ['saved_replay', 'short_window'],
    features: {
      alpha_post: alpha,
      beta,
      gamma,
      line_noise: 0,
    },
    baseline: {
      ...emptyCalmBaseline,
      status: 'complete',
      label: 'Saved replay window',
      elapsed_seconds: analysis.sampling_rate
        ? analysis.sample_count / analysis.sampling_rate
        : 0,
      target_duration_seconds: analysis.sampling_rate
        ? analysis.sample_count / analysis.sampling_rate
        : 0,
      accepted_windows: usable ? 1 : 0,
      required_windows: 1,
      window_size: windowSize,
      posterior_labels: replay.recording.eeg_names.slice(-4),
    },
    message: 'Derived from saved recording spectral replay.',
  }
}

function buildReplayCalmTrend(analysis: RecordingSpectralAnalysis | null) {
  if (!analysis?.channels.length) return []
  const values = analysis.channels.map((channel) =>
    clampUnit(
      0.5 +
        bandRelativePower(channel, 'alpha') -
        bandRelativePower(channel, 'beta') * 0.75 -
        bandRelativePower(channel, 'gamma') * 0.5,
    ),
  )
  return values.length === 1 ? [values[0], values[0]] : values
}

function buildTrendPath(values: number[], width: number, height: number) {
  if (values.length < 2) return ''
  const xStep = width / (values.length - 1)

  return values
    .map((value, index) => {
      const x = index * xStep
      const y = height - Math.max(0, Math.min(1, value)) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

type VisualizerMotion = {
  time: number
  score: number
  confidence: number
  bands: number[]
}

const motionSmoothingTau = 0.9
const motionCommitIntervalMs = 1000 / 30
const pausedMotionTimeScale = 0.35

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return reduced
}

function useVisualizerMotion(
  feedback: FeedbackState,
  bands: Array<{ name: string; value: number }>,
  active: boolean,
): VisualizerMotion {
  const reducedMotion = usePrefersReducedMotion()
  const targets = useMemo<Omit<VisualizerMotion, 'time'>>(
    () => ({
      score: clampUnit(feedback.score ?? 0.5),
      confidence: clampUnit(feedback.confidence),
      bands: dspBandOrder.map((name) =>
        clampUnit(bands.find((band) => band.name === name)?.value ?? 0),
      ),
    }),
    [feedback, bands],
  )
  const targetRef = useRef(targets)
  const activeRef = useRef(active)
  const [motion, setMotion] = useState<VisualizerMotion>({ time: 0, ...targets })

  useEffect(() => {
    targetRef.current = targets
  }, [targets])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    if (reducedMotion) return

    const displayed = { ...targetRef.current }
    let time = 0
    let lastFrameAt = performance.now()
    let lastCommitAt = 0
    let frame = 0

    const step = (now: number) => {
      const dt = Math.min(0.25, Math.max(0, (now - lastFrameAt) / 1000))
      lastFrameAt = now
      time += dt * (activeRef.current ? 1 : pausedMotionTimeScale)

      const target = targetRef.current
      const blend = 1 - Math.exp(-dt / motionSmoothingTau)
      displayed.score += (target.score - displayed.score) * blend
      displayed.confidence += (target.confidence - displayed.confidence) * blend
      displayed.bands = displayed.bands.map(
        (value, index) => value + ((target.bands[index] ?? 0) - value) * blend,
      )

      if (now - lastCommitAt >= motionCommitIntervalMs) {
        lastCommitAt = now
        setMotion({
          time,
          score: displayed.score,
          confidence: displayed.confidence,
          bands: [...displayed.bands],
        })
      }
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [reducedMotion])

  if (reducedMotion) {
    return { time: 0, ...targets }
  }

  return motion
}

function auroraRibbonPath({
  index,
  value,
  score,
  confidence,
  time,
  width,
  height,
}: {
  index: number
  value: number
  score: number
  confidence: number
  time: number
  width: number
  height: number
}) {
  const baseY = height * (0.72 - index * 0.1)
  const amplitude = 10 + value * 46 + score * 16 + Math.sin(time * 0.7 + index) * 4
  const phase = index * 0.82 + score * 1.4 + time * (0.5 + index * 0.06)
  const points = Array.from({ length: 12 }, (_, pointIndex) => {
    const x = (width / 11) * pointIndex
    const wave = Math.sin(pointIndex * 0.9 + phase) * amplitude
    const lift = Math.cos(pointIndex * 0.48 + index + time * 0.32) * confidence * 10
    const y = baseY - wave - lift
    return `${pointIndex === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  })

  return points.join(' ')
}

function AuroraField({
  feedback,
  motion,
  trend,
  active,
}: {
  feedback: FeedbackState
  motion: VisualizerMotion
  trend: number[]
  active: boolean
}) {
  const { time, score, confidence } = motion
  const width = 560
  const height = 330
  const bandValues = dspBandOrder.map((name, index) => ({
    name,
    value: motion.bands[index] ?? 0,
  }))
  const particleCount = active ? 18 : 10
  const trendPath = buildTrendPath(trend, 470, 44)

  return (
    <figure className="aurora-visualizer" aria-label="Aurora Field feedback visualizer">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Aurora Field signal ribbons">
        <defs>
          <linearGradient id="auroraBackdrop" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor={`hsl(${feedback.hue + 8} 80% 18%)`} />
            <stop offset="54%" stopColor={`hsl(${feedback.hue + 28} 72% 28%)`} />
            <stop offset="100%" stopColor="hsl(218 38% 12%)" />
          </linearGradient>
          <radialGradient id="auroraCore" cx="50%" cy="44%" r="42%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.92)" />
            <stop offset="48%" stopColor={`hsl(${feedback.hue + 22} 82% 58% / 0.42)`} />
            <stop offset="100%" stopColor={`hsl(${feedback.hue} 78% 35% / 0)`} />
          </radialGradient>
          <filter id="auroraGlow">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="aurora-visualizer__backdrop" width={width} height={height} rx="18" />
        <circle
          className="aurora-visualizer__core"
          cx={width / 2}
          cy={height * 0.45}
          r={58 + score * 50}
          opacity={active ? 0.72 : 0.38}
        />
        <g className="aurora-visualizer__ribbons" filter="url(#auroraGlow)">
          {bandValues.map((band, index) => (
            <path
              d={auroraRibbonPath({
                index,
                value: band.value,
                score,
                confidence,
                time,
                width,
                height,
              })}
              key={band.name}
              style={{
                stroke: `hsl(${feedback.hue + index * 18} 82% ${58 + index * 4}%)`,
                opacity: active ? 0.38 + band.value * 0.52 : 0.16,
                strokeWidth: 10 - index * 0.85,
              }}
            />
          ))}
        </g>
        <g className="aurora-visualizer__particles">
          {Array.from({ length: particleCount }, (_, index) => {
            const band = bandValues[index % bandValues.length]
            const drift = time * (5 + (index % 5) * 2.2)
            const x = 42 + ((index * 53 + score * 70 + drift) % 476)
            const y =
              46 + ((index * 37 + confidence * 90) % 206) + Math.sin(time * 0.6 + index) * 7
            const radius = 2.2 + band.value * 8
            return (
              <circle
                cx={x}
                cy={y}
                key={`${band.name}-${index}`}
                r={radius.toFixed(2)}
                style={{
                  fill: `hsl(${feedback.hue + index * 11} 90% 72%)`,
                  opacity: active ? 0.36 + confidence * 0.42 : 0.18,
                }}
              />
            )
          })}
        </g>
        <path className="aurora-visualizer__horizon" d="M 38 256 C 146 238 210 282 316 259 C 400 240 456 252 522 236" />
        <g className="aurora-visualizer__trend" transform="translate(45 274)">
          <path d="M 0 22 L 470 22" />
          <path d={trendPath} />
        </g>
      </svg>
      <figcaption>
        <span>{visualizers.aurora.label}</span>
        <strong>{active ? formatPercent(feedback.score) : 'Paused'}</strong>
      </figcaption>
    </figure>
  )
}

function ConstellationMap({
  feedback,
  motion,
  active,
}: {
  feedback: FeedbackState
  motion: VisualizerMotion
  active: boolean
}) {
  const { time, score, confidence } = motion
  const width = 560
  const height = 330
  const centerX = width / 2
  const centerY = height / 2
  const radius = 102 + score * 24
  const orbitPhase = time * 0.08
  const bandValues = dspBandOrder.map((name, index) => {
    const angle = -Math.PI / 2 + (index / dspBandOrder.length) * Math.PI * 2 + orbitPhase
    const value = motion.bands[index] ?? 0
    const wobble = Math.sin(time * 0.7 + index * 1.6) * 5
    return {
      angle,
      index,
      name,
      value,
      x: centerX + Math.cos(angle) * (radius + wobble),
      y: centerY + Math.sin(angle) * (radius + wobble),
    }
  })
  const links = bandValues.flatMap((source, index) =>
    bandValues.slice(index + 1).map((target) => ({
      key: `${source.name}-${target.name}`,
      source,
      target,
      strength: clampUnit((source.value + target.value) * 0.5 + confidence * 0.25),
    })),
  )

  return (
    <figure className="constellation-visualizer" aria-label="Constellation Map feedback visualizer">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Constellation Map band nodes">
        <defs>
          <radialGradient id="constellationBackdrop" cx="50%" cy="50%" r="68%">
            <stop offset="0%" stopColor={`hsl(${feedback.hue + 18} 70% 22%)`} />
            <stop offset="62%" stopColor={`hsl(${feedback.hue + 34} 52% 15%)`} />
            <stop offset="100%" stopColor="hsl(220 38% 10%)" />
          </radialGradient>
          <filter id="constellationGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="constellation-visualizer__backdrop" width={width} height={height} rx="18" />
        <circle
          className="constellation-visualizer__orbit"
          cx={centerX}
          cy={centerY}
          r={radius}
        />
        <circle
          className="constellation-visualizer__pulse"
          cx={centerX}
          cy={centerY}
          r={44 + score * 38 + Math.sin(time * 0.9) * 6}
          style={{ opacity: active ? 0.32 + confidence * 0.34 : 0.18 }}
        />
        <g className="constellation-visualizer__links" filter="url(#constellationGlow)">
          {links.map((link) => (
            <line
              key={link.key}
              x1={link.source.x}
              x2={link.target.x}
              y1={link.source.y}
              y2={link.target.y}
              style={{
                opacity: active ? link.strength * 0.42 : 0.08,
                stroke: `hsl(${feedback.hue + link.source.index * 16} 78% 68%)`,
                strokeWidth: 1 + link.strength * 3,
              }}
            />
          ))}
        </g>
        <g className="constellation-visualizer__nodes">
          {bandValues.map((band) => (
            <g key={band.name} transform={`translate(${band.x.toFixed(2)} ${band.y.toFixed(2)})`}>
              <circle
                r={(11 + band.value * 28).toFixed(2)}
                style={{
                  fill: `hsl(${feedback.hue + band.index * 19} 82% 58%)`,
                  opacity: active ? 0.52 + band.value * 0.42 : 0.24,
                }}
              />
              <circle r="4.2" />
              <text y={34 + band.value * 10}>{band.name}</text>
            </g>
          ))}
        </g>
        <g className="constellation-visualizer__center">
          <text x={centerX} y={centerY - 8}>
            {active ? formatPercent(feedback.score) : 'Paused'}
          </text>
          <text x={centerX} y={centerY + 18}>
            {feedbackModes[feedback.mode].shortLabel}
          </text>
        </g>
      </svg>
      <figcaption>
        <span>{visualizers.constellation.label}</span>
        <strong>{active ? formatPercent(feedback.confidence) : 'Paused'}</strong>
      </figcaption>
    </figure>
  )
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = {
    x: cx + radius * Math.cos(startAngle),
    y: cy + radius * Math.sin(startAngle),
  }
  const end = {
    x: cx + radius * Math.cos(endAngle),
    y: cy + radius * Math.sin(endAngle),
  }
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

  return [
    'M',
    start.x.toFixed(2),
    start.y.toFixed(2),
    'A',
    radius.toFixed(2),
    radius.toFixed(2),
    '0',
    String(largeArc),
    '1',
    end.x.toFixed(2),
    end.y.toFixed(2),
  ].join(' ')
}

function ResonanceRings({
  feedback,
  motion,
  trend,
  active,
}: {
  feedback: FeedbackState
  motion: VisualizerMotion
  trend: number[]
  active: boolean
}) {
  const { time, score, confidence } = motion
  const width = 560
  const height = 330
  const centerX = width / 2
  const centerY = 158
  const bandValues = dspBandOrder.map((name, index) => ({
    name,
    index,
    value: motion.bands[index] ?? 0,
  }))
  const trendValues = trend.length ? trend.slice(-16) : [score, score]

  return (
    <figure className="resonance-visualizer" aria-label="Resonance Rings feedback visualizer">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Resonance Rings rhythm arcs">
        <defs>
          <linearGradient id="resonanceBackdrop" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(220 42% 12%)" />
            <stop offset="50%" stopColor={`hsl(${feedback.hue + 10} 58% 19%)`} />
            <stop offset="100%" stopColor="hsl(188 42% 12%)" />
          </linearGradient>
          <filter id="resonanceGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="resonance-visualizer__backdrop" width={width} height={height} rx="18" />
        <g className="resonance-visualizer__grid">
          {Array.from({ length: 7 }, (_, index) => (
            <line
              key={index}
              x1="46"
              x2="514"
              y1={58 + index * 32}
              y2={58 + index * 32}
            />
          ))}
        </g>
        <g className="resonance-visualizer__rings" filter="url(#resonanceGlow)">
          {bandValues.map((band) => {
            const radius = 42 + band.index * 24
            const sweep = Math.min(Math.PI * 1.86, Math.PI * (0.7 + band.value * 1.25 + score * 0.18))
            const spin = time * (band.index % 2 === 0 ? 0.14 : -0.11) * (1 + band.index * 0.18)
            const start = -Math.PI / 2 - sweep / 2 + band.index * 0.08 + spin
            const end = start + sweep
            return (
              <path
                d={describeArc(centerX, centerY, radius, start, end)}
                key={band.name}
                style={{
                  opacity: active ? 0.34 + band.value * 0.58 : 0.12,
                  stroke: `hsl(${feedback.hue + band.index * 18} 84% ${58 + band.index * 4}%)`,
                  strokeWidth: 8 - band.index * 0.7,
                }}
              />
            )
          })}
        </g>
        <circle
          className="resonance-visualizer__center"
          cx={centerX}
          cy={centerY}
          r={30 + score * 28 + Math.sin(time * 1.1) * 4}
          style={{ opacity: active ? 0.36 + confidence * 0.44 : 0.2 }}
        />
        <g className="resonance-visualizer__beats">
          {trendValues.map((value, index) => {
            const x = 60 + index * (440 / Math.max(1, trendValues.length - 1))
            const y = 286 - clampUnit(value) * 42
            return (
              <circle
                cx={x}
                cy={y}
                key={`${value}-${index}`}
                r={(2.4 + clampUnit(value) * 5).toFixed(2)}
                style={{
                  opacity: active ? 0.34 + confidence * 0.36 : 0.16,
                }}
              />
            )
          })}
        </g>
        <g className="resonance-visualizer__labels">
          {bandValues.map((band) => (
            <text
              key={band.name}
              x={72 + band.index * 104}
              y="42"
            >
              {band.name}
            </text>
          ))}
        </g>
        <g className="resonance-visualizer__readout">
          <text x={centerX} y={centerY - 7}>
            {active ? formatPercent(feedback.score) : 'Paused'}
          </text>
          <text x={centerX} y={centerY + 19}>
            {feedbackModes[feedback.mode].shortLabel}
          </text>
        </g>
      </svg>
      <figcaption>
        <span>{visualizers.resonance.label}</span>
        <strong>{active ? formatPercent(feedback.confidence) : 'Paused'}</strong>
      </figcaption>
    </figure>
  )
}

function SignalBloom({
  feedback,
  motion,
  trend,
  active,
}: {
  feedback: FeedbackState
  motion: VisualizerMotion
  trend: number[]
  active: boolean
}) {
  const { time, score, confidence } = motion
  const width = 560
  const height = 330
  const centerX = width / 2
  const centerY = 158
  const bandValues = dspBandOrder.map((name, index) => ({
    name,
    index,
    value: motion.bands[index] ?? 0,
  }))
  const bloomPhase = time * 0.05
  const petals = bandValues.flatMap((band) =>
    Array.from({ length: 3 }, (_, petalIndex) => {
      const angle =
        -Math.PI / 2 + ((band.index * 3 + petalIndex) / 15) * Math.PI * 2 + bloomPhase
      const sway = 1 + Math.sin(time * 0.8 + band.index + petalIndex * 0.7) * 0.06
      const distance = 42 + band.index * 13 + petalIndex * 10
      return {
        angle,
        band,
        key: `${band.name}-${petalIndex}`,
        length: (46 + band.value * 82 + score * 18) * sway,
        width: 18 + band.value * 24 + confidence * 10,
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
      }
    }),
  )
  const trendValues = trend.length ? trend.slice(-10) : [score]

  return (
    <figure className="bloom-visualizer" aria-label="Signal Bloom feedback visualizer">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Signal Bloom band petals">
        <defs>
          <radialGradient id="bloomBackdrop" cx="50%" cy="48%" r="72%">
            <stop offset="0%" stopColor={`hsl(${feedback.hue + 42} 64% 22%)`} />
            <stop offset="58%" stopColor={`hsl(${feedback.hue - 18} 48% 15%)`} />
            <stop offset="100%" stopColor="hsl(226 34% 10%)" />
          </radialGradient>
          <filter id="bloomGlow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="bloom-visualizer__backdrop" width={width} height={height} rx="18" />
        <g className="bloom-visualizer__rings">
          {[74, 116, 158].map((radius) => (
            <circle key={radius} cx={centerX} cy={centerY} r={radius} />
          ))}
        </g>
        <g className="bloom-visualizer__petals" filter="url(#bloomGlow)">
          {petals.map((petal) => (
            <ellipse
              cx={petal.x.toFixed(2)}
              cy={petal.y.toFixed(2)}
              key={petal.key}
              rx={(petal.width / 2).toFixed(2)}
              ry={(petal.length / 2).toFixed(2)}
              style={{
                opacity: active ? 0.18 + petal.band.value * 0.42 + confidence * 0.18 : 0.08,
                transform: `rotate(${(petal.angle * 180) / Math.PI + 90}deg)`,
                transformBox: 'fill-box',
                transformOrigin: 'center',
                fill: `hsl(${feedback.hue + petal.band.index * 22} 78% ${56 + petal.band.index * 3}%)`,
              }}
            />
          ))}
        </g>
        <g className="bloom-visualizer__trend">
          {trendValues.map((value, index) => {
            const radius = 5 + clampUnit(value) * 12
            return (
              <circle
                cx={94 + index * (372 / Math.max(1, trendValues.length - 1))}
                cy={286}
                key={`${value}-${index}`}
                r={radius.toFixed(2)}
                style={{ opacity: active ? 0.22 + confidence * 0.36 : 0.12 }}
              />
            )
          })}
        </g>
        <circle
          className="bloom-visualizer__center"
          cx={centerX}
          cy={centerY}
          r={36 + score * 26 + Math.sin(time * 0.9) * 3}
          style={{ opacity: active ? 0.3 + confidence * 0.42 : 0.18 }}
        />
        <g className="bloom-visualizer__labels">
          {bandValues.map((band) => (
            <text key={band.name} x={92 + band.index * 94} y="42">
              {band.name}
            </text>
          ))}
        </g>
        <g className="bloom-visualizer__readout">
          <text x={centerX} y={centerY - 7}>
            {active ? formatPercent(feedback.score) : 'Paused'}
          </text>
          <text x={centerX} y={centerY + 19}>
            {feedbackModes[feedback.mode].shortLabel}
          </text>
        </g>
      </svg>
      <figcaption>
        <span>{visualizers.bloom.label}</span>
        <strong>{active ? formatPercent(feedback.confidence) : 'Paused'}</strong>
      </figcaption>
    </figure>
  )
}

function currentLanePath({
  index,
  value,
  score,
  confidence,
  time,
  width,
}: {
  index: number
  value: number
  score: number
  confidence: number
  time: number
  width: number
}) {
  const baseY = 72 + index * 45
  const amplitude = 5 + value * 28 + score * 8
  const phase = index * 0.72 + confidence * 1.3 - time * (0.9 + index * 0.14)
  return Array.from({ length: 14 }, (_, pointIndex) => {
    const x = 42 + (pointIndex / 13) * (width - 84)
    const wave = Math.sin(pointIndex * 0.86 + phase) * amplitude
    const drift = Math.cos(pointIndex * 0.42 + index + time * 0.35) * confidence * 6
    return `${pointIndex === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${(baseY + wave + drift).toFixed(2)}`
  }).join(' ')
}

function ClarityCurrent({
  feedback,
  motion,
  trend,
  active,
}: {
  feedback: FeedbackState
  motion: VisualizerMotion
  trend: number[]
  active: boolean
}) {
  const { time, score, confidence } = motion
  const width = 560
  const height = 330
  const bandValues = dspBandOrder.map((name, index) => ({
    name,
    index,
    value: motion.bands[index] ?? 0,
  }))
  const trendValues = trend.length ? trend.slice(-12) : [score, score]

  return (
    <figure className="current-visualizer" aria-label="Clarity Current feedback visualizer">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Clarity Current flow lanes">
        <defs>
          <linearGradient id="currentBackdrop" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(228 36% 10%)" />
            <stop offset="46%" stopColor={`hsl(${feedback.hue - 32} 52% 16%)`} />
            <stop offset="100%" stopColor={`hsl(${feedback.hue + 56} 46% 13%)`} />
          </linearGradient>
          <filter id="currentGlow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="current-visualizer__backdrop" width={width} height={height} rx="18" />
        <g className="current-visualizer__gates">
          {trendValues.map((value, index) => {
            const x = 58 + index * (444 / Math.max(1, trendValues.length - 1))
            const heightScale = 24 + clampUnit(value) * 90
            return (
              <rect
                height={heightScale.toFixed(2)}
                key={`${value}-${index}`}
                rx="5"
                style={{
                  opacity: active ? 0.12 + confidence * 0.24 : 0.08,
                }}
                width="10"
                x={x.toFixed(2)}
                y={(263 - heightScale).toFixed(2)}
              />
            )
          })}
        </g>
        <g className="current-visualizer__lanes" filter="url(#currentGlow)">
          {bandValues.map((band) => (
            <path
              d={currentLanePath({
                index: band.index,
                value: band.value,
                score,
                confidence,
                time,
                width,
              })}
              key={band.name}
              style={{
                opacity: active ? 0.34 + band.value * 0.44 : 0.12,
                stroke: `hsl(${feedback.hue + band.index * 17} 82% ${62 + band.index * 3}%)`,
                strokeWidth: 3.4 + band.value * 6,
              }}
            />
          ))}
        </g>
        <g className="current-visualizer__labels">
          {bandValues.map((band) => (
            <text key={band.name} x="40" y={76 + band.index * 45}>
              {band.name}
            </text>
          ))}
        </g>
        <g className="current-visualizer__readout">
          <circle
            cx="456"
            cy="70"
            r={31 + score * 16}
            style={{ opacity: active ? 0.25 + confidence * 0.42 : 0.16 }}
          />
          <text x="456" y="66">
            {active ? formatPercent(feedback.score) : 'Paused'}
          </text>
          <text x="456" y="91">
            {feedbackModes[feedback.mode].shortLabel}
          </text>
        </g>
      </svg>
      <figcaption>
        <span>{visualizers.current.label}</span>
        <strong>{active ? formatPercent(feedback.confidence) : 'Paused'}</strong>
      </figcaption>
    </figure>
  )
}

function FeedbackVisualizer({
  kind,
  feedback,
  bands,
  trend,
  active,
}: {
  kind: VisualizerKind
  feedback: FeedbackState
  bands: Array<{ name: string; value: number }>
  trend: number[]
  active: boolean
}) {
  const motion = useVisualizerMotion(feedback, bands, active)

  if (kind === 'aurora') {
    return <AuroraField feedback={feedback} motion={motion} trend={trend} active={active} />
  }

  if (kind === 'constellation') {
    return <ConstellationMap feedback={feedback} motion={motion} active={active} />
  }

  if (kind === 'resonance') {
    return <ResonanceRings feedback={feedback} motion={motion} trend={trend} active={active} />
  }

  if (kind === 'bloom') {
    return <SignalBloom feedback={feedback} motion={motion} trend={trend} active={active} />
  }

  if (kind === 'current') {
    return <ClarityCurrent feedback={feedback} motion={motion} trend={trend} active={active} />
  }

  return null
}

function buildCalmFeedback(calm: CalmFeatureResponse | null): FeedbackState {
  const config = feedbackModes.calm
  const score = calm?.calm_score
  const hasScore = typeof score === 'number'
  const active = hasScore && calm?.signal_state === 'usable'

  return {
    mode: 'calm',
    label: config.label,
    score,
    confidence: clampUnit(calm?.confidence ?? 0),
    signalState: calm?.signal_state ?? 'unavailable',
    title: active ? 'Settling signal is live' : config.idleTitle,
    detail: active
      ? 'The mirror is showing a relative calm attention trend.'
      : calm?.flags.includes('baseline_required')
        ? 'Capture a personal baseline before showing a calm trend.'
        : calm?.signal_state === 'noisy'
          ? 'Interpretation is paused while posterior channels or noise need attention.'
          : config.idleDetail,
    driverLabel: config.driverLabel,
    driverValue: formatFeature(calm?.features.alpha_post),
    flags: calm?.flags ?? [],
    hue: config.hue,
    features: buildStateFeatures([
      ['Alpha post', calm?.features.alpha_post],
      ['Beta', calm?.features.beta],
      ['Line noise', calm?.features.line_noise],
    ]),
  }
}

function buildFocusFeedback(
  dspSummary: DspSummary | RecordingSpectralAnalysis | null,
  quality: SignalQuality | null,
  requestedWindowSize?: number,
): FeedbackState {
  const config = feedbackModes.focus
  const channels = dspSummary?.channels ?? []
  const alpha = averageBandPower(channels, 'alpha')
  const beta = averageBandPower(channels, 'beta')
  const theta = averageBandPower(channels, 'theta')
  const delta = averageBandPower(channels, 'delta')
  const gamma = averageBandPower(channels, 'gamma')
  const bandBalance = beta * 0.72 + alpha * 0.18 - theta * 0.58 - delta * 0.28 - gamma * 0.18
  const score = channels.length ? clampUnit(0.5 + bandBalance) : null
  const sampleConfidence = dspSummary
    ? clampUnit(
        dspSummary.sample_count /
          Math.max(1, feedbackSampleWindow(dspSummary, requestedWindowSize)),
      )
    : 0
  const channelConfidence = clampUnit(channels.length / 4)
  const qualityPenalty = quality?.bad_channels ? 0.42 : quality?.questionable_channels ? 0.78 : 1
  const confidence = clampUnit(sampleConfidence * channelConfidence * qualityPenalty)
  const enoughSamples = (dspSummary?.sample_count ?? 0) >= feedbackMinimumSamples
  const usable = typeof score === 'number' && enoughSamples && confidence >= 0.35

  return {
    mode: 'focus',
    label: config.label,
    score,
    confidence,
    signalState: usable ? 'usable' : confidence > 0 ? 'noisy' : 'unavailable',
    title: usable ? 'Focus tone is live' : config.idleTitle,
    detail: usable
      ? 'This is a relative band-balance cue, not an attention measurement.'
      : config.idleDetail,
    driverLabel: config.driverLabel,
    driverValue: formatFeature(beta - theta),
    flags: usable ? [] : ['confidence_gate'],
    hue: config.hue,
    features: buildStateFeatures([
      ['Beta', beta],
      ['Theta', theta],
      ['Alpha', alpha],
    ]),
  }
}

function buildClarityFeedback(
  dspSummary: DspSummary | RecordingSpectralAnalysis | null,
  quality: SignalQuality | null,
  requestedWindowSize?: number,
): FeedbackState {
  const config = feedbackModes.clarity
  const channelTotal = quality?.channels.length ?? dspSummary?.channels.length ?? 0
  const goodRatio = quality?.channels.length
    ? quality.good_channels / quality.channels.length
    : clampUnit((dspSummary?.channels.length ?? 0) / 4)
  const questionableRatio = quality?.channels.length
    ? quality.questionable_channels / quality.channels.length
    : 0
  const badRatio = quality?.channels.length ? quality.bad_channels / quality.channels.length : 0
  const sampleConfidence = dspSummary
    ? clampUnit(
        dspSummary.sample_count /
          Math.max(1, feedbackSampleWindow(dspSummary, requestedWindowSize)),
      )
    : 0
  const score = channelTotal ? clampUnit(goodRatio * 0.78 + sampleConfidence * 0.22 - badRatio * 0.35) : null
  const channelConfidence = channelTotal
    ? clampUnit(goodRatio + questionableRatio * 0.45 - badRatio * 0.8)
    : 0
  const confidence = clampUnit(sampleConfidence * channelConfidence)
  const enoughSamples = (dspSummary?.sample_count ?? 0) >= feedbackMinimumSamples
  const usable = typeof score === 'number' && enoughSamples && confidence >= 0.35

  return {
    mode: 'clarity',
    label: config.label,
    score,
    confidence,
    signalState: usable ? 'usable' : confidence > 0 ? 'noisy' : 'unavailable',
    title: usable ? 'Signal clarity is live' : config.idleTitle,
    detail: usable
      ? 'This state rewards stable, usable signal before interpreting any demo trend.'
      : config.idleDetail,
    driverLabel: config.driverLabel,
    driverValue: channelTotal ? formatPercent(goodRatio) : '--',
    flags: usable ? [] : ['quality_gate'],
    hue: config.hue,
    features: [
      { label: 'Good', value: channelTotal ? String(quality?.good_channels ?? dspSummary?.channels.length ?? 0) : '--' },
      { label: 'Check', value: channelTotal ? String(quality?.questionable_channels ?? 0) : '--' },
      { label: 'Bad', value: channelTotal ? String(quality?.bad_channels ?? 0) : '--' },
    ],
  }
}

type OscillatorAudioNodes = {
  kind: 'oscillator'
  context: AudioContext
  masterGain: GainNode
  oscillatorA: OscillatorNode
  oscillatorB: OscillatorNode
  oscillatorGainA: GainNode
  oscillatorGainB: GainNode
  filter: BiquadFilterNode
}

type LyriaAudioNodes = {
  kind: 'lyria-loop'
  audio: HTMLAudioElement
  src: string
}

type CalmAudioNodes = OscillatorAudioNodes | LyriaAudioNodes

type WebkitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

function getAudioContextConstructor() {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext ?? null
}

function isLyriaAudioVoice(voice: FeedbackAudioVoice): voice is LyriaAudioLoop {
  return voice in lyriaAudioLoops
}

function stopCalmAudio(nodes: CalmAudioNodes) {
  if (nodes.kind === 'lyria-loop') {
    nodes.audio.pause()
    nodes.audio.currentTime = 0
    nodes.audio.src = ''
    return
  }

  const stopAt = nodes.context.currentTime + 0.08
  nodes.masterGain.gain.setTargetAtTime(0, nodes.context.currentTime, 0.04)
  try {
    nodes.oscillatorA.stop(stopAt)
    nodes.oscillatorB.stop(stopAt)
  } catch {
    // Oscillators can only be stopped once.
  }
  window.setTimeout(() => {
    void nodes.context.close().catch(() => undefined)
  }, 140)
}

export function CalmAudioPadControls({
  feedback,
  voice,
  onVoiceChange,
  sourceTimestamp,
  replay = false,
}: {
  feedback: FeedbackState
  voice: FeedbackAudioVoice
  onVoiceChange: (voice: FeedbackAudioVoice) => void
  sourceTimestamp?: number | null
  replay?: boolean
}) {
  const [enabled, setEnabled] = useState(false)
  const [volume, setVolume] = useState(0.35)
  const [audioError, setAudioError] = useState<string | null>(null)
  const nodesRef = useRef<CalmAudioNodes | null>(null)
  const audioGenerationRef = useRef(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const previousVoiceRef = useRef<FeedbackAudioVoice>(voice)
  const selectedLoop = isLyriaAudioVoice(voice) ? lyriaAudioLoops[voice] : null
  const confidence = clampUnit(feedback.confidence)
  const hasScore = typeof feedback.score === 'number' && Number.isFinite(feedback.score)
  const sourceAgeMs = typeof sourceTimestamp === 'number' ? nowMs - sourceTimestamp * 1000 : NaN
  const sourceFresh = replay || (Number.isFinite(sourceAgeMs) && sourceAgeMs >= -1000 && sourceAgeMs <= 2000)
  const gateOpen =
    sourceFresh &&
    feedback.signalState === 'usable' &&
    hasScore &&
    confidence >= calmAudioConfidenceThreshold
  const audioStatus = enabled ? (!sourceFresh ? 'Signal paused' : gateOpen ? 'Open' : 'Confidence gate') : 'Muted'
  const sourceLabel = selectedLoop ? 'Lyria loop' : 'Web Audio'

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const stopAudio = useCallback(() => {
    audioGenerationRef.current += 1
    if (nodesRef.current) {
      stopCalmAudio(nodesRef.current)
      nodesRef.current = null
    }
    setEnabled(false)
  }, [])

  const changeVoice = useCallback(
    (nextVoice: FeedbackAudioVoice) => {
      audioGenerationRef.current += 1
      if (nodesRef.current) {
        stopCalmAudio(nodesRef.current)
        nodesRef.current = null
      }
      setEnabled(false)
      onVoiceChange(nextVoice)
      setAudioError(null)
    },
    [onVoiceChange],
  )

  const startAudio = useCallback(async () => {
    const request = ++audioGenerationRef.current
    setAudioError(null)
    setEnabled(true) // Mute remains available while browser playback permission settles.
    let ownedNodes: CalmAudioNodes | null = null
    let createdContext: AudioContext | null = null
    let failureMessage = 'Audio could not start in this browser.'
    try {
      if (nodesRef.current) {
        stopCalmAudio(nodesRef.current)
        nodesRef.current = null
      }
      if (selectedLoop) {
        failureMessage = 'Audio loop could not start in this browser.'
        const audio = new Audio(selectedLoop.src)
        audio.loop = true
        audio.preload = 'auto'
        audio.volume = 0
        ownedNodes = { kind: 'lyria-loop', audio, src: selectedLoop.src }
        nodesRef.current = ownedNodes
        await audio.play()
      } else {
        const AudioContextConstructor = getAudioContextConstructor()
        if (!AudioContextConstructor) {
          failureMessage = 'Web Audio is unavailable in this browser.'
          throw new Error(failureMessage)
        }
        const context = new AudioContextConstructor()
        createdContext = context
        const masterGain = context.createGain()
        const filter = context.createBiquadFilter()
        const oscillatorA = context.createOscillator()
        const oscillatorB = context.createOscillator()
        const oscillatorGainA = context.createGain()
        const oscillatorGainB = context.createGain()
        masterGain.gain.value = 0
        filter.type = 'lowpass'
        oscillatorGainA.gain.value = 0.55
        oscillatorGainB.gain.value = 0.35
        oscillatorA.connect(oscillatorGainA).connect(filter)
        oscillatorB.connect(oscillatorGainB).connect(filter)
        filter.connect(masterGain).connect(context.destination)
        oscillatorA.start()
        oscillatorB.start()
        ownedNodes = { kind: 'oscillator', context, masterGain, oscillatorA, oscillatorB,
          oscillatorGainA, oscillatorGainB, filter }
        nodesRef.current = ownedNodes
        await context.resume()
      }
    } catch {
      // A cancelled/older play request must never dispose a newer sound engine.
      if (request !== audioGenerationRef.current) return
      if (ownedNodes) stopCalmAudio(ownedNodes)
      else if (createdContext) void createdContext.close().catch(() => undefined)
      nodesRef.current = null
      setEnabled(false)
      setAudioError(failureMessage)
    }
  }, [selectedLoop])

  useEffect(() => {
    return () => {
      audioGenerationRef.current += 1
      if (nodesRef.current) {
        stopCalmAudio(nodesRef.current)
        nodesRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (previousVoiceRef.current === voice) return

    previousVoiceRef.current = voice
    audioGenerationRef.current += 1
    if (nodesRef.current) {
      stopCalmAudio(nodesRef.current)
      nodesRef.current = null
    }
    setEnabled(false)
    setAudioError(null)
  }, [voice])

  useEffect(() => {
    const nodes = nodesRef.current
    if (!nodes) return

    const score = clampUnit(feedback.score ?? 0.5)
    const targetGain = enabled && gateOpen ? volume * confidence * 0.22 : 0

    if (nodes.kind === 'lyria-loop') {
      nodes.audio.volume = clampUnit(enabled && gateOpen ? volume * confidence * 0.7 : 0)
      return
    }

    if (isLyriaAudioVoice(voice)) return

    const preset = calmAudioVoices[voice]
    const now = nodes.context.currentTime
    const rootHz = preset.baseHz + score * 32

    nodes.masterGain.gain.setTargetAtTime(targetGain, now, gateOpen ? 0.6 : 0.04)
    nodes.oscillatorA.type = voice === 'ember' ? 'triangle' : 'sine'
    nodes.oscillatorB.type = voice === 'air' ? 'sine' : 'triangle'
    nodes.oscillatorA.frequency.setTargetAtTime(rootHz, now, 0.8)
    nodes.oscillatorB.frequency.setTargetAtTime(rootHz * preset.spread, now, 0.8)
    nodes.filter.frequency.setTargetAtTime(preset.filterHz + score * 260, now, 0.8)
  }, [confidence, enabled, feedback.score, gateOpen, voice, volume])

  return (
    <div className="calm-card calm-audio-card">
      <div className="calm-card__header">
        <Headphones size={18} />
        <div>
          <strong>Ambient pad</strong>
          <span>
            {feedbackModes[feedback.mode].shortLabel} · {audioStatus} · {sourceLabel}{replay ? ' · Saved replay' : ''}
          </span>
        </div>
      </div>
      <div className="audio-controls">
        <button type="button" onClick={enabled ? stopAudio : startAudio}>
          {enabled ? <Pause size={16} /> : <Play size={16} />}
          {enabled ? 'Mute pad' : 'Enable pad'}
        </button>
        <label>
          <span>Volume</span>
          <input
            name="feedback-audio-volume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => setVolume(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label>
          <span>Sound</span>
          <select
            name="feedback-audio-voice"
            value={voice}
            onChange={(event) => changeVoice(event.currentTarget.value as FeedbackAudioVoice)}
          >
            <optgroup label="Web Audio pad">
              {Object.entries(calmAudioVoices).map(([value, preset]) => (
                <option value={value} key={value}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Lyria loops">
              {Object.entries(lyriaAudioLoops).map(([value, loop]) => (
                <option value={value} key={value}>
                  {loop.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <dl className="calm-feature-list">
        <div>
          <dt>Gate</dt>
          <dd>{gateOpen ? 'open' : 'closed'}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{formatPercent(confidence)}</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd>{formatPercent(calmAudioConfidenceThreshold)}</dd>
        </div>
      </dl>
      {audioError ? <p className="audio-warning">{audioError}</p> : null}
    </div>
  )
}

function ElectrodeOverlay({
  channels,
  qualityByLabel,
  sourceLabel = 'live',
}: {
  channels: ChannelSnapshot[]
  qualityByLabel: Map<string, SignalQualityChannel>
  sourceLabel?: string
}) {
  return (
    <div className="electrode-map" aria-label="Electrode quality map">
      <svg viewBox="0 0 100 104" role="img" aria-label="Headset electrode overlay">
        <path
          className="electrode-map__head"
          d="M50 6 C72 6 88 25 88 50 C88 78 70 98 50 98 C30 98 12 78 12 50 C12 25 28 6 50 6 Z"
        />
        <path className="electrode-map__midline" d="M50 10 C47 30 47 68 50 94" />
        <path className="electrode-map__band" d="M19 48 C36 40 64 40 81 48" />
        {wiredHeadsetSensors.map(({ label }, index) => {
          const position = headsetPositions[label]
          const quality = headsetSensorQuality(label, index, channels, qualityByLabel)
          return (
            <g className="electrode-map__node" key={label}>
              <circle
                className={`quality-dot ${quality ? qualityTone(quality.status) : 'quality--unknown'}`}
                cx={position.x}
                cy={position.y}
                r="4.8"
              />
              <text x={position.x} y={position.y + 11}>
                {label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="electrode-map__list">
        {wiredHeadsetSensors.map(({ label }, index) => {
          const quality = headsetSensorQuality(label, index, channels, qualityByLabel)
          const seen = headsetSensorSeen(label, index, channels)
          return (
            <div className="quality-row" key={label}>
              <span className={`quality-dot ${quality ? qualityTone(quality.status) : ''}`} />
              <strong>{label}</strong>
              <small>
                {quality ? `${Math.round(quality.filtered_rms)} uV` : seen ? sourceLabel : '--'}
              </small>
              <em>{quality ? formatIssues(quality.issues) : seen ? 'waiting' : 'not mapped'}</em>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HeadsetFitGuide({
  channels,
  qualityByLabel,
  sourceLabel = 'live',
}: {
  channels: ChannelSnapshot[]
  qualityByLabel: Map<string, SignalQualityChannel>
  sourceLabel?: string
}) {
  const sensorRows = wiredHeadsetSensors.map((sensor, index) => {
    const quality = headsetSensorQuality(sensor.label, index, channels, qualityByLabel)
    return {
      ...sensor,
      quality,
      seen: headsetSensorSeen(sensor.label, index, channels),
    }
  })
  const attentionRows = sensorRows.filter(({ quality }) => !quality || quality.status !== 'good')
  const hasLiveReadings = sensorRows.some(({ quality }) => Boolean(quality))
  const isReplay = sourceLabel !== 'live'
  const guideTone = !hasLiveReadings || isReplay
    ? 'quality--questionable'
    : attentionRows.length
      ? 'quality--bad'
      : 'quality--good'
  const guideTitle = isReplay
    ? 'Switch to Live before adjusting fit'
    : !hasLiveReadings
      ? 'Fit guide waiting for signal quality'
      : attentionRows.length
        ? `${attentionRows.length} wired sensor${attentionRows.length === 1 ? '' : 's'} need fitting`
        : 'Wired channels pass quality checks'
  const guideDetail = isReplay
    ? 'Replay data can show a past setup, but headset fitting needs the current live stream.'
    : !hasLiveReadings
      ? 'Connect and start the Cyton or synthetic stream to color the active sensor positions.'
      : attentionRows.length
        ? 'Use the highlighted map positions and row hints to reseat only the channels that are not reading cleanly.'
        : 'Spacer holders are shown in grey; the app reads the eight wired Cyton channels.'

  return (
    <details className="fit-guide" aria-label="Headset fitting guide">
      <summary className="fit-guide__header">
        <div>
          <span className={`quality-dot ${guideTone}`} />
          <div>
            <h3>Headset fitting guide</h3>
            <p>{guideTitle} · expand for the electrode map</p>
          </div>
        </div>
        <span className="fit-guide__count">
          <CircleDot size={14} />
          {wiredHeadsetSensors.length} wired / {passiveHeadsetHolders.length} spacers
        </span>
      </summary>
      <div className="fit-guide__body">
        <p className="fit-guide__detail">{guideDetail}</p>
        <div className="fit-guide__diagram">
          <svg viewBox="0 0 100 108" role="img" aria-label="Top view headset fitting map">
            <path
              className="fit-guide__shell"
              d="M50 6 C72 6 90 25 90 50 C90 80 71 102 50 102 C29 102 10 80 10 50 C10 25 28 6 50 6 Z"
            />
            <path className="fit-guide__bridge" d="M50 9 C47 31 47 72 50 99" />
            <path className="fit-guide__bridge" d="M17 51 C35 42 65 42 83 51" />
            <text className="fit-guide__orientation" x="50" y="16">
              front
            </text>
            <text className="fit-guide__orientation" x="50" y="99">
              back
            </text>
            {passiveHeadsetHolders.map((holder) => (
              <circle
                className="fit-guide__holder"
                cx={holder.x}
                cy={holder.y}
                key={`${holder.x}-${holder.y}`}
                r="5.4"
              />
            ))}
            {sensorRows.map(({ label, x, y, quality }, index) => (
              <g className="fit-guide__sensor" key={label}>
                <circle className="fit-guide__sensor-ring" cx={x} cy={y} r="7.2" />
                <circle
                  className={`quality-dot ${quality ? qualityTone(quality.status) : 'quality--unknown'}`}
                  cx={x}
                  cy={y}
                  r="4.9"
                />
                <text x={x} y={y + (index < 2 ? -9 : 12)}>{label}</text>
              </g>
            ))}
          </svg>
          <div className="fit-guide__legend" aria-label="Fit guide legend">
            <span>
              <i className="quality-dot quality--good" />
              good
            </span>
            <span>
              <i className="quality-dot quality--questionable" />
              check
            </span>
            <span>
              <i className="quality-dot quality--bad" />
              reseat
            </span>
            <span>
              <i className="fit-guide__legend-holder" />
              spacer
            </span>
          </div>
        </div>
        <div className="fit-guide__readout">
          <div className="fit-guide__readout-header">
            <Gauge size={16} />
            <strong>{attentionRows.length ? 'Channels to adjust' : 'Wired channel positions'}</strong>
          </div>
          <div className="fit-guide__rows">
            {(attentionRows.length ? attentionRows : sensorRows).map((sensor) => (
              <div className="fit-guide__row" key={sensor.label}>
                <span
                  className={`quality-dot ${sensor.quality ? qualityTone(sensor.quality.status) : 'quality--unknown'}`}
                />
                <div>
                  <strong>
                    {sensor.label}
                    <small>{sensor.region}</small>
                  </strong>
                  <p>
                    {sensor.quality
                      ? `${Math.round(sensor.quality.filtered_rms)} uV EEG · ${formatIssues(sensor.quality.issues)}`
                      : sensor.seen
                        ? 'Waiting for quality window'
                        : 'No mapped channel yet'}
                  </p>
                  <em>{sensor.fitHint}</em>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  )
}

function CalibrationCuePanel({
  status,
  activeStep,
  elapsedSeconds,
  markers,
  persistedCount,
  recordingActive,
  canRun,
  canExport,
  onStart,
  onStop,
  onExport,
}: {
  status: CalibrationStatus
  activeStep: CalibrationStep
  elapsedSeconds: number
  markers: CalibrationMarker[]
  persistedCount: number
  recordingActive: boolean
  canRun: boolean
  canExport: boolean
  onStart: () => void
  onStop: () => void
  onExport: () => void
}) {
  const progress = Math.min(1, elapsedSeconds / activeStep.durationSeconds)
  const remainingSeconds = Math.max(0, activeStep.durationSeconds - elapsedSeconds)
  const latestMarker = markers[markers.length - 1]

  return (
    <div className={`calibration-card calibration-card--${status}`} aria-label="Guided calibration cues">
      <div className="calibration-card__header">
        <div>
          <strong>Calibration cues</strong>
          <span>
            {status === 'running'
              ? activeStep.label
              : status === 'complete'
                ? 'Protocol complete'
                : 'Ready for eyes-open/closed'}
          </span>
        </div>
        <span className="calibration-card__timer">{formatSeconds(remainingSeconds)}</span>
      </div>
      <div className="calibration-card__cue">
        <VolumeIcon />
        <div>
          <strong>{activeStep.cue}</strong>
          <p>{activeStep.detail}</p>
        </div>
      </div>
      <div className="calibration-progress" aria-label="Calibration step progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="calibration-steps" aria-label="Calibration protocol steps">
        {calibrationProtocol.map((step) => (
          <span
            className={
              step.id === activeStep.id && status === 'running'
                ? 'calibration-steps__active'
                : markers.some((marker) => marker.stepId === step.id)
                  ? 'calibration-steps__done'
                  : ''
            }
            key={step.id}
          >
            {step.label}
          </span>
        ))}
      </div>
      <div className="button-row calibration-card__actions">
        <button type="button" onClick={onStart} disabled={!canRun || status === 'running'}>
          <Play size={16} />
          Run cues
        </button>
        <button type="button" className="ghost-button" onClick={onStop} disabled={status !== 'running'}>
          <Pause size={16} />
          Stop
        </button>
      </div>
      <button
        type="button"
        className="ghost-button calibration-card__export"
        onClick={onExport}
        disabled={!canExport}
      >
        <Download size={16} />
        Export markers
      </button>
      <dl className="calibration-marker-summary">
        <div>
          <dt>Markers</dt>
          <dd>{markers.length}</dd>
        </div>
        <div>
          <dt>Last cue</dt>
          <dd>{latestMarker?.label ?? '--'}</dd>
        </div>
        <div>
          <dt>Sample</dt>
          <dd>{latestMarker?.streamSampleCount ?? '--'}</dd>
        </div>
        <div>
          <dt>Saved</dt>
          <dd>{recordingActive ? persistedCount : 'local'}</dd>
        </div>
      </dl>
    </div>
  )
}

function VolumeIcon() {
  return <Radio size={18} />
}

function ReplayMarkerStrip({
  markers,
  replayOffset,
  replayRowCount,
  replayTotalRows,
  samplingRate,
  replayBusy,
  onJumpToMarker,
}: {
  markers: RecordingCalibrationMarker[]
  replayOffset: number
  replayRowCount: number
  replayTotalRows: number
  samplingRate?: number | null
  replayBusy: boolean
  onJumpToMarker: (marker: RecordingCalibrationMarker) => void
}) {
  if (!markers.length) return null

  return (
    <div className="replay-markers" aria-label="Calibration markers">
      <div className="replay-markers__header">
        <div>
          <strong>Calibration markers</strong>
          <span>{markers.length} saved cue points</span>
        </div>
        <small>Jump to cue</small>
      </div>
      <div className="replay-marker-track" aria-hidden="true">
        {markers.map((marker) => {
          const left = replayTotalRows
            ? Math.max(0, Math.min(100, (marker.recording_sample_index / replayTotalRows) * 100))
            : 0
          const inWindow = replayMarkerInWindow(marker, replayOffset, replayRowCount)
          return (
            <i
              className={inWindow ? 'replay-marker-track__active' : ''}
              key={`${marker.captured_at}-${marker.step_id}`}
              style={{ left: `${left}%` }}
            />
          )
        })}
      </div>
      <div className="replay-marker-list">
        {markers.map((marker) => {
          const inWindow = replayMarkerInWindow(marker, replayOffset, replayRowCount)
          return (
            <button
              type="button"
              className={`mini-button replay-marker-button ${
                inWindow ? 'replay-marker-button--active' : ''
              }`}
              onClick={() => onJumpToMarker(marker)}
              disabled={replayBusy}
              key={`${marker.captured_at}-${marker.step_id}`}
            >
              <CircleDot size={14} />
              <span>{marker.label}</span>
              <small>{formatMarkerTime(marker, samplingRate)}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CalmMirrorSurface({
  board,
  streamTimestamp,
  displayedChannels,
  visibleQualityChannels,
  qualityByLabel,
  calm,
  baseline,
  feedbackMode,
  feedbackStates,
  feedbackTrend,
  feedbackBands,
  visualizerKind,
  audioVoice,
  replay,
  replayBusy,
  replayWindowSize,
  replayStart,
  replayEnd,
  replayTotalRows,
  maxReplayOffset,
  onSeekReplayWindow,
  onChangeReplayWindowSize,
  onFeedbackModeChange,
  onVisualizerChange,
  onAudioVoiceChange,
  onApplyPreset,
  onStartBaseline,
  onResetBaseline,
  baselineBusy,
}: {
  board: BoardState
  streamTimestamp: number | null
  displayedChannels: ChannelSnapshot[]
  visibleQualityChannels: SignalQualityChannel[]
  qualityByLabel: Map<string, SignalQualityChannel>
  calm: CalmFeatureResponse | null
  baseline: CalmCalibrationState
  feedbackMode: FeedbackMode
  feedbackStates: Record<FeedbackMode, FeedbackState>
  feedbackTrend: number[]
  feedbackBands: Array<{ name: string; value: number }>
  visualizerKind: VisualizerKind
  audioVoice: FeedbackAudioVoice
  replay: RecordingPreview | null
  replayBusy: boolean
  replayWindowSize: number
  replayStart: number
  replayEnd: number
  replayTotalRows: number
  maxReplayOffset: number
  onSeekReplayWindow: (offset: number) => void
  onChangeReplayWindowSize: (windowSize: number) => void
  onFeedbackModeChange: (mode: FeedbackMode) => void
  onVisualizerChange: (kind: VisualizerKind) => void
  onAudioVoiceChange: (voice: FeedbackAudioVoice) => void
  onApplyPreset: (preset: FeedbackExperiencePreset) => void
  onStartBaseline: () => void
  onResetBaseline: () => void
  baselineBusy: boolean
}) {
  const surfaceRef = useRef<HTMLElement | null>(null)
  const [experienceMode, setExperienceMode] = useState(false)
  const readiness = calmReadiness(calm, visibleQualityChannels)
  const activeFeedback = feedbackStates[feedbackMode]
  const hasScore =
    typeof activeFeedback.score === 'number' && activeFeedback.signalState === 'usable'
  const replayMode = Boolean(replay)
  const baselineProgress =
    baseline.target_duration_seconds > 0
      ? Math.min(100, (baseline.elapsed_seconds / baseline.target_duration_seconds) * 100)
      : 0
  const toggleExperienceMode = useCallback(async () => {
    if (experienceMode) {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined)
      }
      setExperienceMode(false)
      return
    }

    setExperienceMode(true)
    await surfaceRef.current?.requestFullscreen?.().catch(() => undefined)
  }, [experienceMode])

  useEffect(() => {
    const syncFullscreenState = () => {
      if (!document.fullscreenElement) {
        setExperienceMode(false)
      }
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
    }
  }, [])

  return (
    <section
      className={`signal-surface calm-surface ${experienceMode ? 'calm-surface--experience' : ''}`}
      aria-label="Feedback Lab demo"
      ref={surfaceRef}
    >
      <div className="signal-surface__header">
        <div>
          <h2>{replayMode ? 'Replay Feedback' : 'Feedback Lab'}</h2>
          <p>
            {replayMode
              ? 'Saved-session relax and focus previews with signal-first context'
              : 'Non-clinical relax, focus, and signal-clarity feedback'}
          </p>
        </div>
        <div className="surface-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => void toggleExperienceMode()}
            aria-pressed={experienceMode}
          >
            {experienceMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {experienceMode ? 'Exit experience' : 'Experience'}
          </button>
          <span className={`state-pill ${readiness.tone}`}>
            <Headphones size={14} />
            {feedbackModes[feedbackMode].shortLabel}
          </span>
        </div>
      </div>

      <div className="calm-layout">
        <section className="calm-stage" aria-label="Feedback state visual">
          {experienceMode ? (
            <button
              type="button"
              className="experience-exit-button"
              onClick={() => void toggleExperienceMode()}
            >
              <Minimize2 size={14} />
              Exit
            </button>
          ) : null}
          <div className="experience-preset-strip" aria-label="Feedback experience presets">
            {feedbackExperiencePresets.map((preset) => {
              const selected =
                feedbackMode === preset.mode &&
                visualizerKind === preset.visualizer &&
                audioVoice === preset.audio
              return (
                <button
                  type="button"
                  className={selected ? 'experience-preset-strip__active' : ''}
                  onClick={() => onApplyPreset(preset)}
                  key={preset.id}
                >
                  <Waves size={15} />
                  <span>{preset.label}</span>
                  <small>{preset.detail}</small>
                </button>
              )
            })}
          </div>
          <div className="feedback-mode-strip" role="tablist" aria-label="Feedback mode">
            {feedbackModeOrder.map((mode) => {
              const state = feedbackStates[mode]
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={feedbackMode === mode}
                  className={feedbackMode === mode ? 'feedback-mode-strip__active' : ''}
                  onClick={() => onFeedbackModeChange(mode)}
                  key={mode}
                >
                  {mode === 'calm' ? (
                    <Headphones size={15} />
                  ) : mode === 'focus' ? (
                    <Eye size={15} />
                  ) : (
                    <Gauge size={15} />
                  )}
                  <span>{feedbackModes[mode].shortLabel}</span>
                  <small>{formatPercent(state.score)}</small>
                </button>
              )
            })}
          </div>
          <div className="visualizer-strip" role="tablist" aria-label="Feedback visualizer">
            {visualizerOrder.map((kind) => (
              <button
                type="button"
                role="tab"
                aria-selected={visualizerKind === kind}
                className={visualizerKind === kind ? 'visualizer-strip__active' : ''}
                onClick={() => onVisualizerChange(kind)}
                key={kind}
              >
                <Waves size={15} />
                <span>{visualizers[kind].label}</span>
                <small>{visualizers[kind].detail}</small>
              </button>
            ))}
          </div>
          <div className="calm-stage__copy">
            <strong>{activeFeedback.title}</strong>
            <p>{activeFeedback.detail}</p>
          </div>
          <FeedbackVisualizer
            kind={visualizerKind}
            feedback={activeFeedback}
            bands={feedbackBands}
            trend={feedbackTrend}
            active={hasScore}
          />
          <div className="calm-score">
            <span>{activeFeedback.label}</span>
            <strong>{hasScore ? formatPercent(activeFeedback.score) : 'Paused'}</strong>
            <small>Confidence {formatPercent(activeFeedback.confidence)}</small>
          </div>
          <svg className="calm-trend" viewBox="0 0 360 70" role="img" aria-label="Feedback trend history">
            <path className="trace-gridline" d="M 0 35 L 360 35" />
            <path
              className="calm-trend__line"
              d={buildTrendPath(feedbackTrend, 360, 70)}
              style={{ stroke: `hsl(${activeFeedback.hue} 70% 38%)` }}
            />
          </svg>
        </section>

        <aside className="calm-operator" aria-label="Feedback Lab setup">
          <div className="calm-card">
            <div className="calm-card__header">
              <Gauge size={18} />
              <div>
                <strong>Signal readiness</strong>
                <span>
                  {replayMode
                    ? `${replayStart}-${replayEnd} of ${replayTotalRows} samples`
                    : board.status === 'streaming' ? 'Live stream' : 'Start stream'}
                </span>
              </div>
            </div>
            <ElectrodeOverlay
              channels={displayedChannels}
              qualityByLabel={qualityByLabel}
              sourceLabel={replayMode ? 'replay' : 'live'}
            />
          </div>

          {replay ? (
            <div className="calm-card">
              <div className="calm-card__header">
                <SkipForward size={18} />
                <div>
                  <strong>Replay window</strong>
                  <span>{replay.recording.label || replay.recording.session_id}</span>
                </div>
              </div>
              <div className="replay-controls replay-controls--calm" aria-label="Calm replay controls">
                <div className="replay-controls__timeline">
                  <label>
                    <span>Saved window</span>
                    <input
                      name="calm-replay-offset"
                      type="range"
                      min="0"
                      max={maxReplayOffset}
                      step="1"
                      value={Math.min(replay.offset, maxReplayOffset)}
                      onChange={(event) => onSeekReplayWindow(Number(event.target.value))}
                      disabled={replayBusy || replayTotalRows <= replayWindowSize}
                    />
                  </label>
                  <small>
                    {replayStart}-{replayEnd} / {replayTotalRows}
                  </small>
                </div>
                <div className="replay-controls__actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onSeekReplayWindow(replay.offset - replayWindowSize)}
                    disabled={replayBusy || replay.offset <= 0}
                    aria-label="Previous calm replay window"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onSeekReplayWindow(replay.offset + replayWindowSize)}
                    disabled={replayBusy || replay.offset >= maxReplayOffset}
                    aria-label="Next calm replay window"
                  >
                    <SkipForward size={14} />
                  </button>
                  <label>
                    <span>Window</span>
                    <select
                      name="calm-replay-window-size"
                      value={replayWindowSize}
                      onChange={(event) => onChangeReplayWindowSize(Number(event.target.value))}
                      disabled={replayBusy}
                    >
                      {replayWindowSizeOptions.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          <div className="calm-card">
            <div className="calm-card__header">
              <Activity size={18} />
              <div>
                <strong>Baseline</strong>
                <span>{baseline.status}</span>
              </div>
            </div>
            <div className="baseline-meter">
              <i style={{ width: `${baselineProgress}%` }} />
            </div>
            <dl className="calm-feature-list">
              <div>
                <dt>Accepted</dt>
                <dd>
                  {baseline.accepted_windows}/{baseline.required_windows}
                </dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{Math.round(baseline.elapsed_seconds)}s</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>{baseline.window_size}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button
                type="button"
                onClick={onStartBaseline}
                disabled={baselineBusy || board.status !== 'streaming' || replayMode}
              >
                <Play size={16} />
                Baseline
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={onResetBaseline}
                disabled={baselineBusy || replayMode}
              >
                <RefreshCw size={16} />
                Reset
              </button>
            </div>
          </div>

          <CalmAudioPadControls
            feedback={activeFeedback}
            sourceTimestamp={feedbackMode === 'calm'
              ? Math.min(streamTimestamp ?? NaN, calm?.source_timestamp ?? NaN)
              : streamTimestamp}
            replay={replayMode}
            voice={audioVoice}
            onVoiceChange={onAudioVoiceChange}
          />

          <div className="calm-card">
            <div className="calm-card__header">
              <BarChart3 size={18} />
              <div>
                <strong>State components</strong>
                <span>{activeFeedback.driverLabel}: {activeFeedback.driverValue}</span>
              </div>
            </div>
            <dl className="calm-feature-list">
              {activeFeedback.features.map((feature) => (
                <div key={feature.label}>
                  <dt>{feature.label}</dt>
                  <dd>{feature.value}</dd>
                </div>
              ))}
              <div>
                <dt>Flags</dt>
                <dd>{activeFeedback.flags.length ? activeFeedback.flags.slice(0, 2).join(', ') : 'clear'}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  )
}

function chooseRecommendedPort(ports: SerialPortInfo[]) {
  return ports.find((port) => port.recommended)
}

function isWithinRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max
}

function validateDspControls({
  windowSize,
  bandpassLowHz,
  bandpassHighHz,
  notchEnabled,
  notchFrequencyHz,
}: {
  windowSize: number
  bandpassLowHz: number
  bandpassHighHz: number
  notchEnabled: boolean
  notchFrequencyHz: number
}) {
  if (!isWithinRange(windowSize, dspLimits.windowMin, dspLimits.windowMax)) {
    return `Window must be ${dspLimits.windowMin}-${dspLimits.windowMax} samples.`
  }
  if (
    !isWithinRange(
      bandpassLowHz,
      dspLimits.bandpassLowMin,
      dspLimits.bandpassLowMax,
    )
  ) {
    return `Bandpass low must be ${dspLimits.bandpassLowMin}-${dspLimits.bandpassLowMax} Hz.`
  }
  if (
    !isWithinRange(
      bandpassHighHz,
      dspLimits.bandpassHighMin,
      dspLimits.bandpassHighMax,
    )
  ) {
    return `Bandpass high must be ${dspLimits.bandpassHighMin}-${dspLimits.bandpassHighMax} Hz.`
  }
  if (bandpassLowHz >= bandpassHighHz) {
    return 'Bandpass low must be below high.'
  }
  if (
    notchEnabled &&
    !isWithinRange(notchFrequencyHz, dspLimits.notchMin, dspLimits.notchMax)
  ) {
    return `Notch frequency must be ${dspLimits.notchMin}-${dspLimits.notchMax} Hz.`
  }
  return null
}

async function loadBoardContext() {
  const [healthResponse, portResponse, boardResponse, recordingResponse, recordingsResponse] =
    await Promise.all([
    api.health(),
    api.ports(),
    api.board(),
    api.recording(),
    api.recordings(),
  ])

  return { healthResponse, portResponse, boardResponse, recordingResponse, recordingsResponse }
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [ports, setPorts] = useState<Array<SerialPortInfo & { sharedSessionOnly?: boolean }>>([])
  const [board, setBoard] = useState<BoardState>(emptyBoard)
  const [stream, setStream] = useState<StreamSnapshot>(emptyStream)
  const [recording, setRecording] = useState<RecordingState>(emptyRecording)
  const [recordings, setRecordings] = useState<RecordingState[]>([])
  const [replay, setReplay] = useState<RecordingPreview | null>(null)
  const [replayAnalysis, setReplayAnalysis] = useState<RecordingSpectralAnalysis | null>(null)
  const [replayWindowSize, setReplayWindowSize] = useState(500)
  const [dsp, setDsp] = useState<DspSummary | null>(null)
  const [dspWindowSize, setDspWindowSize] = useState(500)
  const [dspBandpassLowHz, setDspBandpassLowHz] = useState(1)
  const [dspBandpassHighHz, setDspBandpassHighHz] = useState(45)
  const [dspNotchEnabled, setDspNotchEnabled] = useState(true)
  const [dspNotchFrequencyHz, setDspNotchFrequencyHz] = useState(
    DEFAULT_LINE_FREQUENCY_HZ,
  )
  const lineFrequencyHz = normalizeLineFrequencyHz(dspNotchFrequencyHz)
  const [signalQuality, setSignalQuality] = useState<SignalQuality | null>(null)
  const [calm, setCalm] = useState<CalmFeatureResponse | null>(null)
  const [calmBaseline, setCalmBaseline] = useState<CalmCalibrationState>(emptyCalmBaseline)
  const [calmTrend, setCalmTrend] = useState<number[]>([])
  const [focusTrend, setFocusTrend] = useState<number[]>([])
  const [clarityTrend, setClarityTrend] = useState<number[]>([])
  const [activeView, setActiveView] = useState<'console' | 'demo' | 'doctor-demo' | 'experiment' | 'help'>('console')
  const [feedbackMode, setFeedbackMode] = useState<FeedbackMode>('calm')
  const [visualizerKind, setVisualizerKind] = useState<VisualizerKind>('aurora')
  const [feedbackAudioVoice, setFeedbackAudioVoice] =
    useState<FeedbackAudioVoice>('calm-trend')
  const [selectedBoard, setSelectedBoard] = useState<BoardKind>('synthetic')
  const [selectedPort, setSelectedPort] = useState('')
  const [recordingLabel, setRecordingLabel] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameLabel, setRenameLabel] = useState('')
  const [busy, setBusy] = useState(true)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [replayBusy, setReplayBusy] = useState(false)
  const [baselineBusy, setBaselineBusy] = useState(false)
  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatus>('idle')
  const [calibrationStepIndex, setCalibrationStepIndex] = useState(0)
  const [calibrationStepStartedAt, setCalibrationStepStartedAt] = useState<number | null>(null)
  const [calibrationElapsedSeconds, setCalibrationElapsedSeconds] = useState(0)
  const [calibrationMarkers, setCalibrationMarkers] = useState<CalibrationMarker[]>([])
  const [error, setError] = useState<string | null>(null)
  const liveConnectionRef = useRef<ReturnType<typeof connectLiveStream> | null>(null)
  const loadedBoardRef = useRef<BoardState | null>(null)
  const calibrationRunningRef = useRef(false)
  const calibrationSourceRef = useRef<{
    board: BoardState
    recording: Pick<RecordingState, 'session_id' | 'label' | 'sample_count'> | null
    interrupted: boolean
  } | null>(null)
  const liveErrorRef = useRef<string | null>(null)
  const dspRef = useRef<DspSummary | null>(null)
  const signalQualityRef = useRef<SignalQuality | null>(null)
  const streamRef = useRef<StreamSnapshot>(emptyStream)
  const replayRequestRef = useRef(0)
  const calmRef = useRef<CalmFeatureResponse | null>(null)
  const calibrationStepIndexRef = useRef(0)
  const exitReplay = useCallback(() => {
    replayRequestRef.current += 1
    setReplay(null)
    setReplayAnalysis(null)
    setReplayBusy(false)
  }, [])
  const resetLiveFeedback = useCallback(() => {
    setCalm(null)
    setDsp(null)
    setSignalQuality(null)
    calmRef.current = null
    dspRef.current = null
    signalQualityRef.current = null
    setCalmTrend([])
    setFocusTrend([])
    setClarityTrend([])
    setCalmBaseline(emptyCalmBaseline)
  }, [])
  const dspValidationMessage = validateDspControls({
    windowSize: dspWindowSize,
    bandpassLowHz: dspBandpassLowHz,
    bandpassHighHz: dspBandpassHighHz,
    notchEnabled: dspNotchEnabled,
    notchFrequencyHz: dspNotchFrequencyHz,
  })
  const dspControlsValid = dspValidationMessage === null

  const refresh = useCallback(async () => {
    liveConnectionRef.current?.retry()
    setError(null)
    try {
      const {
        healthResponse,
        portResponse,
        boardResponse,
        recordingResponse,
        recordingsResponse,
      } =
        await loadBoardContext()
      setHealth(healthResponse)
      setPorts(portResponse)
      loadedBoardRef.current = boardResponse
      setBoard(boardResponse)
      setRecording(recordingResponse)
      setRecordings(recordingsResponse)
      const setup = resolveAutomaticDeviceSetup(boardResponse, portResponse)
      setSelectedBoard(setup.selectedBoard)
      setSelectedPort(setup.selectedPort)
    } catch (refreshError) {
      setError(formatBoardActionError(refreshError))
    }
  }, [])

  const playCalibrationCue = useCallback((message: string) => {
    let fallbackPlayed = false

    const playBrowserFallback = () => {
      if (fallbackPlayed) return
      fallbackPlayed = true

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(message)
        utterance.rate = 0.92
        utterance.pitch = 0.95
        window.speechSynthesis.speak(utterance)
      }
    }

    try {
      const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext }
      const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext
      if (AudioContextClass) {
        const audioContext = new AudioContextClass()
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        oscillator.frequency.value = 660
        oscillator.type = 'sine'
        gain.gain.setValueAtTime(0.001, audioContext.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.22)
        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.start()
        oscillator.stop(audioContext.currentTime + 0.24)
        window.setTimeout(() => void audioContext.close(), 320)
      }
    } catch {
      // Browser audio can be unavailable; speech synthesis still provides the cue.
    }

    const fallbackTimer = window.setTimeout(playBrowserFallback, 900)
    void api
      .calibrationCueSpeech({ transcript: message })
      .then(async (audioBlob) => {
        if (fallbackPlayed) return
        if (!audioBlob.size) {
          playBrowserFallback()
          return
        }
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        const objectUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(objectUrl)
        audio.volume = 1
        audio.onended = () => URL.revokeObjectURL(objectUrl)
        audio.onerror = () => {
          URL.revokeObjectURL(objectUrl)
          playBrowserFallback()
        }
        try {
          await audio.play()
        } catch {
          URL.revokeObjectURL(objectUrl)
          playBrowserFallback()
        }
      })
      .catch(() => {
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        playBrowserFallback()
      })
  }, [])

  const persistCalibrationMarker = useCallback(
    (marker: CalibrationMarker) => {
      if (!recording.active) return

      void api
        .captureRecordingCalibrationMarker({
          step_id: marker.stepId,
          label: marker.label,
          cue: marker.cue,
          elapsed_seconds: marker.elapsedSeconds,
          stream_sample_count: marker.streamSampleCount,
          calm_score: marker.calmScore ?? null,
          confidence: marker.confidence ?? null,
          alpha_post: marker.alphaPost ?? null,
          high_frequency_ratio: marker.highFrequencyRatio ?? null,
          signal_state: marker.signalState ?? null,
          quality_good: marker.qualityGood ?? null,
          quality_questionable: marker.qualityQuestionable ?? null,
          quality_bad: marker.qualityBad ?? null,
        })
        .then((nextRecording) => {
          setRecording(nextRecording)
          void api.recordings().then(setRecordings).catch(() => undefined)
        })
        .catch(() => {
          setError('Calibration marker kept locally, but could not be saved to recording metadata')
        })
    },
    [recording.active],
  )

  const makeCalibrationMarker = useCallback((step: CalibrationStep, startedAt: number) => {
    const latestCalm = calmRef.current
    const latestQuality = signalQualityRef.current
    return {
      stepId: step.id,
      label: step.label,
      cue: step.cue,
      timestamp: new Date().toISOString(),
      elapsedSeconds: Math.max(0, (Date.now() - startedAt) / 1000),
      streamSampleCount: streamRef.current.sample_count,
      calmScore: latestCalm?.calm_score ?? null,
      confidence: latestCalm?.confidence ?? null,
      alphaPost: latestCalm?.features.alpha_post ?? null,
      highFrequencyRatio: latestCalm?.features.high_frequency_ratio ?? null,
      signalState: latestCalm?.signal_state ?? null,
      qualityGood: latestQuality?.good_channels ?? null,
      qualityQuestionable: latestQuality?.questionable_channels ?? null,
      qualityBad: latestQuality?.bad_channels ?? null,
    }
  }, [])

  const captureCalibrationMarker = useCallback(
    (step: CalibrationStep, startedAt: number) => {
      const marker = makeCalibrationMarker(step, startedAt)
      setCalibrationMarkers((current) => [...current, marker])
      persistCalibrationMarker(marker)
    },
    [makeCalibrationMarker, persistCalibrationMarker],
  )

  const stopCalibrationProtocol = useCallback(() => {
    if (calibrationRunningRef.current && calibrationSourceRef.current) calibrationSourceRef.current.interrupted = true
    calibrationRunningRef.current = false
    setCalibrationStatus((current) => (current === 'running' ? 'complete' : current))
    setCalibrationStepStartedAt(null)
    setCalibrationElapsedSeconds(0)
    playCalibrationCue('Calibration stopped.')
  }, [playCalibrationCue])

  const startCalibrationProtocol = useCallback(() => {
    calibrationRunningRef.current = true
    calibrationSourceRef.current = { board, interrupted: false, recording: recording.active
      ? { session_id: recording.session_id, label: recording.label, sample_count: recording.sample_count } : null }
    const firstStep = calibrationProtocol[0]
    const startedAt = Date.now()
    calibrationStepIndexRef.current = 0
    setCalibrationStatus('running')
    setCalibrationStepIndex(0)
    setCalibrationStepStartedAt(startedAt)
    setCalibrationElapsedSeconds(0)
    const marker = makeCalibrationMarker(firstStep, startedAt)
    setCalibrationMarkers([marker])
    persistCalibrationMarker(marker)
    playCalibrationCue(firstStep.cue)
  }, [board, recording, makeCalibrationMarker, persistCalibrationMarker, playCalibrationCue])

  const advanceCalibrationStep = useCallback(() => {
    if (!calibrationRunningRef.current) return
    const nextIndex = calibrationStepIndexRef.current + 1
    if (nextIndex >= calibrationProtocol.length) {
      calibrationRunningRef.current = false
      setCalibrationStatus('complete')
      setCalibrationStepStartedAt(null)
      setCalibrationElapsedSeconds(0)
      playCalibrationCue('Calibration complete.')
      return
    }

    const nextStep = calibrationProtocol[nextIndex]
    const startedAt = Date.now()
    calibrationStepIndexRef.current = nextIndex
    setCalibrationStepIndex(nextIndex)
    setCalibrationStepStartedAt(startedAt)
    setCalibrationElapsedSeconds(0)
    captureCalibrationMarker(nextStep, startedAt)
    playCalibrationCue(nextStep.cue)
  }, [captureCalibrationMarker, playCalibrationCue])

  const exportCalibrationMarkers = useCallback(() => {
    const source = calibrationSourceRef.current
    const payload = {
      exported_at: new Date().toISOString(),
      board: source?.board ?? board,
      interrupted: source?.interrupted ?? false,
      recording: source ? source.recording && {
        ...source.recording,
        sample_count_at_start: source.recording.sample_count,
        sample_count: recording.session_id === source.recording.session_id ? recording.sample_count : null,
      } : recording.active
        ? {
            session_id: recording.session_id,
            label: recording.label,
            sample_count: recording.sample_count,
          }
        : null,
      protocol: calibrationProtocol,
      markers: calibrationMarkers,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nexus-calibration-${new Date().toISOString().replaceAll(':', '-')}.json`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [board, calibrationMarkers, recording])

  useEffect(() => {
    let cancelled = false

    async function loadInitialState() {
      try {
        const {
          healthResponse,
          portResponse,
          boardResponse,
          recordingResponse,
          recordingsResponse,
        } =
          await loadBoardContext()

        if (cancelled) return
        setHealth(healthResponse)
        setPorts(portResponse)
        loadedBoardRef.current = boardResponse
        setBoard(boardResponse)
        setRecording(recordingResponse)
        setRecordings(recordingsResponse)
        const setup = resolveAutomaticDeviceSetup(boardResponse, portResponse)
        setSelectedBoard(setup.selectedBoard)
        setSelectedPort(setup.selectedPort)
        if (setup.connection) {
          try {
            const connectedBoard = await api.connect(setup.connection)
            if (!cancelled) {
              loadedBoardRef.current = connectedBoard
              setBoard(connectedBoard)
            }
          } catch (connectError) {
            if (!cancelled) {
              const failureMessage = formatBoardActionError(connectError)
              setError(failureMessage)
              try {
                const failedBoard = await api.board()
                if (!cancelled) {
                  loadedBoardRef.current = failedBoard
                  setBoard(failedBoard)
                }
              } catch {
                if (!cancelled) {
                  setBoard({
                    ...boardResponse,
                    status: 'error',
                    board: setup.selectedBoard,
                    serial_port: setup.selectedPort,
                    message: failureMessage,
                  })
                }
              }
            }
          }
        }
      } catch (refreshError) {
        if (!cancelled) {
          setError(formatBoardActionError(refreshError))
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void loadInitialState()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let previousStatus: StreamSnapshot['status'] | null = null
    let previousConnection: string | null | undefined
    const connection = connectLiveStream(STREAM_WS_URL, {
      snapshot(snapshot) {
        if (previousStatus === null && loadedBoardRef.current) {
          previousStatus = loadedBoardRef.current.status
          previousConnection = loadedBoardRef.current.connection_id
        }
        const started = previousStatus !== null && snapshot.status === 'streaming' && previousStatus !== 'streaming'
        const reset = previousStatus !== null && snapshot.status === 'idle' && previousStatus !== 'idle'
        const replaced = snapshot.connection_id !== undefined && previousConnection !== undefined
          && snapshot.connection_id !== previousConnection
        previousStatus = snapshot.status
        if (snapshot.connection_id !== undefined) previousConnection = snapshot.connection_id
        if (reset || replaced) {
          resetLiveFeedback()
          if (calibrationRunningRef.current) {
            calibrationRunningRef.current = false
            if (calibrationSourceRef.current) calibrationSourceRef.current.interrupted = true
            setCalibrationStatus('idle')
            setCalibrationStepStartedAt(null)
            setCalibrationElapsedSeconds(0)
            setCalibrationStepIndex(0)
            calibrationStepIndexRef.current = 0
            window.speechSynthesis?.cancel()
          }
        }
        if (started || (replaced && snapshot.status === 'streaming')) {
          exitReplay()
        }
        setStream(snapshot)
        setBoard(current => sharedBoardState(current, snapshot))
        const activePort = snapshot.status === 'prepared' || snapshot.status === 'streaming'
          ? snapshot.serial_port : null
        setPorts(current => {
          const next = current.filter(port => !port.sharedSessionOnly || port.device === activePort)
          if (activePort && !next.some(port => port.device === activePort)) {
            return [...next, { device: activePort, transport: 'unknown', recommended: false,
              rank: 0, message: 'Active backend serial port', sharedSessionOnly: true }]
          }
          return next.length === current.length ? current : next
        })
        if (snapshot.eeg_channels && snapshot.eeg_names && snapshot.board
          && (snapshot.status === 'prepared' || snapshot.status === 'streaming')) {
          setSelectedBoard(snapshot.board)
          setSelectedPort(snapshot.serial_port ?? '')
        }
        if (snapshot.status === 'error') {
          setBoard(current => current.status === 'streaming' || current.status === 'prepared'
            ? { ...current, status: 'error', message: snapshot.message }
            : current)
          liveErrorRef.current = snapshot.message || 'Signal paused. Reset and connect again.'
          setError(liveErrorRef.current)
        } else {
          const previousLiveError = liveErrorRef.current
          liveErrorRef.current = null
          setError(current => current === previousLiveError ? null : current)
          if (snapshot.status === 'idle') setBoard(current => current.status === 'idle' ? current : emptyBoard)
        }
      },
      unavailable(message) {
        setStream(current => ({ ...current, status: 'error', sample_count: 0, timestamps: [], channels: [] }))
        liveErrorRef.current = message
        setError(message)
      },
    })
    liveConnectionRef.current = connection
    return () => {
      liveConnectionRef.current = null
      replayRequestRef.current += 1
      connection.close()
    }
  }, [exitReplay, resetLiveFeedback])

  useEffect(() => {
    if (!recording.active) return undefined

    const interval = window.setInterval(() => {
      api
        .recording()
        .then(setRecording)
        .catch(() => undefined)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [recording.active])

  useEffect(() => {
    dspRef.current = dsp
  }, [dsp])

  useEffect(() => {
    signalQualityRef.current = signalQuality
  }, [signalQuality])

  useEffect(() => {
    streamRef.current = stream
  }, [stream])

  useEffect(() => {
    calmRef.current = calm
  }, [calm])

  useEffect(() => {
    calibrationStepIndexRef.current = calibrationStepIndex
  }, [calibrationStepIndex])

  useEffect(() => {
    if (calibrationStatus !== 'running' || calibrationStepStartedAt === null) {
      return undefined
    }

    const interval = window.setInterval(() => {
      if (board.status !== 'streaming') {
        if (calibrationRunningRef.current && calibrationSourceRef.current) calibrationSourceRef.current.interrupted = true
        calibrationRunningRef.current = false
        setCalibrationStatus('idle')
        setCalibrationStepStartedAt(null)
        setCalibrationElapsedSeconds(0)
        return
      }
      const currentStep = calibrationProtocol[calibrationStepIndexRef.current]
      const elapsedSeconds = (Date.now() - calibrationStepStartedAt) / 1000
      setCalibrationElapsedSeconds(elapsedSeconds)
      if (elapsedSeconds >= currentStep.durationSeconds) {
        advanceCalibrationStep()
      }
    }, 250)

    return () => window.clearInterval(interval)
  }, [advanceCalibrationStep, board.status, calibrationStatus, calibrationStepStartedAt])

  useEffect(() => {
    if (board.status !== 'streaming' || replay) {
      return undefined
    }
    if (!dspControlsValid) {
      return undefined
    }

    let cancelled = false

    async function loadDsp() {
      try {
        const next = await api.dspSummary({
          windowSize: dspWindowSize,
          bandpassLowHz: dspBandpassLowHz,
          bandpassHighHz: dspBandpassHighHz,
          notchFrequencyHz: dspNotchEnabled ? dspNotchFrequencyHz : null,
        })
        if (!cancelled) {
          setDsp(next)
          const focusScore = buildFocusFeedback(next, signalQualityRef.current).score
          if (typeof focusScore === 'number') {
            setFocusTrend((current) => [...current.slice(-39), focusScore])
          }
        }
      } catch {
        if (!cancelled) setDsp(null)
      }
    }

    void loadDsp()
    const interval = window.setInterval(loadDsp, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    board.status,
    board.connection_id,
    replay,
    dspWindowSize,
    dspBandpassLowHz,
    dspBandpassHighHz,
    dspNotchEnabled,
    dspNotchFrequencyHz,
    dspControlsValid,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadBaseline() {
      try {
        const next = await api.calmBaseline()
        if (!cancelled) setCalmBaseline(next)
      } catch {
        if (!cancelled) setCalmBaseline(emptyCalmBaseline)
      }
    }

    void loadBaseline()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (board.status !== 'streaming' || (replay && activeView !== 'doctor-demo')) {
      return undefined
    }

    let cancelled = false

    async function loadCalm() {
      try {
        const [baselineResponse, calmResponse] = await Promise.all([
          api.calmBaseline(),
          api.calmFeatures(lineFrequencyHz),
        ])
        if (cancelled) return
        setCalmBaseline(baselineResponse)
        setCalm(calmResponse)
        if (typeof calmResponse.calm_score === 'number') {
          setCalmTrend((current) => [...current.slice(-39), calmResponse.calm_score ?? 0])
        }
      } catch {
        if (!cancelled) setCalm(null)
      }
    }

    void loadCalm()
    const interval = window.setInterval(loadCalm, 1000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeView, board.status, board.connection_id, lineFrequencyHz, replay])

  useEffect(() => {
    if (board.status !== 'streaming' || replay) {
      return undefined
    }

    let cancelled = false

    async function loadSignalQuality() {
      try {
        const next = await api.signalQuality(500, lineFrequencyHz)
        if (!cancelled) {
          setSignalQuality(next)
          const clarityScore = buildClarityFeedback(dspRef.current, next).score
          if (typeof clarityScore === 'number') {
            setClarityTrend((current) => [...current.slice(-39), clarityScore])
          }
        }
      } catch {
        if (!cancelled) setSignalQuality(null)
      }
    }

    void loadSignalQuality()
    const interval = window.setInterval(loadSignalQuality, 1500)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [board.status, board.connection_id, lineFrequencyHz, replay])

  const visibleChannels = useMemo(() => stream.channels.slice(0, 8), [stream.channels])
  const replayChannels = useMemo(() => buildReplayChannels(replay), [replay])
  const displayedChannels = replay ? replayChannels.slice(0, 8) : visibleChannels
  const replayCalm = useMemo(
    () => buildReplayCalmState(replay, replayAnalysis),
    [replay, replayAnalysis],
  )
  const replayCalmTrend = useMemo(
    () => buildReplayCalmTrend(replayAnalysis),
    [replayAnalysis],
  )
  const visibleDsp = replay
    ? replayAnalysis
    : board.status === 'streaming' && dspControlsValid
      ? dsp
      : null
  const visibleSignalQuality =
    board.status === 'streaming' && !replay ? signalQuality : null
  const visibleCalm = replay ? replayCalm : board.status === 'streaming' ? calm : null
  const feedbackRequestedWindowSize = replay ? replayWindowSize : undefined
  const feedbackStates = useMemo(
    () => ({
      calm: buildCalmFeedback(visibleCalm),
      focus: buildFocusFeedback(
        visibleDsp,
        visibleSignalQuality,
        feedbackRequestedWindowSize,
      ),
      clarity: buildClarityFeedback(
        visibleDsp,
        visibleSignalQuality,
        feedbackRequestedWindowSize,
      ),
    }),
    [feedbackRequestedWindowSize, visibleCalm, visibleDsp, visibleSignalQuality],
  )
  const feedbackTrend = useMemo(() => {
    if (replay) {
      if (feedbackMode === 'calm') return replayCalmTrend
      const replayScore = feedbackStates[feedbackMode].score
      return typeof replayScore === 'number' ? [replayScore, replayScore] : []
    }
    if (feedbackMode === 'focus') return focusTrend
    if (feedbackMode === 'clarity') return clarityTrend
    return calmTrend
  }, [
    calmTrend,
    clarityTrend,
    feedbackMode,
    feedbackStates,
    focusTrend,
    replay,
    replayCalmTrend,
  ])
  const qualityByChannel = useMemo(
    () =>
      new Map(
        visibleSignalQuality?.channels.map((channel) => [channel.index, channel]) ?? [],
      ),
    [visibleSignalQuality],
  )
  const qualityByLabel = useMemo(
    () =>
      new Map(
        visibleSignalQuality?.channels.map((channel) => [channel.label, channel]) ?? [],
      ),
    [visibleSignalQuality],
  )
  const visibleQualityChannels = useMemo(
    () =>
      displayedChannels
        .map((channel) => qualityByChannel.get(channel.index))
        .filter((channel): channel is SignalQualityChannel => Boolean(channel)),
    [displayedChannels, qualityByChannel],
  )
  const visibleQualityCounts = useMemo(
    () => countQualityChannels(visibleQualityChannels),
    [visibleQualityChannels],
  )
  const wearerStatus = useMemo(
    () => (replay ? replayReadiness(replay) : wearerReadiness(visibleQualityChannels)),
    [replay, visibleQualityChannels],
  )
  const dspBands = useMemo(() => aggregateBandPowers(visibleDsp), [visibleDsp])
  const dominantDspChannel = useMemo<DspChannelSummary | null>(() => {
    if (!visibleDsp?.channels.length) return null
    return visibleDsp.channels.reduce((best, channel) =>
      channel.total_power > best.total_power ? channel : best,
    )
  }, [visibleDsp])
  const selectedPortInfo = useMemo(
    () => ports.find((port) => port.device === selectedPort) ?? null,
    [ports, selectedPort],
  )
  const recommendedPort = useMemo(() => chooseRecommendedPort(ports), [ports])
  const canUseSerialPort = selectedBoard !== 'synthetic'
  const deviceSelectionLocked = isDeviceSelectionLocked(board.status)
  const hardwareStatus = canUseSerialPort
    ? selectedPortInfo?.message ||
      (ports.length ? 'No recommended OpenBCI port' : 'No serial ports found')
    : 'Synthetic board uses no serial port'
  const canStart = board.status === 'prepared'
  const canStop = board.status === 'streaming'
  const canRecord = board.status === 'streaming'
  const setupSnapshotCount = recording.setup_quality_snapshots.length
  const latestSetupSnapshot =
    setupSnapshotCount > 0 ? recording.setup_quality_snapshots[setupSnapshotCount - 1] : null
  const hasQualityWindow = Boolean(visibleSignalQuality?.channels.length)
  const canCaptureSetupQuality = recording.active && board.status === 'streaming' && hasQualityWindow
  const canSaveRecording = recording.active && setupSnapshotCount > 0
  const activeCalibrationStep = calibrationProtocol[calibrationStepIndex] ?? calibrationProtocol[0]
  const canRunCalibration = board.status === 'streaming' && !replay
  const canExportCalibration = calibrationMarkers.length > 0
  const persistedCalibrationMarkerCount = recording.calibration_markers.length
  const replayTotalRows = replay?.total_rows || replay?.recording.sample_count || 0
  const maxReplayOffset = Math.max(0, replayTotalRows - replayWindowSize)
  const replayStart = replay?.row_count ? replay.offset + 1 : 0
  const replayEnd = replay ? replay.offset + replay.row_count : 0
  const replayMarkers = replay?.recording.calibration_markers ?? []
  const replayTraceMarkers = replay
    ? replayMarkerPositions(replayMarkers, replay.offset, replay.row_count, 520)
    : []
  const activeReplayView = activeView === 'demo' ? 'demo' : 'console'

  async function runAction(action: () => Promise<BoardState>) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      loadedBoardRef.current = next
      setBoard(next)
      if (next.status === 'idle') {
        resetLiveFeedback()
      }
      if (next.status === 'streaming') {
        exitReplay()
      }
    } catch (actionError) {
      setError(formatBoardActionError(actionError))
      try {
        const failedBoard = await api.board()
        loadedBoardRef.current = failedBoard
        setBoard(failedBoard)
      } catch { /* Retain the recovery message. */ }
    } finally {
      setBusy(false)
    }
  }

  async function runRecordingAction(action: () => Promise<RecordingState>) {
    setRecordingBusy(true)
    setError(null)
    try {
      const next = await action()
      setRecording(next)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Recording request failed')
    } finally {
      setRecordingBusy(false)
    }
  }

  async function stopAndRefreshRecordings() {
    const next = await api.stopRecording()
    try {
      setRecordings(await api.recordings())
    } catch {
      setError('Recording saved, but the recordings list could not refresh')
    }
    return next
  }

  async function captureSetupQuality() {
    await runRecordingAction(() =>
      api.captureRecordingSetupQuality({
        label: 'Pre-save setup quality',
        window_size: 500,
        line_frequency_hz: lineFrequencyHz,
      }),
    )
  }

  async function loadReplayWindow(
    sessionId: string,
    offset: number,
    windowSize = replayWindowSize,
    view: 'console' | 'demo' = activeReplayView,
  ) {
    const request = ++replayRequestRef.current
    const safeOffset = Math.max(0, offset)
    setReplayBusy(true)
    setError(null)
    try {
      const [nextReplay, nextAnalysis] = await Promise.all([
        api.recordingPreview(sessionId, windowSize, safeOffset),
        api.recordingAnalysis(sessionId, windowSize, safeOffset, lineFrequencyHz),
      ])
      if (request !== replayRequestRef.current) return
      setReplay(nextReplay)
      setReplayAnalysis(nextAnalysis)
      setActiveView(view)
    } catch (previewError) {
      if (request === replayRequestRef.current) {
        setError(previewError instanceof Error ? previewError.message : 'Preview request failed')
      }
    } finally {
      if (request === replayRequestRef.current) setReplayBusy(false)
    }
  }

  async function previewRecording(sessionId: string) {
    await loadReplayWindow(sessionId, 0, replayWindowSize, 'console')
  }

  async function demoRecording(sessionId: string) {
    await loadReplayWindow(sessionId, 0, replayWindowSize, 'demo')
  }

  async function seekReplayWindow(offset: number) {
    const sessionId = replay?.recording.session_id
    if (!sessionId) return
    await loadReplayWindow(
      sessionId,
      Math.min(Math.max(0, offset), maxReplayOffset),
      replayWindowSize,
      activeReplayView,
    )
  }

  async function jumpToReplayMarker(marker: RecordingCalibrationMarker) {
    const sessionId = replay?.recording.session_id
    if (!sessionId) return
    await loadReplayWindow(
      sessionId,
      markerReplayOffset(marker, replayWindowSize, replayTotalRows),
      replayWindowSize,
      activeReplayView,
    )
  }

  async function changeReplayWindowSize(windowSize: number) {
    setReplayWindowSize(windowSize)
    const sessionId = replay?.recording.session_id
    if (!sessionId) return
    const nextOffset = Math.min(replay.offset, Math.max(0, replayTotalRows - windowSize))
    await loadReplayWindow(sessionId, nextOffset, windowSize, activeReplayView)
  }

  async function startCalmBaseline() {
    setBaselineBusy(true)
    setError(null)
    setCalmTrend([])
    try {
      const durationSeconds =
        board.board === 'synthetic'
          ? syntheticDemoBaselineDurationSeconds
          : hardwareBaselineDurationSeconds
      const next = await api.startCalmBaseline({
        duration_seconds: durationSeconds,
        label: 'Calm Mirror baseline',
        line_frequency_hz: lineFrequencyHz,
      })
      setCalmBaseline(next)
    } catch (baselineError) {
      setError(baselineError instanceof Error ? baselineError.message : 'Baseline request failed')
    } finally {
      setBaselineBusy(false)
    }
  }

  async function resetCalmBaseline() {
    setBaselineBusy(true)
    setError(null)
    setCalmTrend([])
    try {
      const next = await api.resetCalmBaseline()
      setCalmBaseline(next)
      setCalm(null)
    } catch (baselineError) {
      setError(baselineError instanceof Error ? baselineError.message : 'Baseline reset failed')
    } finally {
      setBaselineBusy(false)
    }
  }

  async function renameRecording(sessionId: string) {
    setRecordingBusy(true)
    setError(null)
    try {
      const next = await api.updateRecording(sessionId, {
        label: renameLabel.trim() || undefined,
      })
      setRecordings((current) =>
        current.map((saved) => (saved.session_id === sessionId ? next : saved)),
      )
      setRenamingSessionId(null)
      setRenameLabel('')
      if (replay?.recording.session_id === sessionId) {
        setReplay({ ...replay, recording: next })
      }
      if (recording.session_id === sessionId) {
        setRecording(next)
      }
      try {
        setRecordings(await api.recordings())
      } catch {
        setError('Recording renamed, but the recordings list could not refresh')
      }
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Rename request failed')
    } finally {
      setRecordingBusy(false)
    }
  }

  async function deleteRecording(sessionId: string) {
    if (!window.confirm('Delete this local recording?')) return

    setRecordingBusy(true)
    setError(null)
    try {
      await api.deleteRecording(sessionId)
      setRecordings((current) => current.filter((saved) => saved.session_id !== sessionId))
      if (replay?.recording.session_id === sessionId) {
        exitReplay()
      }
      if (recording.session_id === sessionId) {
        setRecording(emptyRecording)
      }
      if (renamingSessionId === sessionId) {
        setRenamingSessionId(null)
        setRenameLabel('')
      }
      try {
        const [nextRecording, nextRecordings] = await Promise.all([
          api.recording(),
          api.recordings(),
        ])
        setRecording(nextRecording)
        setRecordings(nextRecordings)
      } catch {
        setError('Recording deleted, but the recordings list could not refresh')
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete request failed')
    } finally {
      setRecordingBusy(false)
    }
  }

  function startRenaming(saved: RecordingState) {
    setRenamingSessionId(saved.session_id ?? null)
    setRenameLabel(saved.label || '')
  }

  function selectBoard(nextBoard: BoardKind) {
    setSelectedBoard(nextBoard)
    if (nextBoard === 'synthetic') {
      setSelectedPort('')
    } else if (!selectedPort) {
      setSelectedPort(recommendedPort?.device ?? '')
    }
  }

  function selectFeedbackMode(nextMode: FeedbackMode) {
    setFeedbackMode(nextMode)
    setFeedbackAudioVoice(defaultFeedbackAudioLoops[nextMode])
  }

  function applyFeedbackPreset(preset: FeedbackExperiencePreset) {
    setFeedbackMode(preset.mode)
    setVisualizerKind(preset.visualizer)
    setFeedbackAudioVoice(preset.audio)
  }

  return (
    <main className="app-shell">
      <div className="app-chrome">
        <header className="topbar">
          <div className="brand-lockup">
            <img className="brand-symbol" src="/nexus-symbol.svg" alt="" width="48" height="48" />
            <div>
              <h1 className="brand-logo">Dr K’s EEG Lab<span className="brand-edition">EEG WORKSPACE</span></h1>
              <p>Explore signals. Run experiments. Learn the maths.</p>
            </div>
          </div>
          <div className="topbar__status">
            <span className={`status-dot ${health?.status === 'ok' ? 'status-dot--ok' : ''}`} />
            <span>{health ? `API connected · v${health.version}` : API_BASE_URL}</span>
          </div>
        </header>

        {error ? (
          <section className="notice" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
          </section>
        ) : null}

        <nav className="view-tabs" aria-label="Workspace view">
          <button
            type="button"
            className={activeView === 'console' ? 'view-tabs__button--active' : ''}
            aria-pressed={activeView === 'console'}
            onClick={() => setActiveView('console')}
          >
            <Activity size={16} />
            Console
          </button>
          <button
            type="button"
            className={activeView === 'demo' ? 'view-tabs__button--active' : ''}
            aria-pressed={activeView === 'demo'}
            onClick={() => setActiveView('demo')}
          >
            <Headphones size={16} />
            Feedback Lab
          </button>
          <button
            type="button"
            className={activeView === 'doctor-demo' ? 'view-tabs__button--active' : ''}
            aria-pressed={activeView === 'doctor-demo'}
            onClick={() => setActiveView('doctor-demo')}
          >
            <BrainCircuit size={16} />
            Doctor Demo
          </button>
          <button type="button" className={activeView === 'experiment' ? 'view-tabs__button--active' : ''}
            aria-pressed={activeView === 'experiment'}
            onClick={() => {
              if (calibrationStatus === 'running') stopCalibrationProtocol()
              setActiveView('experiment')
            }}>
            <BrainCircuit size={16} />Experiment Lab
          </button>
          <button type="button" className={activeView === 'help' ? 'view-tabs__button--active' : ''}
            aria-pressed={activeView === 'help'}
            onClick={() => {
              if (calibrationStatus === 'running') stopCalibrationProtocol()
              setActiveView('help')
            }}>
            <BookOpen size={16} />Help
          </button>
        </nav>
      </div>

      <section className={`workspace ${activeView === 'help' ? 'workspace--help' : activeView === 'doctor-demo' || activeView === 'experiment' ? 'workspace--doctor-demo' : ''}`}>
        <aside className="panel controls-panel">
          <div className="panel__header">
            <Cable size={18} />
            <h2>Device</h2>
          </div>

          <label>
            <span>Board</span>
            <select
              name="board-kind"
              value={selectedBoard}
              onChange={(event) => selectBoard(event.target.value as BoardKind)}
              disabled={busy || deviceSelectionLocked}
            >
              <option value="synthetic">Synthetic</option>
              <option value="cyton">Cyton</option>
              <option value="cyton_daisy">Cyton Daisy</option>
            </select>
          </label>

          <label>
            <span>Serial port</span>
            <select
              name="serial-port"
              value={selectedPort}
              onChange={(event) => setSelectedPort(event.target.value)}
              disabled={!canUseSerialPort || busy || deviceSelectionLocked}
            >
              <option value="">Select /dev/cu.*</option>
              {ports.map((port) => (
                <option value={port.device} key={port.device}>
                  {formatPort(port)}
                </option>
              ))}
            </select>
          </label>

          <div className={`hardware-box ${selectedPortInfo?.recommended ? 'hardware-box--ready' : ''}`}>
            {selectedPortInfo?.recommended ? <CircleCheck size={18} /> : <Cable size={18} />}
            <div>
              <strong>{selectedPortInfo?.device ?? 'Port readiness'}</strong>
              <span>{hardwareStatus}</span>
            </div>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => refresh()} disabled={busy}>
              <RefreshCw size={16} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() =>
                runAction(() =>
                  api.connect({
                    board: selectedBoard,
                    serial_port: canUseSerialPort ? selectedPort : undefined,
                  }),
                )
              }
              disabled={busy || deviceSelectionLocked || (canUseSerialPort && !selectedPortInfo)}
            >
              <PlugZap size={16} />
              Connect
            </button>
          </div>

          <div className="button-row">
            <button type="button" onClick={() => runAction(api.start)} disabled={busy || !canStart}>
              <Play size={16} />
              Start
            </button>
            <button type="button" onClick={() => runAction(api.stop)} disabled={busy || !canStop}>
              <Pause size={16} />
              Stop
            </button>
            <button
              type="button"
              onClick={() => runAction(api.disconnect)}
              disabled={busy || board.status === 'idle'}
            >
              <Square size={16} />
              Reset
            </button>
          </div>

          <div className="recording-controls">
            <label>
              <span>Session label</span>
              <input
                name="recording-label"
                value={recordingLabel}
                onChange={(event) => setRecordingLabel(event.target.value)}
                placeholder="Baseline eyes open"
                disabled={recordingBusy || recording.active}
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                onClick={() =>
                  runRecordingAction(() =>
                    api.startRecording({ label: recordingLabel.trim() || undefined }),
                  )
                }
                disabled={recordingBusy || !canRecord || recording.active}
              >
                <CircleDot size={16} />
                Record
              </button>
              <button
                type="button"
                onClick={() => runRecordingAction(stopAndRefreshRecordings)}
                disabled={recordingBusy || !canSaveRecording}
              >
                <Square size={16} />
                Save
              </button>
            </div>
            {recording.message && <p role="alert">{recording.message}</p>}
            <div className="setup-guide" aria-label="Guided baseline setup">
              <div>
                <span
                  className={`quality-dot ${setupStepTone(board.status === 'streaming', board.status === 'prepared')}`}
                />
                <strong>Stream</strong>
                <small>{board.status === 'streaming' ? 'live' : board.status}</small>
              </div>
              <div>
                <span className={`quality-dot ${setupStepTone(recording.active, canRecord)}`} />
                <strong>Record</strong>
                <small>{recording.active ? `${recording.sample_count} samples` : 'idle'}</small>
              </div>
              <div>
                <span
                  className={`quality-dot ${setupStepTone(setupSnapshotCount > 0, recording.active)}`}
                />
                <strong>Setup</strong>
                <small>
                  {latestSetupSnapshot
                    ? `${latestSetupSnapshot.good_channels}/${latestSetupSnapshot.channels.length} good`
                    : hasQualityWindow
                    ? 'ready'
                    : 'pending'}
                </small>
              </div>
            </div>
            <button
              type="button"
              className="setup-capture-button"
              onClick={() => void captureSetupQuality()}
              disabled={recordingBusy || !canCaptureSetupQuality}
            >
              <CircleCheck size={16} />
              Capture setup
            </button>
            <CalibrationCuePanel
              status={calibrationStatus}
              activeStep={activeCalibrationStep}
              elapsedSeconds={calibrationElapsedSeconds}
              markers={calibrationMarkers}
              persistedCount={persistedCalibrationMarkerCount}
              recordingActive={recording.active}
              canRun={canRunCalibration}
              canExport={canExportCalibration}
              onStart={startCalibrationProtocol}
              onStop={stopCalibrationProtocol}
              onExport={exportCalibrationMarkers}
            />
          </div>
        </aside>

        {activeView === 'console' ? (
          <section className="signal-surface" aria-label="Live signal traces">
            <div className="signal-surface__header">
              <div>
                <h2>{replay ? 'Replay' : 'Live EEG'}</h2>
                <p>
                  {replay
                    ? `${replay.recording.label ?? replay.recording.session_id} · ${replayStart}-${replayEnd} of ${replayTotalRows} samples`
                    : `${formatBoardName(board.board)} · ${board.sampling_rate ?? 0} Hz`}
                </p>
              </div>
              <div className="surface-actions">
                {replay ? (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={exitReplay}
                  >
                    <Radio size={14} />
                    Live
                  </button>
                ) : null}
                <span className={`state-pill ${replay ? 'status--prepared' : statusTone(board.status)}`}>
                  <Radio size={14} />
                  {replay ? 'replay' : board.status}
                </span>
              </div>
            </div>

            {replay ? (
              <div className="replay-controls" aria-label="Replay timeline controls">
                <div className="replay-controls__timeline">
                  <label>
                    <span>Replay window</span>
                    <input
                      name="recording-replay-offset"
                      type="range"
                      min="0"
                      max={maxReplayOffset}
                      step="1"
                      value={Math.min(replay.offset, maxReplayOffset)}
                      onChange={(event) => void seekReplayWindow(Number(event.target.value))}
                      disabled={replayBusy || replayTotalRows <= replayWindowSize}
                    />
                  </label>
                  <small>
                    {replayStart}-{replayEnd} / {replayTotalRows}
                  </small>
                </div>
                <div className="replay-controls__actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void seekReplayWindow(replay.offset - replayWindowSize)}
                    disabled={replayBusy || replay.offset <= 0}
                    aria-label="Previous replay window"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void seekReplayWindow(replay.offset + replayWindowSize)}
                    disabled={replayBusy || replay.offset >= maxReplayOffset}
                    aria-label="Next replay window"
                  >
                    <SkipForward size={14} />
                  </button>
                  <label>
                    <span>Window</span>
                    <select
                      name="recording-replay-window-size"
                      value={replayWindowSize}
                      onChange={(event) => void changeReplayWindowSize(Number(event.target.value))}
                      disabled={replayBusy}
                    >
                      {replayWindowSizeOptions.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

            {replay ? (
              <ReplayMarkerStrip
                markers={replayMarkers}
                replayOffset={replay.offset}
                replayRowCount={replay.row_count}
                replayTotalRows={replayTotalRows}
                samplingRate={replay.recording.sampling_rate}
                replayBusy={replayBusy}
                onJumpToMarker={(marker) => void jumpToReplayMarker(marker)}
              />
            ) : null}

            <div className="wearer-validation" aria-label="Wearer validation">
              <div>
                <span className={`quality-dot ${wearerStatus.tone}`} />
                <div>
                  <strong className={wearerStatus.tone}>{wearerStatus.title}</strong>
                  <p>{wearerStatus.detail}</p>
                </div>
              </div>
              <div className="wearer-validation__stats">
                <span>
                  <strong>{visibleQualityCounts.good}</strong>
                  Good
                </span>
                <span>
                  <strong>{visibleQualityCounts.questionable}</strong>
                  Check
                </span>
                <span>
                  <strong>{visibleQualityCounts.bad}</strong>
                  Bad
                </span>
              </div>
            </div>

            <HeadsetFitGuide
              channels={displayedChannels}
              qualityByLabel={qualityByLabel}
              sourceLabel={replay ? 'replay' : 'live'}
            />

            <div className="trace-grid">
              {displayedChannels.length ? (
                displayedChannels.map((channel, index) => {
                  const quality = qualityByChannel.get(channel.index)
                  return (
                    <article
                      className={`trace-card ${quality ? `trace-card--${quality.status}` : ''}`}
                      key={channel.index}
                    >
                      <div className="trace-card__meta">
                        <span>{channel.label}</span>
                        <small>ADC {channel.index}</small>
                        {quality ? (
                          <div className="trace-quality">
                            <span className={`quality-dot ${qualityTone(quality.status)}`} />
                            <strong className={qualityTone(quality.status)}>
                              {quality.status}
                            </strong>
                            <small>{Math.round(quality.filtered_rms)} uV EEG</small>
                            <em>{formatIssues(quality.issues)}</em>
                          </div>
                        ) : null}
                      </div>
                      <svg viewBox="0 0 520 84" role="img" aria-label={`${channel.label} trace`}>
                        <path className="trace-gridline" d="M 0 42 L 520 42" />
                        <path
                          className={`trace-line trace-line--${index % 4}`}
                          d={buildPath(channel.samples, 520, 84, replay ? 0 : 160)}
                        />
                        {replayTraceMarkers.map(({ marker, x }) => {
                          const labelX = x > 438 ? x - 6 : x + 6
                          return (
                            <g
                              className="trace-marker"
                              key={`${marker.captured_at}-${marker.step_id}`}
                            >
                              <title>
                                {marker.label} at {formatMarkerTime(marker, replay?.recording.sampling_rate)}
                              </title>
                              <path d={`M ${x.toFixed(2)} 8 L ${x.toFixed(2)} 76`} />
                              <circle cx={x} cy="42" r="3.5" />
                              {index === 0 ? (
                                <text
                                  x={labelX}
                                  y="14"
                                  textAnchor={x > 438 ? 'end' : 'start'}
                                >
                                  {marker.label}
                                </text>
                              ) : null}
                            </g>
                          )
                        })}
                      </svg>
                    </article>
                  )
                })
              ) : (
                <div className="empty-state">
                  <Waves size={32} />
                  <span>
                    {board.status === 'streaming' ? 'Waiting for samples' : 'No active stream'}
                  </span>
                </div>
              )}
            </div>
          </section>
        ) : activeView === 'demo' ? (
          <CalmMirrorSurface
            board={board}
            streamTimestamp={stream.timestamps.at(-1) ?? null}
            displayedChannels={displayedChannels}
            visibleQualityChannels={visibleQualityChannels}
            qualityByLabel={qualityByLabel}
            calm={visibleCalm}
            baseline={replay ? replayCalm?.baseline ?? emptyCalmBaseline : calmBaseline}
            feedbackMode={feedbackMode}
            feedbackStates={feedbackStates}
            feedbackTrend={feedbackTrend}
            feedbackBands={dspBands}
            visualizerKind={visualizerKind}
            audioVoice={feedbackAudioVoice}
            replay={replay}
            replayBusy={replayBusy}
            replayWindowSize={replayWindowSize}
            replayStart={replayStart}
            replayEnd={replayEnd}
            replayTotalRows={replayTotalRows}
            maxReplayOffset={maxReplayOffset}
            onSeekReplayWindow={(offset) => void seekReplayWindow(offset)}
            onChangeReplayWindowSize={(windowSize) => void changeReplayWindowSize(windowSize)}
            onFeedbackModeChange={selectFeedbackMode}
            onVisualizerChange={setVisualizerKind}
            onAudioVoiceChange={setFeedbackAudioVoice}
            onApplyPreset={applyFeedbackPreset}
            onStartBaseline={startCalmBaseline}
            onResetBaseline={resetCalmBaseline}
            baselineBusy={baselineBusy}
          />
        ) : null}

        {activeView === 'help' && <StudentHelp />}

        <div hidden={activeView !== 'experiment'}>
          <ExperimentLab active={activeView === 'experiment'} board={board} lineFrequencyHz={lineFrequencyHz}
            onConsole={() => setActiveView('console')} onRecording={setRecording} />
        </div>

        <div className="doctor-demo-host" hidden={activeView !== 'doctor-demo'}>
          <DoctorDemo
            active={activeView === 'doctor-demo'}
            board={board}
            calm={board.status === 'streaming' ? calm : null}
            latestStreamTimestamp={stream.timestamps.at(-1) ?? null}
            recordingSessionId={recording.active ? recording.session_id : null}
          />
        </div>

        <aside className="panel metrics-panel">
          <div className="panel__header">
            <Activity size={18} />
            <h2>Telemetry</h2>
          </div>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{board.status}</dd>
            </div>
            <div>
              <dt>Samples</dt>
              <dd>{stream.sample_count}</dd>
            </div>
            <div>
              <dt>Channels</dt>
              <dd>{board.eeg_channels.length || stream.channels.length}</dd>
            </div>
            <div>
              <dt>Port</dt>
              <dd>{board.serial_port ?? 'local'}</dd>
            </div>
          </dl>
          <div className="runtime-box">
            <Cpu size={18} />
            <span>{STREAM_WS_URL.replace(/^wss?:\/\//, '')}</span>
          </div>
          <div className="quality-box">
            <div className="quality-box__header">
              <Gauge size={18} />
              <div>
                <strong>Quality</strong>
                <span>
                  {visibleSignalQuality?.sample_count
                    ? `${visibleSignalQuality.sample_count} samples · ${visibleSignalQuality.good_channels}/${visibleSignalQuality.channels.length} good`
                    : 'No summary'}
                </span>
              </div>
            </div>
            {visibleSignalQuality?.channels.length ? (
              <>
                <div className="quality-counts">
                  <span className="quality--good">{visibleSignalQuality.good_channels} good</span>
                  <span className="quality--questionable">
                    {visibleSignalQuality.questionable_channels} check
                  </span>
                  <span className="quality--bad">{visibleSignalQuality.bad_channels} bad</span>
                </div>
                <div className="quality-list">
                  {(visibleQualityChannels.length
                    ? visibleQualityChannels
                    : visibleSignalQuality.channels.slice(0, 8)
                  ).map((channel) => (
                    <div className="quality-row" key={channel.index}>
                      <span className={`quality-dot ${qualityTone(channel.status)}`} />
                      <strong>{channel.label}</strong>
                      <small>{Math.round(channel.filtered_rms)} uV</small>
                      <em>{formatIssues(channel.issues)}</em>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p>{board.status === 'streaming' ? 'Waiting for quality window' : 'Start stream'}</p>
            )}
          </div>
          <div className="dsp-box">
            <div className="dsp-box__header">
              <BarChart3 size={18} />
              <div>
                <strong>DSP</strong>
                <span>
                  {visibleDsp?.sample_count
                    ? `${visibleDsp.sample_count} samples · ${visibleDsp.bandpass_low_hz.toFixed(1)}-${visibleDsp.bandpass_high_hz.toFixed(1)} Hz`
                    : 'No summary'}
                </span>
              </div>
            </div>
            {!replay ? (
              <div className="dsp-controls" aria-label="DSP controls">
                <label>
                  <span>Window</span>
                  <select
                    name="dsp-window-size"
                    value={dspWindowSize}
                    onChange={(event) => setDspWindowSize(Number(event.target.value))}
                  >
                    {dspWindowSizeOptions.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Low Hz</span>
                  <input
                    name="dsp-bandpass-low-hz"
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.5"
                    value={Number.isFinite(dspBandpassLowHz) ? dspBandpassLowHz : ''}
                    onChange={(event) => setDspBandpassLowHz(event.currentTarget.valueAsNumber)}
                  />
                </label>
                <label>
                  <span>High Hz</span>
                  <input
                    name="dsp-bandpass-high-hz"
                    type="number"
                    min="1"
                    max="120"
                    step="0.5"
                    value={Number.isFinite(dspBandpassHighHz) ? dspBandpassHighHz : ''}
                    onChange={(event) => setDspBandpassHighHz(event.currentTarget.valueAsNumber)}
                  />
                </label>
                <label className="dsp-controls__check">
                  <input
                    name="dsp-notch-enabled"
                    type="checkbox"
                    checked={dspNotchEnabled}
                    onChange={(event) => setDspNotchEnabled(event.target.checked)}
                  />
                  <span>Notch</span>
                </label>
                <label>
                  <span>Notch Hz</span>
                  <input
                    name="dsp-notch-frequency-hz"
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    value={Number.isFinite(dspNotchFrequencyHz) ? dspNotchFrequencyHz : ''}
                    onChange={(event) => setDspNotchFrequencyHz(event.currentTarget.valueAsNumber)}
                    disabled={!dspNotchEnabled}
                  />
                </label>
              </div>
            ) : null}
            {dspValidationMessage && !replay ? (
              <p className="dsp-warning">{dspValidationMessage}</p>
            ) : null}
            {visibleDsp?.channels.length ? (
              <>
                <div className="dsp-dominant">
                  <span>{dominantDspChannel?.label ?? 'Dominant'}</span>
                  <strong>
                    {dominantDspChannel?.dominant_frequency_hz
                      ? `${dominantDspChannel.dominant_frequency_hz.toFixed(1)} Hz`
                      : '0.0 Hz'}
                  </strong>
                </div>
                <div className="band-list">
                  {dspBands.map((band) => {
                    const percent = Math.max(0, Math.min(100, band.value * 100))
                    return (
                      <div className="band-row" key={band.name}>
                        <span>{band.name}</span>
                        <div className="band-meter" aria-hidden="true">
                          <i style={{ width: `${percent}%` }} />
                        </div>
                        <small>{Math.round(percent)}%</small>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p>{board.status === 'streaming' ? 'Waiting for DSP window' : 'Start stream'}</p>
            )}
          </div>
          <div className={`recording-box ${recording.active ? 'recording-box--active' : ''}`}>
            <FileText size={18} />
            <div>
              <strong>{recording.active ? 'Recording' : 'Latest recording'}</strong>
              <span>
                {recording.session_id
                  ? `${recording.sample_count} samples · ${setupSnapshotCount} setup · ${persistedCalibrationMarkerCount} markers · ${recording.session_id}`
                  : 'No local session yet'}
              </span>
            </div>
          </div>
          <div className="recording-list">
            <div className="recording-list__header">
              <FolderOpen size={18} />
              <strong>Recordings</strong>
            </div>
            {recordings.length ? (
              recordings.slice(0, 5).map((saved) => (
                <article className="recording-list__item" key={saved.session_id}>
                  {renamingSessionId === saved.session_id ? (
                    <div className="recording-rename">
                      <input
                        name={`recording-rename-${saved.session_id}`}
                        value={renameLabel}
                        onChange={(event) => setRenameLabel(event.target.value)}
                        maxLength={80}
                        placeholder="Session label"
                        disabled={recordingBusy}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => saved.session_id && renameRecording(saved.session_id)}
                        disabled={recordingBusy}
                        aria-label="Save recording label"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          setRenamingSessionId(null)
                          setRenameLabel('')
                        }}
                        disabled={recordingBusy}
                        aria-label="Cancel rename"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span>{saved.label || saved.session_id}</span>
                  )}
                  <small>
                    {saved.sample_count} samples · {saved.setup_quality_snapshots.length} setup ·{' '}
                    {saved.calibration_markers.length} markers
                  </small>
                  <div>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => saved.session_id && previewRecording(saved.session_id)}
                      disabled={replayBusy || !saved.session_id}
                    >
                      <Eye size={14} />
                      Preview
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => saved.session_id && demoRecording(saved.session_id)}
                      disabled={replayBusy || !saved.session_id}
                    >
                      <Headphones size={14} />
                      Demo
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => startRenaming(saved)}
                      disabled={recordingBusy || !saved.session_id}
                    >
                      <Pencil size={14} />
                      Rename
                    </button>
                    {saved.session_id ? (
                      <a className="mini-link" href={recordingDownloadUrl(saved.session_id)}>
                        <Download size={14} />
                        CSV
                      </a>
                    ) : null}
                    {saved.session_id && saved.calibration_markers.length ? (
                      <a
                        className="mini-link"
                        href={recordingCalibrationReportUrl(saved.session_id)}
                      >
                        <FileText size={14} />
                        Report
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="mini-button mini-button--danger"
                      onClick={() => saved.session_id && deleteRecording(saved.session_id)}
                      disabled={recordingBusy || !saved.session_id}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p>No saved sessions</p>
            )}
          </div>
        </aside>
      </section>
      <footer className="app-attribution">
        Nexus BCI · local EEG exploration · MIT software
      </footer>
    </main>
  )
}

export default App
