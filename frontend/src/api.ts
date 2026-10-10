import { DEFAULT_LINE_FREQUENCY_HZ } from './config'

export type BoardKind = 'synthetic' | 'cyton' | 'cyton_daisy'
export type BoardStatus = 'idle' | 'prepared' | 'streaming' | 'error'
export type SignalQualityStatus = 'good' | 'questionable' | 'bad'
export type CalmSignalState = 'unavailable' | 'noisy' | 'usable'
export type CalmCalibrationStatus = 'inactive' | 'running' | 'complete' | 'failed'

export type DemoEvent = {
  id: string
  name: string
  created_at: string
}

export type DemoRunCreateRequest = {
  client_run_id?: string | null
  participant_name: string
  participant_initials?: string | null
  open_alpha: number
  closed_alpha: number
  alpha_lift_percent: number
  threshold_alpha: number
  clean_hold_seconds: number
  confidence: number
  score: number
  scoring_version: string
  recording_session_id?: string | null
}

export type DemoRun = DemoRunCreateRequest & {
  id: string
  event_id: string
  participant_key?: string
  completed_at: string
  is_best: boolean
}

export type HealthResponse = {
  status: string
  service: string
  version: string
}

export type SerialPortInfo = {
  device: string
  name?: string | null
  description?: string | null
  manufacturer?: string | null
  serial_number?: string | null
  transport: string
  recommended: boolean
  rank: number
  message?: string | null
}

export type BoardState = {
  status: BoardStatus
  board?: BoardKind | null
  board_id?: number | null
  serial_port?: string | null
  sampling_rate?: number | null
  eeg_channels: number[]
  eeg_names: string[]
  message?: string | null
}

export type ChannelSnapshot = {
  index: number
  label: string
  samples: number[]
}

export type StreamSnapshot = {
  status: BoardStatus
  board?: BoardKind | null
  board_id?: number | null
  sample_count: number
  sampling_rate?: number | null
  timestamps: number[]
  channels: ChannelSnapshot[]
  message?: string | null
}

export type DspBandPower = {
  name: string
  low_hz: number
  high_hz: number
  power: number
  relative_power: number
}

export type DspChannelSummary = {
  index: number
  label: string
  sample_count: number
  rms: number
  dominant_frequency_hz?: number | null
  total_power: number
  band_powers: DspBandPower[]
}

export type DspSummary = {
  status: BoardStatus
  board?: BoardKind | null
  board_id?: number | null
  sample_count: number
  sampling_rate?: number | null
  window_size: number
  bandpass_low_hz: number
  bandpass_high_hz: number
  notch_frequency_hz?: number | null
  channels: DspChannelSummary[]
  message?: string | null
}

export type DspSummaryParams = {
  windowSize?: number
  bandpassLowHz?: number
  bandpassHighHz?: number
  notchFrequencyHz?: number | null
}

export type SignalQualityChannel = {
  index: number
  label: string
  status: SignalQualityStatus
  sample_count: number
  finite_sample_count: number
  finite_ratio: number
  mean: number
  rms: number
  filtered_rms: number
  standard_deviation: number
  peak_to_peak: number
  minimum: number
  maximum: number
  line_noise_ratio: number
  issues: string[]
}

export type SignalQuality = {
  status: BoardStatus
  board?: BoardKind | null
  board_id?: number | null
  sample_count: number
  sampling_rate?: number | null
  window_size: number
  line_frequency_hz: number
  good_channels: number
  questionable_channels: number
  bad_channels: number
  channels: SignalQualityChannel[]
  message?: string | null
}

export type RecordingSetupQualitySnapshot = {
  captured_at: string
  label?: string | null
  board?: BoardKind | null
  sampling_rate?: number | null
  sample_count: number
  window_size: number
  line_frequency_hz: number
  good_channels: number
  questionable_channels: number
  bad_channels: number
  channels: SignalQualityChannel[]
  message?: string | null
}

export type RecordingCalibrationMarker = {
  captured_at: string
  step_id: string
  label: string
  cue: string
  elapsed_seconds: number
  stream_sample_count: number
  recording_sample_index: number
  calm_score?: number | null
  confidence?: number | null
  alpha_post?: number | null
  high_frequency_ratio?: number | null
  signal_state?: CalmSignalState | null
  quality_good?: number | null
  quality_questionable?: number | null
  quality_bad?: number | null
}

export type RecordingCalibrationMarkerRequest = {
  step_id: string
  label: string
  cue: string
  elapsed_seconds: number
  stream_sample_count: number
  calm_score?: number | null
  confidence?: number | null
  alpha_post?: number | null
  high_frequency_ratio?: number | null
  signal_state?: CalmSignalState | null
  quality_good?: number | null
  quality_questionable?: number | null
  quality_bad?: number | null
}

export type CalmCalibrationStartRequest = {
  duration_seconds?: number
  label?: string
  line_frequency_hz?: number
  window_size?: number
  posterior_labels?: string[]
}

export type CalmCalibrationState = {
  status: CalmCalibrationStatus
  label?: string | null
  started_at?: string | null
  completed_at?: string | null
  elapsed_seconds: number
  target_duration_seconds: number
  accepted_windows: number
  required_windows: number
  baseline_median?: number | null
  baseline_mad?: number | null
  line_frequency_hz: number
  window_size: number
  posterior_labels: string[]
  message?: string | null
}

export type CalmFeatureResponse = {
  status: BoardStatus
  board?: BoardKind | null
  board_id?: number | null
  sample_count: number
  source_timestamp?: number | null
  sampling_rate?: number | null
  window_size: number
  line_frequency_hz: number
  posterior_labels: string[]
  used_labels: string[]
  signal_state: CalmSignalState
  confidence: number
  calm_score?: number | null
  trend?: number | null
  flags: string[]
  features: Record<string, number>
  baseline: CalmCalibrationState
  message?: string | null
}

export type RecordingState = {
  active: boolean
  session_id?: string | null
  label?: string | null
  file_path?: string | null
  metadata_path?: string | null
  started_at?: string | null
  stopped_at?: string | null
  sample_count: number
  board?: BoardKind | null
  board_id?: number | null
  sampling_rate?: number | null
  eeg_names: string[]
  setup_quality_snapshots: RecordingSetupQualitySnapshot[]
  calibration_markers: RecordingCalibrationMarker[]
  message?: string | null
}

export type RecordingPreview = {
  recording: RecordingState
  headers: string[]
  rows: number[][]
  offset: number
  row_count: number
  total_rows: number
}

export type RecordingCalibrationMarkerWindow = {
  marker: RecordingCalibrationMarker
  headers: string[]
  rows: number[][]
  offset: number
  row_count: number
  total_rows: number
  marker_row_offset?: number | null
}

export type RecordingCalibrationReport = {
  generated_at: string
  recording: RecordingState
  headers: string[]
  context_samples: number
  total_rows: number
  marker_windows: RecordingCalibrationMarkerWindow[]
  message?: string | null
}

export type RecordingSpectralAnalysis = {
  recording: RecordingState
  sample_count: number
  total_rows: number
  offset: number
  sampling_rate?: number | null
  bandpass_low_hz: number
  bandpass_high_hz: number
  notch_frequency_hz?: number | null
  channels: DspChannelSummary[]
  message?: string | null
}

export type RecordingDeleteResponse = {
  session_id: string
  deleted: boolean
}

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

export const API_BASE_URL = configuredBaseUrl ?? 'http://localhost:8000'

export const STREAM_WS_URL = (() => {
  const url = new URL('/ws/stream', API_BASE_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
})()

export function recordingDownloadUrl(sessionId: string) {
  return new URL(`/api/recordings/${sessionId}/download`, API_BASE_URL).toString()
}

export function recordingCalibrationReportUrl(sessionId: string, contextSamples = 250) {
  const url = new URL(`/api/recordings/${sessionId}/calibration-report`, API_BASE_URL)
  url.searchParams.set('context_samples', String(contextSamples))
  return url.toString()
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, API_BASE_URL), {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  ports: () => request<SerialPortInfo[]>('/api/ports'),
  board: () => request<BoardState>('/api/board'),
  calibrationCueSpeech: async (payload: { transcript: string; speed?: number; volume?: number }) => {
    const response = await fetch(new URL('/api/calibration/cue-speech', API_BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || `${response.status} ${response.statusText}`)
    }

    return response.blob()
  },
  connect: (payload: { board: BoardKind; serial_port?: string }) =>
    request<BoardState>('/api/board/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  start: () =>
    request<BoardState>('/api/board/start', {
      method: 'POST',
      body: JSON.stringify({ buffer_size: 450000 }),
    }),
  stop: () =>
    request<BoardState>('/api/board/stop', {
      method: 'POST',
    }),
  disconnect: () =>
    request<BoardState>('/api/board/disconnect', {
      method: 'POST',
    }),
  recording: () => request<RecordingState>('/api/recordings/current'),
  recordings: () => request<RecordingState[]>('/api/recordings'),
  dspSummary: ({
    windowSize = 500,
    bandpassLowHz = 1,
    bandpassHighHz = 45,
    notchFrequencyHz = DEFAULT_LINE_FREQUENCY_HZ,
  }: DspSummaryParams = {}) => {
    const params = new URLSearchParams({
      window_size: String(windowSize),
      bandpass_low_hz: String(bandpassLowHz),
      bandpass_high_hz: String(bandpassHighHz),
      notch_enabled: String(notchFrequencyHz !== null),
    })
    if (notchFrequencyHz !== null) {
      params.set('notch_frequency_hz', String(notchFrequencyHz))
    }
    return request<DspSummary>(`/api/dsp/summary?${params.toString()}`)
  },
  signalQuality: (windowSize = 500, lineFrequencyHz = DEFAULT_LINE_FREQUENCY_HZ) =>
    request<SignalQuality>(
      `/api/signal/quality?window_size=${windowSize}&line_frequency_hz=${lineFrequencyHz}`,
    ),
  calmBaseline: () => request<CalmCalibrationState>('/api/demo/calm/baseline'),
  startCalmBaseline: (payload: CalmCalibrationStartRequest) =>
    request<CalmCalibrationState>('/api/demo/calm/baseline/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resetCalmBaseline: () =>
    request<CalmCalibrationState>('/api/demo/calm/baseline/reset', {
      method: 'POST',
    }),
  calmFeatures: (lineFrequencyHz = DEFAULT_LINE_FREQUENCY_HZ) =>
    request<CalmFeatureResponse>(`/api/demo/calm?line_frequency_hz=${lineFrequencyHz}`),
  demoEvents: () => request<DemoEvent[]>('/api/demo/events'),
  createDemoEvent: (payload: { name: string }) =>
    request<DemoEvent>('/api/demo/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  demoRuns: (eventId: string) =>
    request<DemoRun[]>(`/api/demo/events/${encodeURIComponent(eventId)}/runs`),
  createDemoRun: (eventId: string, payload: DemoRunCreateRequest) =>
    request<DemoRun>(`/api/demo/events/${encodeURIComponent(eventId)}/runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  recordingPreview: (sessionId: string, limit = 500, offset = 0) =>
    request<RecordingPreview>(
      `/api/recordings/${sessionId}/preview?limit=${limit}&offset=${offset}`,
    ),
  recordingAnalysis: (
    sessionId: string,
    limit = 1000,
    offset = 0,
    notchFrequencyHz = DEFAULT_LINE_FREQUENCY_HZ,
  ) =>
    request<RecordingSpectralAnalysis>(
      `/api/recordings/${sessionId}/analysis?limit=${limit}&offset=${offset}&notch_frequency_hz=${notchFrequencyHz}`,
    ),
  startRecording: (payload: { label?: string }) =>
    request<RecordingState>('/api/recordings/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  captureRecordingSetupQuality: (payload: {
    label?: string
    window_size?: number
    line_frequency_hz?: number
  }) =>
    request<RecordingState>('/api/recordings/current/setup-quality', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  captureRecordingCalibrationMarker: (payload: RecordingCalibrationMarkerRequest) =>
    request<RecordingState>('/api/recordings/current/calibration-markers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopRecording: () =>
    request<RecordingState>('/api/recordings/stop', {
      method: 'POST',
    }),
  updateRecording: (sessionId: string, payload: { label?: string }) =>
    request<RecordingState>(`/api/recordings/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteRecording: (sessionId: string) =>
    request<RecordingDeleteResponse>(`/api/recordings/${sessionId}`, {
      method: 'DELETE',
    }),
}
