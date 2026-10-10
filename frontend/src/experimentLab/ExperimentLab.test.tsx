import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExperimentLab } from './ExperimentLab'
import { nextLabel } from './protocol'
import type { Experiment, ExperimentClient, Report, Trial } from './api'
import { api, type BoardState } from '../api'

const board: BoardState = { status: 'streaming', board: 'synthetic', sampling_rate: 250, eeg_names: ['C3', 'C4', 'O1', 'O2'], eeg_channels: [1, 2, 3, 4] }
const trial: Trial = { id: 't1', label: 'Eyes open', start_timestamp: 100, end_timestamp: 106, duration_seconds: 6, included: true, issues: [], note: '' }
const session: Experiment = { schema_version: 1, session_id: 'session-1', name: 'Day 1', participant: 'P01', labels: ['Eyes open', 'Eyes closed'], channels: ['O1', 'O2'], board: 'synthetic', sampling_rate: 250, created_at: '2026-09-30T12:00:00Z', status: 'recording', trials: [] }
function clientFor(sessions: Experiment[] = [session]) {
  let current = structuredClone(sessions)
  const client = {
    list: vi.fn(async () => current),
    get: vi.fn(async () => current[0]),
    create: vi.fn(async () => current[0]),
    readiness: vi.fn(async () => ({ ready: true, clean_windows: 3, reason: 'Ready', source_timestamp: 100 })),
    start: vi.fn(async (_id, payload) => {
      current = [{ ...current[0], trials: [{ ...trial, ...payload, start_timestamp: 100, end_timestamp: null }] }]
      return current[0]
    }),
    finish: vi.fn(async (_id, id, aborted) => {
      current = [{ ...current[0], trials: [{ ...trial, id, included: !aborted, issues: aborted ? ['operator_aborted'] : [] }] }]
      return current[0]
    }),
    edit: vi.fn(async (_id, _trialId, payload) => {
      current = [{ ...current[0], trials: [{ ...trial, ...payload }] }]
      return current[0]
    }),
    stop: vi.fn(async () => ({ ...current[0], status: 'saved' as const })),
    reports: vi.fn(async (): Promise<Report[]> => []),
    evaluate: vi.fn(),
  } satisfies ExperimentClient
  return client
}
function show(client = clientFor()) {
  return { client, ...render(<ExperimentLab active board={board} onConsole={vi.fn()} onRecording={vi.fn()} client={client} />) }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('balances random task choices using only completed included trials', () => {
  expect(nextLabel({ ...session, trials: [trial] })).toBe('Eyes closed')
  expect(nextLabel({ ...session, trials: [{ ...trial, included: false }] }, () => 0)).toBe('Eyes open')
})

it('requires a streaming device before creating a recording', async () => {
  render(<ExperimentLab active board={{ ...board, status: 'idle' }} onConsole={vi.fn()} onRecording={vi.fn()} client={clientFor([])} />)
  await screen.findByText('Connect and start streaming in Console first.')
  expect(screen.getByRole('button', { name: 'Start labelled recording' })).toBeDisabled()
})

it('allows saved trials to be excluded and relabelled', async () => {
  const { client } = show(clientFor([{ ...session, status: 'saved', trials: [trial] }]))
  fireEvent.click(await screen.findByLabelText('Include trial t1'))
  await waitFor(() => expect(client.edit).toHaveBeenCalledWith('session-1', 't1', { label: 'Eyes open', included: false, note: '' }))
  await waitFor(() => expect(screen.getByLabelText('Include trial t1')).not.toBeChecked())
  fireEvent.change(screen.getByLabelText('Label for trial t1'), { target: { value: 'Eyes closed' } })
  await waitFor(() => expect(client.edit).toHaveBeenLastCalledWith('session-1', 't1', { label: 'Eyes closed', included: false, note: '' }))
})

it('does not allow training and testing on the same recording', async () => {
  const { client } = show(clientFor([{ ...session, status: 'saved' }]))
  await waitFor(() => expect(screen.getByLabelText('Training recording').querySelector('option[value="session-1"]')).not.toBeNull())
  fireEvent.change(screen.getByLabelText('Training recording'), { target: { value: 'session-1' } })
  expect(screen.getByLabelText('Test recording').querySelector('option[value="session-1"]')).toBeNull()
  expect(screen.getByRole('button', { name: 'Train pyRiemann & evaluate' })).toBeDisabled()
  expect(client.evaluate).not.toHaveBeenCalled()
})

describe('guided trial lifecycle', () => {
  async function ready() {
    const result = show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Record next trial' })).toBeEnabled())
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Record next trial' }))
    return result
  }
  it('labels a timed trial automatically and saves it exactly once', async () => {
    const { client } = await ready()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(client.start).toHaveBeenCalledTimes(1)
    expect(client.start.mock.calls[0][1].label).toMatch(/^Eyes (open|closed)$/)
    await act(async () => { await vi.advanceTimersByTimeAsync(6100) })
    expect(client.finish).toHaveBeenCalledTimes(1)
    expect(client.finish.mock.calls[0][2]).toBe(false)
  })
  it('excludes a trial when navigating away during capture', async () => {
    const { client, rerender } = await ready()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    rerender(<ExperimentLab active={false} board={board} onConsole={vi.fn()} onRecording={vi.fn()} client={client} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(client.finish).toHaveBeenCalledWith('session-1', expect.any(String), true)
  })
  it('does not send a trial marker if cancelled during the cue', async () => {
    const { client } = await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Stop & exclude trial' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(client.start).not.toHaveBeenCalled()
  })
})


it('opens the lesson without a headset and returns without changing recordings', async () => {
  const client = clientFor([])
  render(<ExperimentLab active board={{ ...board, status: 'idle' }} onConsole={vi.fn()} onRecording={vi.fn()} client={client} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'How the classifier works' }))
  expect(screen.getByRole('heading', { name: 'From a wave to a prediction' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to experiment' }))
  expect(screen.getByRole('button', { name: 'Start labelled recording' })).toBeDisabled()
  expect(client.create).not.toHaveBeenCalled()
  expect(client.evaluate).not.toHaveBeenCalled()
})

it('keeps the lesson closed while an experiment is recording', async () => {
  show()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record next trial' })).toBeEnabled())
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
})


it('blocks lesson entry until a delayed session refresh establishes recording state', async () => {
  const client = clientFor([])
  let resolveSessions!: (sessions: Experiment[]) => void
  client.list.mockImplementation(() => new Promise(resolve => { resolveSessions = resolve }))
  show(client)
  const lesson = screen.getByRole('button', { name: 'How the classifier works' })
  expect(lesson).toBeDisabled()
  fireEvent.click(lesson)
  expect(screen.queryByRole('heading', { name: 'From a wave to a prediction' })).not.toBeInTheDocument()
  await waitFor(() => expect(client.list).toHaveBeenCalledOnce())
  await act(async () => { resolveSessions([session]) })
  expect(lesson).toBeDisabled()
})

it('closes the lesson if returning to the lab discovers a newly active recording', async () => {
  const client = clientFor([])
  const props = { board, onConsole: vi.fn(), onRecording: vi.fn(), client }
  const { rerender } = render(<ExperimentLab {...props} active />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'How the classifier works' }))
  rerender(<ExperimentLab {...props} active={false} />)
  client.list.mockResolvedValue([session])
  rerender(<ExperimentLab {...props} active />)
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'From a wave to a prediction' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
})


it('ignores an older empty response after a newer refresh discovers an active recording', async () => {
  const client = clientFor([])
  const responses: Array<(sessions: Experiment[]) => void> = []
  client.list.mockImplementation(() => new Promise(resolve => { responses.push(resolve) }))
  const props = { board, onConsole: vi.fn(), onRecording: vi.fn(), client }
  const { rerender } = render(<ExperimentLab {...props} active />)
  await waitFor(() => expect(responses).toHaveLength(1))
  rerender(<ExperimentLab {...props} active={false} />)
  rerender(<ExperimentLab {...props} active />)
  await waitFor(() => expect(responses).toHaveLength(2))
  await act(async () => { responses[1]([session]) })
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
  await act(async () => { responses[0]([]) })
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled()
})

it('ignores a superseded refresh failure after newer session data succeeds', async () => {
  const client = clientFor([])
  let rejectOld!: (reason: Error) => void
  client.list.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
  const props = { board, onConsole: vi.fn(), onRecording: vi.fn(), client }
  const { rerender } = render(<ExperimentLab {...props} active />)
  await waitFor(() => expect(client.list).toHaveBeenCalledOnce())
  rerender(<ExperimentLab {...props} active={false} />)
  rerender(<ExperimentLab {...props} active />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  await act(async () => { rejectOld(new Error('Obsolete failure')) })
  expect(screen.queryByText('Obsolete failure')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled()
})


it('keeps saving available when evaluation history fails to load', async () => {
  const client = clientFor([session])
  client.reports.mockRejectedValue(new Error('History unavailable'))
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
  expect(await screen.findByText(/Saved evaluation history could not be loaded/)).toBeInTheDocument()
})

it('does not await stalled history requests before enabling recording controls', async () => {
  const client = clientFor([session])
  client.reports.mockImplementation(() => new Promise(() => {}))
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
})


it('keeps a known live recording saveable after a session refresh fails', async () => {
  const client = clientFor([session])
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  client.list.mockRejectedValueOnce(new Error('Session refresh failed'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText('Session refresh failed')
  expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeDisabled()
})

it('can save during a stalled refresh and rejects its stale active-session response', async () => {
  const client = clientFor([session])
  vi.spyOn(api, 'recording').mockResolvedValue({ active: false, sample_count: 0, eeg_names: [], setup_quality_snapshots: [], calibration_markers: [] })
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  let resolveOld!: (sessions: Experiment[]) => void
  client.list.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save recording' }))
  await waitFor(() => expect(client.stop).toHaveBeenCalledWith('session-1'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  await act(async () => { resolveOld([session]) })
  expect(screen.getByRole('button', { name: 'Save recording' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled()
})


it('retains a new evaluation when an older history response arrives afterwards', async () => {
  const client = clientFor([
    { ...session, status: 'saved' },
    { ...session, session_id: 'session-2', name: 'Day 2', status: 'saved' },
  ])
  let resolveHistory!: (reports: Report[]) => void
  client.reports.mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve }))
  const result: Report = {
    id: 'new-result', created_at: '2026-09-30T13:00:00Z', method: 'synthetic test',
    training_session_id: 'session-1', test_session_id: 'session-2', participant: 'P01',
    channels: ['O1', 'O2'], classes: ['Eyes open', 'Eyes closed'], synthetic: true,
    accuracy: 0.5, balanced_accuracy: 0.5, chance: 0.5, confusion_matrix: [[1, 1], [1, 1]],
    training_counts: {}, test_counts: {}, rejected_trials: {}, predictions: [], provenance: {},
  }
  client.evaluate.mockResolvedValue(result)
  show(client)
  await waitFor(() => expect(screen.getByLabelText('Training recording').querySelector('option[value="session-1"]')).not.toBeNull())
  fireEvent.change(screen.getByLabelText('Training recording'), { target: { value: 'session-1' } })
  fireEvent.change(screen.getByLabelText('Test recording'), { target: { value: 'session-2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Train pyRiemann & evaluate' }))
  await waitFor(() => expect(screen.getByLabelText('Saved evaluation').querySelector('option[value="new-result"]')).not.toBeNull())
  await act(async () => { resolveHistory([]) })
  expect(screen.getByLabelText('Saved evaluation').querySelector('option[value="new-result"]')).not.toBeNull()
  expect(screen.getByLabelText('Saved evaluation')).toHaveValue('new-result')
})


it('loads pending evaluation history even after a session mutation', async () => {
  const client = clientFor([session])
  let resolveHistory!: (reports: Report[]) => void
  client.reports.mockImplementationOnce(() => new Promise(resolve => { resolveHistory = resolve }))
  vi.spyOn(api, 'recording').mockResolvedValue({ active: false, sample_count: 0, eeg_names: [], setup_quality_snapshots: [], calibration_markers: [] })
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Save recording' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  const historical: Report = {
    id: 'historical-result', created_at: '2026-09-29T13:00:00Z', method: 'synthetic test',
    training_session_id: 'old-1', test_session_id: 'old-2', participant: 'P01',
    channels: ['O1', 'O2'], classes: ['Eyes open', 'Eyes closed'], synthetic: true,
    accuracy: 0.5, balanced_accuracy: 0.5, chance: 0.5, confusion_matrix: [[1, 1], [1, 1]],
    training_counts: {}, test_counts: {}, rejected_trials: {}, predictions: [], provenance: {},
  }
  await act(async () => { resolveHistory([historical]) })
  expect(screen.getByLabelText('Saved evaluation').querySelector('option[value="historical-result"]')).not.toBeNull()
})


it('accepts useful older history when a newer report refresh fails', async () => {
  const client = clientFor([{ ...session, status: 'saved' }])
  let resolveOld!: (reports: Report[]) => void
  client.reports.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  client.reports.mockRejectedValueOnce(new Error('Newer history request failed'))
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'How the classifier works' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/Saved evaluation history could not be loaded/)
  const older: Report = {
    id: 'older-success', created_at: '2026-09-29T13:00:00Z', method: 'synthetic test',
    training_session_id: 'old-1', test_session_id: 'old-2', participant: 'P01',
    channels: ['O1', 'O2'], classes: ['Eyes open', 'Eyes closed'], synthetic: true,
    accuracy: 0.5, balanced_accuracy: 0.5, chance: 0.5, confusion_matrix: [[1, 1], [1, 1]],
    training_counts: {}, test_counts: {}, rejected_trials: {}, predictions: [], provenance: {},
  }
  await act(async () => { resolveOld([older]) })
  expect(screen.getByLabelText('Saved evaluation').querySelector('option[value="older-success"]')).not.toBeNull()
})


it('clears a failed manual refresh alert when the operator retries successfully', async () => {
  const client = clientFor([session])
  show(client)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled())
  client.list.mockRejectedValueOnce(new Error('Temporary session failure'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText('Temporary session failure')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(client.list).toHaveBeenCalledTimes(3))
  expect(screen.queryByText('Temporary session failure')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save recording' })).toBeEnabled()
})
