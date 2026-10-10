import { API_BASE_URL } from '../api'

export type Trial = {
  id: string
  label: string
  start_timestamp: number
  end_timestamp: number | null
  duration_seconds: number
  included: boolean
  issues: string[]
  note: string
}
export type Experiment = {
  schema_version: number
  session_id: string
  name: string
  participant: string
  labels: string[]
  channels: string[]
  board: string
  sampling_rate: number
  created_at: string
  status: 'recording' | 'saved' | 'interrupted'
  trials: Trial[]
}
export type Readiness = {
  ready: boolean
  clean_windows: number
  reason: string
  source_timestamp: number | null
}
export type Report = {
  id: string
  created_at: string
  method: string
  training_session_id: string
  test_session_id: string
  participant: string
  channels: string[]
  classes: string[]
  synthetic: boolean
  accuracy: number
  balanced_accuracy: number
  chance: number
  confusion_matrix: number[][]
  training_counts: Record<string, number>
  test_counts: Record<string, number>
  rejected_trials: Record<string, string[]>
  predictions: Array<{
    trial_id: string; actual: string; predicted: string; probabilities: Record<string, number>
  }>
  provenance: Record<string, unknown>
}

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(new URL(`/api/experiments${path}`, API_BASE_URL), {
    method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null
    throw new Error(typeof payload?.detail === 'string'
      ? payload.detail : `Request failed (${response.status}). Check the fields and try again.`)
  }
  return response.json() as Promise<T>
}
const path = (id: string) => `/${encodeURIComponent(id)}`
export const experimentApi = {
  list: () => request<Experiment[]>(''),
  get: (id: string) => request<Experiment>(path(id)),
  create: (body: { name: string; participant: string; labels: string[]; channels: string[] }) =>
    request<Experiment>('', body),
  readiness: (id: string) => request<Readiness>(`${path(id)}/readiness`),
  start: (id: string, body: { id: string; label: string; duration_seconds: number }) =>
    request<Experiment>(`${path(id)}/trials`, body),
  finish: (id: string, trialId: string, aborted: boolean) =>
    request<Experiment>(`${path(id)}/trials/${encodeURIComponent(trialId)}/finish`, { aborted }),
  edit: (id: string, trialId: string, body: Pick<Trial, 'label' | 'included' | 'note'>) =>
    request<Experiment>(`${path(id)}/trials/${encodeURIComponent(trialId)}`, body, 'PATCH'),
  stop: (id: string) => request<Experiment>(`${path(id)}/stop`, {}),
  evaluate: (training_session_id: string, test_session_id: string) =>
    request<Report>('/evaluate', { training_session_id, test_session_id }),
  reports: () => request<Report[]>('/reports'),
}
export type ExperimentClient = typeof experimentApi
