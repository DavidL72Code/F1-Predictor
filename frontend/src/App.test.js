import { act, render, screen } from '@testing-library/react'
import App from './App'

/* Asserts the shell mounts and the landing view is there. The strings this
   previously checked ("Simulate any F1 race", "Select year + circuit above
   and press predict") were removed when the hero was replaced by the pinned
   scroll intro, so they could never have matched again.

   These target things that are structural rather than decorative: the brand,
   the nav, and the intro's screen-reader headline — the animated copy is
   aria-hidden, so that h1 is what a non-visual reader actually gets. */

/* CarStage boots asynchronously and, with no WebGL in jsdom, resolves to its
   failed state. Rendering inside an async act lets that settle here instead of
   landing as an act() warning midway through an unrelated assertion. */
const mount = async () => {
  await act(async () => { render(<App />) })
}

test('renders the app shell and landing view', async () => {
  await mount()

  expect(screen.getByText(/race predictor/i)).toBeInTheDocument()

  for (const tab of [/simulate race/i, /analytics/i, /why does it work/i]) {
    expect(screen.getByRole('button', { name: tab })).toBeInTheDocument()
  }

  expect(
    screen.getByRole('heading', { name: /predict the results/i })
  ).toBeInTheDocument()
})

test('exposes the intro headlines to assistive tech, not just as animated glyphs', async () => {
  await mount()

  // Each scene's visible copy is split into per-character spans and hidden from
  // AT; the plain text lives in a visually-hidden block alongside it.
  expect(screen.getByText(/ml model built to predict accurately/i)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /^features$/i })).toBeInTheDocument()
})
