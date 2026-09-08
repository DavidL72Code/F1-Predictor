import { useEffect, useState } from "react"

/* A counter that ticks when cached data is worth refetching.
 *
 * The scheduled job can change what the app should be showing — a new race can
 * re-decide which model is live — but a tab left open never noticed: pages stay
 * mounted, so their fetch effects run once, and responseCache had no expiry.
 * You had to reload to see a change.
 *
 * Depend on this value in a fetch effect and it re-runs when:
 *   - the tab becomes visible again (the common case: you come back to it), or
 *   - the interval elapses while it is open.
 *
 * A hidden tab is deliberately not polled; there is nobody to show it to, and
 * the visibility handler covers the moment it starts mattering again.
 */
export const REVALIDATE_MS = 5 * 60 * 1000

export default function useRevalidate(intervalMs = REVALIDATE_MS) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick((n) => n + 1)

    const onVisible = () => {
      if (document.visibilityState === "visible") bump()
    }

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") bump()
    }, intervalMs)

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [intervalMs])

  return tick
}
