import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type DemoRunCreateRequest } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('doctor demo API client', () => {
  it('uses the event endpoints for room loading and creation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 'event-1', name: 'Doctor demo', created_at: '2026-08-12T08:00:00Z' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'event-2', name: 'Evening room', created_at: '2026-08-12T09:00:00Z' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await api.demoEvents()
    await api.createDemoEvent({ name: 'Evening room' })

    expect(fetchMock.mock.calls[0][0].toString()).toBe('http://localhost:8000/api/demo/events')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'Evening room' }),
    })
  })

  it('uses the selected event path to load and save complete runs', async () => {
    const payload: DemoRunCreateRequest = {
      participant_name: 'Dr Maya Shah',
      participant_initials: 'MS',
      open_alpha: 1.2,
      closed_alpha: 2.6,
      alpha_lift_percent: 116.67,
      threshold_alpha: 2.11,
      clean_hold_seconds: 12.4,
      confidence: 0.98,
      score: 842,
      scoring_version: 'doctor-demo-v1',
    }
    const responseRun = {
      id: 'run-1',
      event_id: 'event/one',
      ...payload,
      recording_session_id: null,
      completed_at: '2026-08-12T09:05:00Z',
      is_best: true,
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([responseRun]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(responseRun), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await api.demoRuns('event/one')
    await api.createDemoRun('event/one', payload)

    expect(fetchMock.mock.calls[0][0].toString()).toBe(
      'http://localhost:8000/api/demo/events/event%2Fone/runs',
    )
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(payload),
    })
  })
})

describe('UK signal processing defaults', () => {
  it('requests 50 Hz filtering for DSP and signal quality by default', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await api.dspSummary()
    await api.signalQuality()

    expect(fetchMock.mock.calls[0][0].toString()).toContain('notch_frequency_hz=50')
    expect(fetchMock.mock.calls[1][0].toString()).toContain('line_frequency_hz=50')
  })

  it('uses the selected mains frequency for signal quality and calm metrics', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await api.signalQuality(500, 60)
    await api.calmFeatures(60)

    expect(fetchMock.mock.calls[0][0].toString()).toContain('line_frequency_hz=60')
    expect(fetchMock.mock.calls[1][0].toString()).toContain('line_frequency_hz=60')
  })
})
