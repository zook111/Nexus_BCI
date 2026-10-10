import type { Experiment, Report } from './api'

export const presets = {
  eyes: { name: 'Eyes open / closed', labels: ['Eyes open', 'Eyes closed'], channels: ['O1', 'O2'],
    instruction: 'Stay still with a relaxed jaw. Keep eyes open or closed as prompted.' },
  hands: { name: 'Left / right hand imagery', labels: ['Left hand imagery', 'Right hand imagery'], channels: ['C3', 'C4'],
    instruction: 'Keep eyes open and hands still. Imagine the feeling of opening and closing the prompted hand. Do not move it.' },
  custom: { name: 'Custom tasks', labels: ['Quiet rest', 'Mental arithmetic'], channels: ['C3', 'C4'],
    instruction: 'Use a repeatable instruction for each task. Keep eye position, posture and movement consistent.' },
}
export type Preset = keyof typeof presets

export function nextLabel(experiment: Experiment, random = Math.random): string {
  const counts = experiment.labels.map(label => experiment.trials.filter(
    trial => trial.label === label && trial.included && trial.end_timestamp !== null,
  ).length)
  const smallest = Math.min(...counts)
  const candidates = experiment.labels.filter((_, i) => counts[i] === smallest)
  return candidates[Math.floor(random() * candidates.length)]
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Trial interrupted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}


/** Reports are immutable; late history snapshots must not remove known results. */
export function mergeReports(current: Report[], incoming: Report[]): Report[] {
  const known = new Map(current.map(report => [report.id, report]))
  for (const report of incoming) if (!known.has(report.id)) known.set(report.id, report)
  return [...known.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}
