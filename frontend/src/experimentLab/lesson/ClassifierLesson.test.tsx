import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClassifierLesson } from './ClassifierLesson'

afterEach(cleanup)

it('connects covariance changes to tangent features and the classifier probability', () => {
  render(<ClassifierLesson onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '2Covariance' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Channel correlation' }), { target: { value: '-0.6' } })
  expect(screen.getByRole('group', { name: /^S: row one/ })).toHaveAccessibleName('S: row one 100.00, -60.00; row two -60.00, 100.00')
  fireEvent.click(screen.getByRole('button', { name: '3Tangent-space features' }))
  const vector = screen.getByLabelText('Tangent-space feature vector')
  expect(vector.textContent).toContain('-0.854')
  fireEvent.click(screen.getByRole('button', { name: 'Match the reference' }))
  expect(vector.textContent).not.toContain('-0.854')
  fireEvent.click(screen.getByRole('button', { name: '4Logistic regression' }))
  fireEvent.change(screen.getByRole('slider', { name: 'Intercept b' }), { target: { value: '0' } })
  expect(screen.getByText('p(Pattern B) = 50.0%')).toBeInTheDocument()
})

it('provides explanatory feedback and can return to the experiment', () => {
  const close = vi.fn()
  render(<ClassifierLesson onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: 'Test your understanding' }))
  fireEvent.click(screen.getByRole('button', { name: 'Multiplies by four' }))
  expect(screen.getByText(/Two factors of 2 give 4/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Training recordings only' }))
  expect(screen.getByText(/reference and weights are fitted on training data/)).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Back to experiment' })[0])
  expect(close).toHaveBeenCalledOnce()
})
