import { act, render } from "@testing-library/react"
import useRevalidate from "./useRevalidate"

/* The bug this guards: a tab left open never picked up a model change, because
   pages stay mounted and their fetch effects ran once. These assert the counter
   actually ticks on the events the fetch effects depend on. */

function Probe({ intervalMs, onTick }) {
  onTick(useRevalidate(intervalMs))
  return null
}

const renderProbe = (intervalMs) => {
  const seen = []
  render(<Probe intervalMs={intervalMs} onTick={(v) => seen.push(v)} />)
  return seen
}

const setVisibility = (state) => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true })
}

beforeEach(() => {
  jest.useFakeTimers()
  setVisibility("visible")
})

afterEach(() => {
  jest.useRealTimers()
})

test("starts at zero and does not tick on its own", () => {
  const seen = renderProbe(1000)
  expect(seen[seen.length - 1]).toBe(0)
})

test("ticks when the tab regains visibility", () => {
  const seen = renderProbe(1000)
  const before = seen[seen.length - 1]

  act(() => {
    setVisibility("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    setVisibility("visible")
    document.dispatchEvent(new Event("visibilitychange"))
  })

  expect(seen[seen.length - 1]).toBeGreaterThan(before)
})

test("ticks on window focus", () => {
  const seen = renderProbe(1000)
  const before = seen[seen.length - 1]

  act(() => {
    window.dispatchEvent(new Event("focus"))
  })

  expect(seen[seen.length - 1]).toBeGreaterThan(before)
})

test("ticks on the interval while visible", () => {
  const seen = renderProbe(1000)
  const before = seen[seen.length - 1]

  act(() => {
    jest.advanceTimersByTime(3500)
  })

  expect(seen[seen.length - 1]).toBe(before + 3)
})

test("does NOT tick on the interval while hidden", () => {
  const seen = renderProbe(1000)
  setVisibility("hidden")
  const before = seen[seen.length - 1]

  act(() => {
    jest.advanceTimersByTime(10000)
  })

  // Nobody is looking; the visibility handler covers the moment it matters.
  expect(seen[seen.length - 1]).toBe(before)
})
