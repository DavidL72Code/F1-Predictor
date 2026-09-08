import { useCallback, useEffect, useMemo, useRef } from "react"
import CarStage from "./CarStage"
import "./ScrollIntro.css"

const TRACK_IMG = `${process.env.PUBLIC_URL}/asphalt-track.jpg`

/* Scroll distance the pinned intro consumes, in viewport heights. The stage
   itself never moves — this is only the runway that drives the animation. */
const INTRO_VH = 440

/* Every scene holds long enough to be read, then hands over mid-air: the
   outgoing letters are still clearing frame as the incoming ones arrive.
   Ranges are in runway progress (0–1). */
const EXIT_1 = [0.1, 0.38]
const ENTER_2 = [0.16, 0.46]
const EXIT_2 = [0.54, 0.8]
const ENTER_3 = [0.6, 0.88]

const SCENES = [
  { key: "s1", lines: ["PREDICT THE", "RESULTS"], kicker: "F1 STRATEGY LAB", seed: 0x51ed },
  { key: "s2", lines: ["ML MODEL BUILT TO", "PREDICT ACCURATELY"], seed: 0x9f2c, small: true },
  {
    key: "s3",
    lines: ["FEATURES"],
    seed: 0x3ab7,
    sub: "What the models actually weigh, learned from 2015–2026 race data.",
  },
]

/* Scene 3 callouts, arranged around the car like the reference's ingredient
   pills. Wording follows the feature groups the models actually train on. */
const CALLOUTS = [
  { tag: "GRID", label: "Grid & qualifying pace", pos: "tl", d: 0 },
  { tag: "FORM", label: "Driver & constructor form", pos: "tr", d: 0.08 },
  { tag: "TYRE", label: "Tyre compound + degradation", pos: "bl", d: 0.16 },
  { tag: "WX", label: "Weather & circuit profile", pos: "br", d: 0.24 },
]

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const range = (v, [a, b]) => clamp01((v - a) / (b - a))
const smoothstep = (v) => v * v * (3 - 2 * v)
/* Flatter ends, steeper middle than smoothstep: the car holds its pose while
   each headline is readable, then whips through the turn in the gap. */
const smootherstep = (v) => v * v * v * (v * (v * 6 - 15) + 10)

/* Deterministic PRNG: the scatter must be identical on every render and after
   a remount, otherwise letters jump when React re-renders mid-scroll. */
const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* Every character carries both an arrival offset (from below) and a departure
   offset (up and out). One CSS rule blends the two, so a middle scene can fly
   in, settle, and leave again without any special-casing. */
const charVars = (rnd, i, total) => {
  const stagger = `${(i / Math.max(total - 1, 1)) * 0.34 + rnd() * 0.14}`
  return {
    "--dxi": `${(rnd() - 0.5) * 300}px`,
    "--dyi": `${340 + rnd() * 420}px`,
    "--roti": `${(rnd() - 0.5) * 100}deg`,
    "--dxo": `${(rnd() - 0.5) * 380}px`,
    "--dyo": `${-(460 + rnd() * 620)}px`,
    "--roto": `${(rnd() - 0.5) * 150}deg`,
    "--dly": stagger,
  }
}

/* Split lines into per-word, per-character spans. Words stay whole so a line
   can wrap without letters stranding themselves on their own row. */
const buildLines = (lines, seed) => {
  const rnd = mulberry32(seed)
  const total = lines.join("").replace(/\s/g, "").length
  let i = 0
  return lines.map((line, li) => ({
    key: `${li}-${line}`,
    words: line.split(" ").map((word, wi) => ({
      key: `${wi}-${word}`,
      chars: [...word].map((ch) => {
        const vars = charVars(rnd, i, total)
        i += 1
        return { ch, key: `${i}-${ch}`, vars }
      }),
    })),
  }))
}

const Scene = ({ scene, lines, style }) => (
  <div className={`si-scene si-scene-${scene.key}`} style={style} aria-hidden="true">
    {scene.kicker && <div className="si-kicker">{scene.kicker}</div>}
    <h1 className={`si-headline${scene.small ? " si-headline-sm" : ""}`}>
      {lines.map((line) => (
        <span className="si-line" key={line.key}>
          {line.words.map((word) => (
            <span className="si-word" key={word.key}>
              {word.chars.map((c) => (
                <span className="si-ch" key={c.key} style={c.vars}>
                  {c.ch}
                </span>
              ))}
            </span>
          ))}
        </span>
      ))}
    </h1>
    {scene.sub && <div className="si-sub">{scene.sub}</div>}
  </div>
)

export default function ScrollIntro() {
  const wrapRef = useRef(null)
  const stageRef = useRef(null)
  /* Written every scroll event, read by the car's render loop. A ref rather
     than state so driving the 3D layer never triggers a React render. */
  const progressRef = useRef({ t: 0, turn: 0, active: true })

  const built = useMemo(() => SCENES.map((s) => buildLines(s.lines, s.seed)), [])

  const skipIntro = useCallback(() => {
    const wrap = wrapRef.current
    if (wrap) window.scrollTo({ top: wrap.offsetHeight, behavior: "smooth" })
  }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    const stage = stageRef.current
    if (!wrap || !stage) return undefined

    /* Cached so the scroll handler never touches layout. These are the only
       two reads that would force a reflow, and they only change on resize. */
    let top = 0
    let runway = 1

    const measure = () => {
      const height = wrap.offsetHeight
      /* A zero-height wrap means the page simply is not laid out right now — a
         backgrounded tab, a collapsed window, a display:none ancestor. Keeping
         the previous runway matters: recomputing it to 1 would make the very
         next scroll divide by 1 and snap the intro straight to its end state,
         and it would stay broken because nothing re-measures on scroll. */
      if (height <= 0) return
      top = wrap.offsetTop
      runway = Math.max(height - window.innerHeight, 1)
    }

    /* Deliberately synchronous. Scroll events are already delivered in step
       with the frame, and the body is only setProperty calls with no layout
       read, so there is nothing to throttle. An rAF gate here would be worse:
       a frame requested while the tab is hidden never runs, leaving the gate
       latched and the whole intro frozen when the tab comes back. */
    const apply = () => {
      const t = clamp01((window.scrollY - top) / runway)
      const e1 = smoothstep(range(t, EXIT_1))
      const n2 = smoothstep(range(t, ENTER_2))
      const e2 = smoothstep(range(t, EXIT_2))
      const n3 = smoothstep(range(t, ENTER_3))

      stage.style.setProperty("--e1", `${e1}`)
      stage.style.setProperty("--n2", `${n2}`)
      stage.style.setProperty("--e2", `${e2}`)
      stage.style.setProperty("--n3", `${n3}`)
      stage.style.setProperty("--cam", `${t}`)
      /* Peaks through each hand-over — drives the speed streaks. */
      stage.style.setProperty(
        "--rush",
        `${Math.max(Math.sin(Math.PI * range(t, [EXIT_1[0], ENTER_2[1]])), Math.sin(Math.PI * range(t, [EXIT_2[0], ENTER_3[1]])))}`
      )

      progressRef.current.t = t
      /* The stage is fixed, so its element is always "on screen" as far as an
         IntersectionObserver is concerned. Once the app has risen over it there
         is nothing to look at, so tell the car to stop drawing frames. */
      progressRef.current.active = window.scrollY < top + wrap.offsetHeight
      /* 0 at scene 1, 1 at scene 2, 2 at scene 3 — the car reads this as a
         position along its keyframed yaw, so the turns stay locked to the
         same scroll the letters use. */
      progressRef.current.turn =
        smootherstep(range(t, [EXIT_1[0], ENTER_2[1]])) + smootherstep(range(t, [EXIT_2[0], ENTER_3[1]]))
    }

    const onResize = () => {
      measure()
      apply()
    }

    measure()
    apply()
    window.addEventListener("scroll", apply, { passive: true })
    window.addEventListener("resize", onResize)

    /* The wrap is sized in vh, so anything that changes the visual viewport
       changes the runway — including mobile URL-bar collapse, which does not
       reliably fire a window resize. Observing the element catches every case. */
    const observer = new ResizeObserver(onResize)
    observer.observe(wrap)

    return () => {
      window.removeEventListener("scroll", apply)
      window.removeEventListener("resize", onResize)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="si-wrap" ref={wrapRef} style={{ height: `${INTRO_VH}vh` }}>
      <div className="si-stage" ref={stageRef}>
        <div className="si-track" style={{ backgroundImage: `url(${TRACK_IMG})` }} />
        <div className="si-grade" />
        <CarStage progress={progressRef} />
        <div className="si-streaks" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <span key={i} style={{ "--x": `${(i / 13) * 100}%`, "--o": `${0.28 + (i % 3) * 0.22}` }} />
          ))}
        </div>

        {/* All three headlines are mounted at once and stacked; scroll only
            moves them. Screen readers get the plain text once, up front. */}
        <div className="si-copy">
          <div className="si-sr">
            <h1>Predict the results</h1>
            <p>ML model built to predict accurately</p>
            <h2>Features</h2>
            <ul>
              {CALLOUTS.map((c) => <li key={c.tag}>{c.label}</li>)}
            </ul>
          </div>

          {/* Scene 1 is already settled at rest, so its arrival progress is
              pinned to 1; scene 3 never leaves, so its departure stays 0. */}
          <Scene scene={SCENES[0]} lines={built[0]} style={{ "--pin": "1", "--pout": "var(--e1)" }} />
          <Scene scene={SCENES[1]} lines={built[1]} style={{ "--pin": "var(--n2)", "--pout": "var(--e2)" }} />
          <Scene scene={SCENES[2]} lines={built[2]} style={{ "--pin": "var(--n3)", "--pout": "0" }} />
        </div>

        <div className="si-callouts" aria-hidden="true">
          {CALLOUTS.map((c) => (
            <div key={c.tag} className={`si-callout si-callout-${c.pos}`} style={{ "--d": `${c.d}` }}>
              <span className="si-callout-label">{c.label}</span>
              <span className="si-callout-tag">{c.tag}</span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="si-hint"
          onClick={skipIntro}
          aria-label="Skip the intro and go to the race predictor"
        >
          <span className="si-hint-labels">
            <span className="si-hint-scroll">SCROLL</span>
            <span className="si-hint-enter">ENTER</span>
          </span>
          <span className="si-hint-rail"><i /></span>
        </button>
      </div>
    </div>
  )
}
