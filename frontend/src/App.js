import { useEffect, useRef, useState } from "react"
import ScrollIntro from "./ScrollIntro"
import AnalyticsPage from "./AnalyticsPage"
import UnderTheHoodPage from "./UnderTheHoodPage"
import { Podium, GridRow, AccuracyKey } from "./RaceResult"
import "./App.css"

const API = process.env.REACT_APP_API_URL?.replace(/\/$/, "")
  || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "/api")
const BACKEND_KEEPALIVE_MS = 4 * 60 * 1000

const surname = (n) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").split(" ").pop()
const fmtCircuit = (c) => c?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || ""

const TEAM_COLORS = {
  red_bull:"#3671C6",mercedes:"#27F4D2",ferrari:"#E8002D",mclaren:"#FF8000",
  aston_martin:"#229971",alpine:"#FF87BC",williams:"#64C4FF",haas:"#B6BABD",
  alfa:"#C92D4B",alphatauri:"#5E8FAA",rb:"#6692FF",kick_sauber:"#52E252",
  sauber:"#52E252",cadillac:"#FF4400",
}

const MODEL_PROFILES = [
  {
    key: "winner",
    label: "Winner-Centric",
    short: "P1",
    description: "Best at picking the race winner.",
  },
  {
    key: "full_order",
    label: "Full Finishing Order",
    short: "GRID",
    description: "Best at ranking the full finishing order.",
  },
]

/* Scores shown on the race selector, read from /model/stats?profile=…
   so they follow the active profile. `objective_metric` says which one that
   profile is actually tuned for, and that chip is flagged. */
const HERO_CHIP_METRICS = [
  { key: "winner_acc", label: "WINNER ACC", fmt: (v) => `${v.toFixed(1)}%` },
  { key: "podium_acc", label: "PODIUM ACC", fmt: (v) => `${v.toFixed(1)}%` },
  { key: "spearman", label: "SPEARMAN", fmt: (v) => v.toFixed(3) },
  { key: "mae", label: "MAE", fmt: (v) => `${v.toFixed(2)}p` },
]

const TRACK_PATH = "M 128 56 H 356 Q 416 56 416 116 V 204 Q 416 264 356 264 H 104 Q 44 264 44 204 V 116 Q 44 56 104 56 H 128"
const FINISH_LINE_X = 128
const LOADER_LAP_MS = 3200

/* Floor on how long the loader stays up, so a fast response does not flash the
   spinner and vanish. Deliberately NOT the full lap: predictions were padded to
   LOADER_LAP_MS so the car could complete a circuit, which meant a 300ms answer
   still cost the user 3.2s. The lap is the animation's business, not the
   request's — the car can leave mid-lap. */
const MIN_LOADER_MS = 600

const readErrorMessage = async (response, fallback) => {
  try {
    const data = await response.json()
    return data.detail || data.error || fallback
  } catch {
    return fallback
  }
}

const expectArray = (value, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} returned an unexpected response shape.`)
  }
  return value
}

/* In-memory cache of GET responses, keyed by URL. De-dupes concurrent
   requests (stores the promise) so toggling profiles or revisiting a page
   reuses the already-loaded data instead of refetching and flickering. */
const responseCache = new Map()
const cachedJson = (url) => {
  if (responseCache.has(url)) return responseCache.get(url)
  const promise = fetch(url)
    .then(async (r) => {
      if (!r.ok) {
        throw new Error(await readErrorMessage(r, `Request failed with status ${r.status}`))
      }
      return r.json()
    })
    .catch((err) => {
      responseCache.delete(url) // let a failed request retry next time
      throw err
    })
  responseCache.set(url, promise)
  return promise
}

/* Coalesce a scroll/resize handler to at most one run per animation frame,
   so multiple listeners don't each force a layout on every scroll event. */
/* Cancel-and-reschedule rather than a boolean latch. With a latch, a frame
   requested while the document is hidden never runs, `scheduled` stays true,
   and the handler is dead for good. This version re-arms on every call, so it
   self-heals as soon as frames resume. */
const rafThrottle = (fn) => {
  let handle = 0
  return (...args) => {
    if (handle) cancelAnimationFrame(handle)
    handle = requestAnimationFrame(() => {
      handle = 0
      fn(...args)
    })
  }
}

/* ── Scroll progress bar across the top of the viewport ── */
const ScrollProgress = () => {
  const barRef = useRef(null)
  useEffect(() => {
    /* scrollHeight forces layout, so it is measured only when the page can
       actually have changed size — never on the scroll path. That leaves the
       scroll handler as a single style write, cheap enough to run
       synchronously and immune to a stalled animation frame. */
    let max = 0
    const measure = () => {
      max = document.documentElement.scrollHeight - window.innerHeight
    }
    const update = () => {
      const bar = barRef.current
      if (!bar) return
      bar.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`
    }
    const onScroll = update
    const onResize = () => { measure(); update() }
    measure()
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onResize)
    // Page height also changes on tab switch / content load with no scroll
    // event — observe the body so the bar stays in sync.
    const observer = new ResizeObserver(onResize)
    observer.observe(document.body)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      observer.disconnect()
    }
  }, [])
  return <div className="scroll-progress" ref={barRef} />
}

/* ── Back-to-top button, appears after scrolling down ── */
const BackToTop = () => {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = rafThrottle(() => setShow(window.scrollY > 500))
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  return (
    <button
      className={`back-to-top${show ? " show" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
    >
      ↑
    </button>
  )
}

const RaceCarLoader = () => {
  const pathRef = useRef(null)
  const frameRef = useRef(null)
  const startRef = useRef(null)
  const [carPos, setCarPos] = useState({ x: FINISH_LINE_X, y: 56, rot: 0 })
  const [trail, setTrail] = useState([])

  useEffect(() => {
    const animate = (ts) => {
      const path = pathRef.current
      if (!path) {
        frameRef.current = requestAnimationFrame(animate)
        return
      }

      if (!startRef.current) startRef.current = ts

      const totalLength = path.getTotalLength()
      const progress = (((ts - startRef.current) % LOADER_LAP_MS) / LOADER_LAP_MS) * totalLength
      const point = path.getPointAtLength(progress)
      const ahead = path.getPointAtLength((progress + 10) % totalLength)
      const rot = Math.atan2(ahead.y - point.y, ahead.x - point.x) * 180 / Math.PI

      setCarPos({ x: point.x, y: point.y, rot })
      setTrail(
        Array.from({ length: 12 }, (_, i) => {
          const back = path.getPointAtLength((progress - (i + 1) * 18 + totalLength) % totalLength)
          return {
            x: back.x,
            y: back.y,
            opacity: (1 - i / 12) * 0.45,
            size: Math.max(2.2, 5 - i * 0.24),
          }
        })
      )

      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [])

  return (
    <div className="loader-shell">
      <svg viewBox="0 0 500 320" className="track-loader" role="img" aria-label="Prediction loading track">
        <defs>
          <linearGradient id="trackStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2D3446" />
            <stop offset="50%" stopColor="#57627A" />
            <stop offset="100%" stopColor="#202635" />
          </linearGradient>
          <linearGradient id="trackGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#E8003D" stopOpacity="0.1" />
            <stop offset="55%" stopColor="#3671C6" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#E8003D" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        <rect x="22" y="24" width="456" height="272" rx="42" fill="url(#trackGlow)" opacity="0.16" />
        <path d={TRACK_PATH} fill="none" stroke="#090C13" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" />
        <path d={TRACK_PATH} fill="none" stroke="url(#trackStroke)" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
        <path d={TRACK_PATH} fill="none" stroke="#C8D0DE" strokeWidth="2" strokeDasharray="12 12" opacity="0.8" />
        <path d={TRACK_PATH} fill="none" stroke="#E8003D" strokeWidth="6" opacity="0.16" />
        <path ref={pathRef} d={TRACK_PATH} fill="none" stroke="transparent" strokeWidth="1" />
        <g transform={`translate(${FINISH_LINE_X}, 0)`} opacity="0.96">
          <line x1="0" y1="30" x2="0" y2="82" stroke="#0A0D14" strokeWidth="16" strokeLinecap="round" />
          {Array.from({ length: 6 }, (_, i) => (
            <g key={i}>
              <rect x={i % 2 === 0 ? -7 : 1} y={35 + i * 7} width="6" height="7" fill="#F3F5F8" />
              <rect x={i % 2 === 0 ? 1 : -7} y={35 + i * 7} width="6" height="7" fill="#121722" />
            </g>
          ))}
        </g>

        {trail.map((t, i) => (
          <g key={i}>
            <circle cx={t.x} cy={t.y} r={t.size + 1.5} fill="#E8003D" opacity={t.opacity * 0.18} />
            <circle cx={t.x} cy={t.y} r={t.size} fill="#FF547A" opacity={t.opacity} />
          </g>
        ))}

        <g transform={`translate(${carPos.x},${carPos.y}) rotate(${carPos.rot})`}>
          <ellipse rx="14" ry="6" fill="#E8003D" opacity="0.2" />
          <rect x={-11} y={-4} width={22} height={8} rx={2} fill="#CC0020" />
          <rect x={-4} y={-3} width={8} height={6} rx={1} fill="#0A0A14" />
          <rect x={9} y={-6} width={4} height={12} rx={1} fill="#ECEFF4" />
          <rect x={-15} y={-7} width={4} height={14} rx={1} fill="#ECEFF4" />
          <rect x={-9} y={-7} width={5} height={4} rx={1} fill="#222" />
          <rect x={2} y={-7} width={5} height={4} rx={1} fill="#222" />
          <rect x={-9} y={3} width={5} height={4} rx={1} fill="#222" />
          <rect x={2} y={3} width={5} height={4} rx={1} fill="#222" />
        </g>
      </svg>

      <div className="loader-copy">
        <div className="loader-kicker">RUNNING MODEL</div>
        <div className="loader-title">Lighting up the circuit and generating the grid...</div>
      </div>
    </div>
  )
}

const IMG_URL = `${process.env.PUBLIC_URL}/f1-car.png`
const HERO_IMG_URL = `${process.env.PUBLIC_URL}/hero-image.jpg`

const F1_CDN = "https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9"

/* Static circuit facts keyed by circuit slug — laps, lengths, location, track
   map. Use these freely.

   Do NOT read `round` or `race_date` from here. The calendar lives in
   F1_2026_CIRCUITS on the API, and these drifted out of sync with it: this
   table omits Bahrain and Jeddah as 2026 rounds, so everything after them was
   numbered two low (Monza 13 here vs 15 on the API). The dates contradict
   themselves too — round 13 is listed after round 14 — and because the key is
   the circuit alone, a 2026 date was shown for historical races at the same
   venue. Round and year now come from the selected race object instead. */
const CIRCUIT_DATA = {
  albert_park:   { name:"Australian Grand Prix", circuit:"Albert Park Grand Prix Circuit", round:1, race_date:"2026-03-08", city:"Melbourne", country:"Australia", laps:58, circuit_length_miles:3.28, circuit_length_km:5.278, race_length_miles:190.216, race_length_km:306.124, track:"https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_771/content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Australia_Circuit" },
  shanghai:      { name:"Chinese Grand Prix", circuit:"Shanghai International Circuit", round:2, race_date:"2026-03-15", city:"Shanghai", country:"China", laps:56, circuit_length_miles:3.387, circuit_length_km:5.451, race_length_miles:189.559, race_length_km:305.066, track:`${F1_CDN}/China_Circuit` },
  suzuka:        { name:"Japanese Grand Prix", circuit:"Suzuka Circuit", round:3, race_date:"2026-03-29", city:"Suzuka", country:"Japan", laps:53, circuit_length_miles:3.608, circuit_length_km:5.807, race_length_miles:191.053, race_length_km:307.471, track:`${F1_CDN}/Japan_Circuit` },
  miami:         { name:"Miami Grand Prix", circuit:"Miami International Autodrome", round:4, race_date:"2026-05-03", city:"Miami Gardens", country:"United States", laps:57, circuit_length_miles:3.363, circuit_length_km:5.412, race_length_miles:191.584, race_length_km:308.326, track:`${F1_CDN}/Miami_Circuit` },
  villeneuve:    { name:"Canadian Grand Prix", circuit:"Circuit Gilles Villeneuve", round:5, race_date:"2026-05-24", city:"Montreal", country:"Canada", laps:70, circuit_length_miles:2.709, circuit_length_km:4.361, race_length_miles:189.694, race_length_km:305.27, track:`${F1_CDN}/Canada_Circuit` },
  monaco:        { name:"Monaco Grand Prix", circuit:"Circuit de Monaco", round:6, race_date:"2026-06-07", city:"Monaco", country:"Monaco", laps:78, circuit_length_miles:2.074, circuit_length_km:3.337, race_length_miles:161.734, race_length_km:260.286, track:`${F1_CDN}/Monaco_Circuit` },
  catalunya:     { name:"Barcelona-Catalunya Grand Prix", circuit:"Circuit de Barcelona-Catalunya", round:7, race_date:"2026-06-14", city:"Montmeló", country:"Spain", laps:66, circuit_length_miles:2.894, circuit_length_km:4.657, race_length_miles:190.908, race_length_km:307.236, track:`${F1_CDN}/Spain_Circuit` },
  red_bull_ring: { name:"Austrian Grand Prix", circuit:"Red Bull Ring", round:8, race_date:"2026-06-28", city:"Spielberg", country:"Austria", laps:71, circuit_length_miles:2.683, circuit_length_km:4.318, race_length_miles:190.42, race_length_km:306.452, track:`${F1_CDN}/Austria_Circuit` },
  silverstone:   { name:"British Grand Prix", circuit:"Silverstone Circuit", round:9, race_date:"2026-07-05", city:"Silverstone", country:"United Kingdom", laps:52, circuit_length_miles:3.66, circuit_length_km:5.891, race_length_miles:190.263, race_length_km:306.198, track:`${F1_CDN}/Great_Britain_Circuit` },
  spa:           { name:"Belgian Grand Prix", circuit:"Circuit de Spa-Francorchamps", round:10, race_date:"2026-07-19", city:"Stavelot", country:"Belgium", laps:44, circuit_length_miles:4.352, circuit_length_km:7.004, race_length_miles:191.398, race_length_km:308.052, track:`${F1_CDN}/Belgium_Circuit` },
  hungaroring:   { name:"Hungarian Grand Prix", circuit:"Hungaroring", round:11, race_date:"2026-07-26", city:"Mogyoród", country:"Hungary", laps:70, circuit_length_miles:2.722, circuit_length_km:4.381, race_length_miles:190.531, race_length_km:306.63, track:`${F1_CDN}/Hungary_Circuit` },
  zandvoort:     { name:"Dutch Grand Prix", circuit:"Circuit Zandvoort", round:12, race_date:"2026-08-23", city:"Zandvoort", country:"Netherlands", laps:72, circuit_length_miles:2.646, circuit_length_km:4.259, race_length_miles:190.504, race_length_km:306.587, track:`${F1_CDN}/Netherlands_Circuit` },
  monza:         { name:"Italian Grand Prix", circuit:"Autodromo Nazionale Monza", round:13, race_date:"2026-10-06", city:"Monza", country:"Italy", laps:53, circuit_length_miles:3.6, circuit_length_km:5.793, race_length_miles:190.596, race_length_km:306.72, track:`${F1_CDN}/Italy_Circuit` },
  ifema_madrid:  { name:"Spanish Grand Prix", circuit:"Madring", round:14, race_date:"2026-09-13", city:"Madrid", country:"Spain", laps:56, circuit_length_miles:3.401, circuit_length_km:5.474, race_length_miles:190.478, race_length_km:306.544, track:"https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000000/common/f1/2026/track/2026trackmadringdetailed.webp" },
  baku:          { name:"Azerbaijan Grand Prix", circuit:"Baku City Circuit", round:15, race_date:"2026-09-26", city:"Baku", country:"Azerbaijan", laps:51, circuit_length_miles:3.73, circuit_length_km:6.003, race_length_miles:190.17, race_length_km:306.049, track:`${F1_CDN}/Baku_Circuit` },
  marina_bay:    { name:"Singapore Grand Prix", circuit:"Marina Bay Street Circuit", round:16, race_date:"2026-10-11", city:"Singapore", country:"Singapore", laps:62, circuit_length_miles:3.07, circuit_length_km:4.94, race_length_miles:190.228, race_length_km:306.143, track:`${F1_CDN}/Singapore_Circuit` },
  americas:      { name:"United States Grand Prix", circuit:"Circuit of the Americas", round:17, race_date:"2026-10-25", city:"Austin", country:"United States", laps:56, circuit_length_miles:3.426, circuit_length_km:5.513, race_length_miles:191.634, race_length_km:308.405, track:`${F1_CDN}/USA_Circuit` },
  rodriguez:     { name:"Mexican Grand Prix", circuit:"Autódromo Hermanos Rodríguez", round:18, race_date:"2026-11-01", city:"Mexico City", country:"Mexico", laps:71, circuit_length_miles:2.674, circuit_length_km:4.304, race_length_miles:189.738, race_length_km:305.354, track:`${F1_CDN}/Mexico_Circuit` },
  interlagos:    { name:"São Paulo Grand Prix", circuit:"Autódromo José Carlos Pace", round:19, race_date:"2026-11-08", city:"São Paulo", country:"Brazil", laps:71, circuit_length_miles:2.677, circuit_length_km:4.309, race_length_miles:190.064, race_length_km:305.879, track:`${F1_CDN}/Brazil_Circuit` },
  vegas:         { name:"Las Vegas Grand Prix", circuit:"Las Vegas Strip Circuit", round:20, race_date:"2026-11-21", city:"Las Vegas", country:"United States", laps:50, circuit_length_miles:3.853, circuit_length_km:6.201, race_length_miles:192.599, race_length_km:309.958, track:`${F1_CDN}/Las_Vegas_Circuit` },
  losail:        { name:"Qatar Grand Prix", circuit:"Lusail International Circuit", round:21, race_date:"2026-11-29", city:"Lusail", country:"Qatar", laps:57, circuit_length_miles:3.367, circuit_length_km:5.419, race_length_miles:191.762, race_length_km:308.611, track:`${F1_CDN}/Qatar_Circuit` },
  yas_marina:    { name:"Abu Dhabi Grand Prix", circuit:"Yas Marina Circuit", round:22, race_date:"2026-12-06", city:"Yas Marina", country:"United Arab Emirates", laps:58, circuit_length_miles:3.281, circuit_length_km:5.281, race_length_miles:190.253, race_length_km:306.183, track:`${F1_CDN}/Abu_Dhabi_Circuit` },
  // historical circuits not in 2026 calendar
  bahrain:         { name:"Bahrain Grand Prix", circuit:"Bahrain International Circuit", city:"Sakhir", country:"Bahrain", laps:57, circuit_length_miles:3.363, circuit_length_km:5.412, track:`${F1_CDN}/Bahrain_Circuit` },
  jeddah:          { name:"Saudi Arabian Grand Prix", circuit:"Jeddah Corniche Circuit", city:"Jeddah", country:"Saudi Arabia", laps:50, circuit_length_miles:3.836, circuit_length_km:6.174, track:`${F1_CDN}/Saudi_Arabia_Circuit` },
  hockenheimring:  { name:"German Grand Prix", circuit:"Hockenheimring", city:"Hockenheim", country:"Germany", laps:67, circuit_length_miles:2.842, circuit_length_km:4.574, track:`${F1_CDN}/Germany_Circuit` },
  imola:           { name:"Emilia Romagna Grand Prix", circuit:"Autodromo Enzo e Dino Ferrari", city:"Imola", country:"Italy", laps:63, circuit_length_miles:3.051, circuit_length_km:4.909, track:`${F1_CDN}/Emilia_Romagna_Circuit` },
  istanbul:        { name:"Turkish Grand Prix", circuit:"Istanbul Park", city:"Istanbul", country:"Turkey", laps:58, circuit_length_miles:3.317, circuit_length_km:5.338, track:`${F1_CDN}/Turkey_Circuit` },
  mugello:         { name:"Tuscan Grand Prix", circuit:"Autodromo Internazionale del Mugello", city:"Scarperia", country:"Italy", laps:59, circuit_length_miles:3.259, circuit_length_km:5.245, track:`${F1_CDN}/Tuscany_Circuit` },
  nurburgring:     { name:"Eifel Grand Prix", circuit:"Nürburgring", city:"Nürburg", country:"Germany", laps:60, circuit_length_miles:3.199, circuit_length_km:5.148, track:`${F1_CDN}/Eifel_Circuit` },
  portimao:        { name:"Portuguese Grand Prix", circuit:"Autodromo Internacional do Algarve", city:"Portimão", country:"Portugal", laps:66, circuit_length_miles:2.91, circuit_length_km:4.684, track:`${F1_CDN}/Portugal_Circuit` },
  ricard:          { name:"French Grand Prix", circuit:"Circuit Paul Ricard", city:"Le Castellet", country:"France", laps:53, circuit_length_miles:3.63, circuit_length_km:5.842, track:`${F1_CDN}/France_Circuit` },
  sepang:          { name:"Malaysian Grand Prix", circuit:"Sepang International Circuit", city:"Sepang", country:"Malaysia", laps:56, circuit_length_miles:3.444, circuit_length_km:5.543, track:"https://en.wikipedia.org/wiki/Special:FilePath/Sepang_International_Circuit.svg" },
  sochi:           { name:"Russian Grand Prix", circuit:"Sochi Autodrom", city:"Sochi", country:"Russia", laps:53, circuit_length_miles:3.634, circuit_length_km:5.848, track:`${F1_CDN}/Russia_Circuit` },
}

const GridCell = ({ driver, flip }) => {
  const tc = TEAM_COLORS[driver.team] || "#888"
  return (
    <div className={`sim-grid-driver${flip ? " flip" : ""}`}>
      <span className="sim-grid-chip" style={{ background: tc }} aria-hidden="true" />
      <span className="num sim-grid-pos">P{driver.grid}</span>
      <div>
        <div className="sim-grid-name">{surname(driver.driver)}</div>
        <div className="sim-grid-team">{driver.team.replace(/_/g, " ").toUpperCase()}</div>
      </div>
    </div>
  )
}

function HeroStage({ years, selectedYear, setYear, raceOptions, selectedRaceKey, setSelectedRaceKey, predict, loading, modelStats, selectedProfile, error, previewGrid }) {
  const frameRef = useRef(null)
  const petalsRef = useRef(null)

  useEffect(() => {
    const frame = frameRef.current
    const stageEl = frame?.parentElement
    const onScroll = rafThrottle(() => {
      if (!frame || !stageEl) return
      const scrollY = window.scrollY
      if (scrollY > stageEl.offsetHeight) return
      frame.style.transform = `translateY(${scrollY * 0.28}px)`
    })
    window.addEventListener("scroll", onScroll, { passive: true })

    const container = petalsRef.current
    if (container) {
      for (let i = 0; i < 18; i++) {
        const p = document.createElement("div")
        p.className = "petal"
        const size = 6 + Math.random() * 7
        p.style.cssText = [
          `left:${Math.random() * 100}%`,
          `width:${size}px`,
          `height:${size * 0.7}px`,
          `animation-duration:${5 + Math.random() * 6}s`,
          `animation-delay:${-Math.random() * 10}s`,
          `--drift:${(Math.random() - 0.5) * 160}px`,
          `--spin:${(Math.random() - 0.5) * 540}deg`,
          `opacity:${0.55 + Math.random() * 0.4}`,
        ].join(";")
        container.appendChild(p)
      }
    }

    return () => {
      window.removeEventListener("scroll", onScroll)
      if (container) container.innerHTML = ""
      if (frame) frame.style.transform = ""
    }
  }, [])

  const selectedRace = raceOptions.find((r) => r.key === selectedRaceKey)
  const smData = selectedRace?.circuit ? CIRCUIT_DATA[selectedRace.circuit] : null
  const circuitMapUrl = smData?.track || null
  const gridOrder = previewGrid ? [...previewGrid].sort((a, b) => a.grid - b.grid) : []
  const gridRows = Math.ceil(gridOrder.length / 2)

  return (
    <div className="stage">
      <div className="frame" ref={frameRef}>
        <img className="layer hero-img" src={HERO_IMG_URL} alt="Formula 1 car" onError={(e) => { e.currentTarget.src = IMG_URL }} />
        <div className="hero-petals" ref={petalsRef} />
        <div className="vignette" />
        <div className="hero-fade" />
      </div>

      <div className="hero-overlay-layout">
        <div className="controls-mono hero-selector-side">
          <div className="controls-head">
            <div className="kicker" style={{ marginBottom: "4px" }}>SELECT RACE</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>
              {modelStats?.profile_label || MODEL_PROFILES.find((p) => p.key === selectedProfile)?.label}
              {" "}·{" "}
              {modelStats?.profile_description || MODEL_PROFILES.find((p) => p.key === selectedProfile)?.description}
            </div>
          </div>
          <div className="controls-row">
            <div className="field">
              <span className="field-label">YEAR</span>
              <select value={selectedYear} onChange={(e) => setYear(Number(e.target.value))} className="select">
                {years.map((y) => <option key={y} value={y}>{y}{y === 2026 ? " (Current Season)" : ""}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <span className="field-label">CIRCUIT</span>
              <select value={selectedRaceKey} onChange={(e) => setSelectedRaceKey(e.target.value)} className="select" style={{ flex: 1, minWidth: "220px" }}>
                {raceOptions.map((r) => <option key={r.key} value={r.key}>{r.name}{r.is_future ? " ◆ Future" : ""}</option>)}
              </select>
            </div>
            <button onClick={() => predict()} disabled={loading || !selectedRaceKey} className="hero-cta">
              ▶ PREDICT RACE
            </button>
          </div>
          {error && <div className="hero-error">{error}</div>}
          {/* Live per-profile scores. These were four hardcoded strings, which
              is why switching profile appeared to change nothing but the model
              name — the whole point of the two profiles is that these numbers
              trade off against each other. */}
          <div className="hero-stat-chips">
            {HERO_CHIP_METRICS.map((m) => {
              const value = modelStats?.all_metrics?.[m.key]
              const isObjective = modelStats?.objective_metric === m.key
              return (
                <div key={m.key} className={`hero-stat-chip${isObjective ? " is-objective" : ""}`}>
                  <div className="chip-label">
                    {m.label}
                    {isObjective && <span className="chip-flag">OPTIMISED</span>}
                  </div>
                  <div className="chip-value num">{value == null ? "—" : m.fmt(value)}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="controls-mono hero-map-side">
          {circuitMapUrl ? (
            <>
              <div className="hero-circuit-title">{smData?.name || selectedRace?.name}</div>
              <img
                src={circuitMapUrl}
                alt={selectedRace?.name}
                key={circuitMapUrl}
                className="hero-circuit-img"
                onError={(e) => { e.currentTarget.style.display = "none" }}
              />
              {smData && (
                <div className="hero-circuit-details">
                  <div className="hero-circuit-popup-row"><span>Circuit</span><span>{smData.circuit}</span></div>
                  {/* Round and year come from the selected race, which the API
                      supplies. CIRCUIT_DATA is keyed by circuit alone, so its
                      round/date describe one 2026 entry and were wrong for both
                      the current calendar and every historical season. */}
                  <div className="hero-circuit-popup-row"><span>Round {selectedRace?.round}</span><span>{selectedRace?.year}</span></div>
                  <div className="hero-circuit-popup-row"><span>Location</span><span>{smData.city}, {smData.country}</span></div>
                  <div className="hero-circuit-popup-row"><span>Laps</span><span>{smData.laps}</span></div>
                  <div className="hero-circuit-popup-row"><span>Circuit Length</span><span>{smData.circuit_length_miles} mi / {smData.circuit_length_km} km</span></div>
                  <div className="hero-circuit-popup-row"><span>Race Length</span><span>{smData.race_length_miles} mi / {smData.race_length_km} km</span></div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "2px", textAlign: "center" }}>SELECT A RACE</div>
          )}
        </div>

        <div className="controls-mono hero-grid-side">
          <div className="kicker" style={{ marginBottom: "10px", fontSize: "9px", color: "rgba(255,255,255,0.7)" }}>STARTING GRID</div>
          {gridOrder.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {Array.from({ length: gridRows }, (_, row) => {
                const right = gridOrder[row * 2]
                const left  = gridOrder[row * 2 + 1]
                return (
                  <div key={row} className="gs-row">
                    <div className="gs-slot gs-left">{left && <GridCell driver={left} flip />}</div>
                    <div className="gs-slot gs-right">{right && <GridCell driver={right} />}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", textAlign: "center", padding: "20px 0" }}>
              LOADING GRID…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState("predict")
  const [selectedProfile, setSelectedProfile] = useState("winner")
  /* Refs, not state: the profile effect needs the *current* predict closure
     without re-subscribing every render. */
  const predictRef = useRef(null)
  const hasPredictedRef = useRef(false)
  const [races, setRaces] = useState([])
  const [years, setYears] = useState([])
  const [raceOptions, setRaceOptions] = useState([])
  const [selectedYear, setYear] = useState(2026)
  const [selectedRaceKey, setSelectedRaceKey] = useState("")
  const [results, setResults] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [raceInfo, setRaceInfo] = useState(null)
  const [previewGrid, setPreviewGrid] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showActual, setShowActual] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [modelStats, setModelStats] = useState(null)
  const [isFuture, setIsFuture] = useState(false)
  const [futureNote, setFutureNote] = useState("")
  const [error, setError] = useState("")
  // Pages stay mounted once visited, so switching back is instant and keeps
  // scroll position + in-page state instead of remounting and refetching.
  const [visited, setVisited] = useState({ predict: true })

  useEffect(() => {
    setVisited((v) => (v[page] ? v : { ...v, [page]: true }))
  }, [page])

  useEffect(() => {
    const pingBackend = () => {
      fetch(`${API}/health`, {
        cache: "no-store",
        keepalive: true,
      }).catch(() => {})
    }

    pingBackend()
    const intervalId = window.setInterval(pingBackend, BACKEND_KEEPALIVE_MS)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    cachedJson(`${API}/races`)
      .then((data) => {
        const raceList = expectArray(data, "Race list")
        setRaces(raceList)
        const ys = [...new Set(raceList.map((r) => r.year))].sort((a, b) => b - a)
        setYears(ys)
        if (ys.length > 0) {
          const rs = raceList.filter((r) => r.year === ys[0]).sort((a, b) => a.round - b.round)
          setYear(ys[0])
          setRaceOptions(rs)
          setSelectedRaceKey(rs[0]?.key || "")
        }
      })
      .catch((err) => {
        console.error(err)
        setError(err.message || "Unable to load race list. Check that the backend is running locally or that Vercel has RENDER_API_URL configured.")
      })

    cachedJson(`${API}/analytics`)
      .then(setAnalytics)
      .catch(console.error)


    // Warm the cache for both profiles so the first profile toggle is instant.
    MODEL_PROFILES.forEach((p) => {
      cachedJson(`${API}/model/stats?profile=${encodeURIComponent(p.key)}`).catch(() => {})
    })
  }, [])

  useEffect(() => {
    let active = true
    cachedJson(`${API}/model/stats?profile=${encodeURIComponent(selectedProfile)}`)
      .then((data) => { if (active) setModelStats(data) })
      .catch(console.error)
    return () => { active = false }
  }, [selectedProfile])

  useEffect(() => {
    if (!Array.isArray(races)) return
    const rs = races.filter((r) => r.year === selectedYear).sort((a, b) => a.round - b.round)
    setRaceOptions(rs)
    setSelectedRaceKey(rs[0]?.key || "")
    hasPredictedRef.current = false
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")
  }, [selectedYear, races])

  /* The two profiles select different features and a different blend, so the
     finishing order genuinely differs. Re-run in place rather than dumping the
     user back to the selector — switching profile is exactly the moment you
     want to see the numbers move. */
  useEffect(() => {
    setError("")
    if (hasPredictedRef.current && predictRef.current) {
      predictRef.current({ quiet: true })
      return
    }
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")
  }, [selectedProfile])

  // Keep the hero's track map + starting grid in sync with the selection,
  // before the user ever hits PREDICT RACE.
  useEffect(() => {
    const selectedRace = raceOptions.find((r) => r.key === selectedRaceKey)
    if (!selectedRace) {
      setPreviewGrid(null)
      return
    }
    let active = true
    setPreviewGrid(null)
    cachedJson(`${API}/races/${selectedYear}/${selectedRace.round}?profile=${encodeURIComponent(selectedProfile)}`)
      .then((data) => { if (active) setPreviewGrid(data.results) })
      .catch(() => { if (active) setPreviewGrid(null) })
    return () => { active = false }
  }, [selectedRaceKey, raceOptions, selectedYear, selectedProfile])

  const predict = async ({ quiet = false } = {}) => {
    const selectedRace = raceOptions.find((r) => r.key === selectedRaceKey)
    if (!selectedRace) return

    /* A profile switch re-runs an existing prediction, and forcing the full
       loader lap for that would feel like a stall rather than a refinement. */
    const minLoadingMs = quiet ? 0 : MIN_LOADER_MS
    const startedAt = Date.now()
    hasPredictedRef.current = true

    setError("")
    setLoading(true)
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")


    try {
      const data = await cachedJson(`${API}/races/${selectedYear}/${selectedRace.round}?profile=${encodeURIComponent(selectedProfile)}`)
      const remaining = Math.max(0, minLoadingMs - (Date.now() - startedAt))
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))

      setResults(data.results.map((r) => ({ ...r, team_color: TEAM_COLORS[r.team] || "#888" })))
      setAccuracy(data.accuracy)
      setRaceInfo({ year: data.year, round: data.round, circuit: data.circuit, name: data.name, profile: data.profile, profileLabel: data.profile_label })
      setIsFuture(data.mode === "future")
      setFutureNote(data.note || "")
    } catch (err) {
      console.error(err)
      setError(err.message || "Prediction failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  predictRef.current = predict

  return (
    <div style={{ minHeight: "100vh" }}>
      <ScrollProgress />
      <BackToTop />

      <ScrollIntro />

      {/* Slides up over the pinned intro, which stays fixed behind it. */}
      <div className="app-body">

      <div className="topbar">
        <div className="brand">
          <div className="brand-stripes"><span /><span /><span /></div>
          <div>
            <div className="brand-kicker">F1 STRATEGY LAB</div>
            <div className="brand-name">Race Predictor</div>
          </div>
        </div>
        {[{key:"predict",label:"Simulate Race"},{key:"analytics",label:"Analytics"},{key:"hood",label:"Why Does It Work?"}].map((n) => (
          <button
            key={n.key}
            onClick={() => setPage(n.key)}
            className={`nav-tab${page === n.key ? " active" : ""}`}
          >
            {n.label}
          </button>
        ))}
        <div className="profile-group">
          <span className="profile-label">PROFILE</span>
          {MODEL_PROFILES.map((profile) => (
            <button
              key={profile.key}
              onClick={() => setSelectedProfile(profile.key)}
              className={`profile-chip${selectedProfile === profile.key ? " active" : ""}`}
              title={profile.description}
            >
              {profile.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: page === "analytics" ? "block" : "none" }}>
        {visited.analytics && <AnalyticsPage analytics={analytics} modelStats={modelStats} selectedProfile={selectedProfile} />}
      </div>
      <div style={{ display: page === "hood" ? "block" : "none" }}>
        {visited.hood && <UnderTheHoodPage analytics={analytics} />}
      </div>

      <div style={{ display: page === "predict" ? "block" : "none" }}>
        <>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "65vh" }}>
              <RaceCarLoader />
            </div>
          )}

          {/* SCREEN 1: select race — track map + starting grid follow the selection */}
          {!loading && !results && (
            <HeroStage
              years={years}
              selectedYear={selectedYear}
              setYear={setYear}
              raceOptions={raceOptions}
              selectedRaceKey={selectedRaceKey}
              setSelectedRaceKey={setSelectedRaceKey}
              predict={predict}
              loading={loading}
              modelStats={modelStats}
              selectedProfile={selectedProfile}
              error={error}
              previewGrid={previewGrid}
            />
          )}

          {/* SCREEN 2: predictions — changing the selection here returns to screen 1 */}
          {!loading && results && (
            <div className="page" style={{ animation: "fadeUp 0.3s ease" }}>

              <div className="selector-bar">
                <div className="field">
                  <span className="field-label">YEAR</span>
                  <select value={selectedYear} onChange={(e) => { setYear(Number(e.target.value)); setResults(null) }} className="select">
                    {years.map((y) => <option key={y} value={y}>{y}{y === 2026 ? " (Current Season)" : ""}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">CIRCUIT</span>
                  <select value={selectedRaceKey} onChange={(e) => { setSelectedRaceKey(e.target.value); setResults(null) }} className="select" style={{ minWidth: "260px" }}>
                    {raceOptions.map((r) => <option key={r.key} value={r.key}>{r.name}{r.is_future ? " ◆ Future" : ""}</option>)}
                  </select>
                </div>
                <div className="toggle-group">
                  <span className="field-label">SHOW ACTUAL</span>
                  <div
                    onClick={() => setShowActual(!showActual)}
                    className="toggle-track"
                    style={{ background: showActual ? "var(--accent)" : "var(--border)" }}
                  >
                    <div className="toggle-knob" style={{ left: showActual ? "18px" : "2px" }} />
                  </div>
                </div>
              </div>

              {error && <div className="notice error">{error}</div>}

              {isFuture && (
                <div className="notice future">
                  <div style={{ fontSize: "11px", color: "#3671C6", fontWeight: "800", letterSpacing: "1.5px" }}>FUT</div>
                  <div>
                    <div style={{ fontSize: "10px", color: "#3671C6", letterSpacing: "2px", marginBottom: "3px" }}>PRE-QUALIFYING PREDICTION — 2026 FUTURE RACE</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{futureNote}</div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", marginBottom: "26px" }}>
                <div>
                  <div className="kicker">{raceInfo?.year} FORMULA ONE{isFuture ? " — PREDICTED" : ""}</div>
                  <div className="page-title">{raceInfo?.name || `${fmtCircuit(raceInfo?.circuit)} Grand Prix`}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "6px", letterSpacing: "0.5px" }}>
                    PROFILE: <span style={{ color: "#fff" }}>{raceInfo?.profileLabel || modelStats?.profile_label}</span>
                  </div>
                </div>
                {accuracy && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {[
                      {label:"WINNER",val:accuracy.winner_correct ? "✓ YES" : "✗ NO",c:accuracy.winner_correct ? "#00A550" : "#E8003D"},
                      {label:"PODIUM",val:accuracy.podium_correct ? "✓ YES" : "✗ NO",c:accuracy.podium_correct ? "#00A550" : "#E8003D"},
                      {label:"SPEARMAN",val:accuracy.spearman,c:"#4488FF"},
                      {label:"MAE",val:`${accuracy.mae}p`,c:"#FF6B00"},
                      {label:"WITHIN 3",val:`${accuracy.tolerance?.within_3}%`,c:"#9A9AAC"},
                    ].map((s) => (
                      <div key={s.label} className="accuracy-chip" style={{ "--chip-color": s.c }}>
                        <div className="chip-label">{s.label}</div>
                        <div className="num" style={{ fontSize: "14px", fontWeight: "800", color: s.c, marginTop: "2px" }}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "28px", alignItems: "start" }}>
                <div>
                  <Podium results={results} teamColors={TEAM_COLORS} />
                  <div className="card" style={{ padding: "16px" }}>
                    <div className="card-label" style={{ marginBottom: "10px" }}>{isFuture ? "PREDICTION METHOD" : "ACTUAL POSITION KEY"}</div>
                    {isFuture ? (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.8" }}>
                        {raceInfo?.profileLabel || modelStats?.profile_label}<br />
                        Trained on every round before this one<br />
                        Equal grid, medium tyre, dry track assumed<br />
                        No actual results available yet
                      </div>
                    ) : (
                      <AccuracyKey />
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "32px 3px 1fr 90px 44px 50px", gap: "0 12px", padding: "6px 12px", fontSize: "9px", color: "var(--text-faint)", letterSpacing: "1.5px", borderBottom: "1px solid var(--border)", marginBottom: "6px" }}>
                    <div style={{ textAlign: "center" }}>POS</div><div />
                    <div>DRIVER</div><div>WIN PROB</div>
                    <div style={{ textAlign: "center" }}>GRID</div>
                    <div style={{ textAlign: "center" }}>{showActual && !isFuture ? "ACTUAL" : "—"}</div>
                  </div>
                  {results.map((r, i) => <GridRow key={r.driver} r={r} i={i} showActual={showActual && !isFuture} teamColors={TEAM_COLORS} />)}
                </div>
              </div>
            </div>
          )}
        </>
      </div>

      <div className="footer">
        <span>F1 STRATEGY LAB — 2015–2026</span>
        <span>RIDGE + XGBOOST + BLEND · WINNER &amp; FULL ORDER PROFILES</span>
        {/* Was "2024 SPEARMAN 0.763 · 2023 WINNER 86.4%", hardcoded. 86.4% did
            not correspond to anything the app computed — the current data has
            2023 Ridge at 81.8%. Read the live profile instead so it cannot
            drift again. */}
        <span>
          {modelStats?.all_metrics
            ? `${modelStats.selected_method?.toUpperCase()} · SPEARMAN ${Number(modelStats.all_metrics.spearman).toFixed(3)} · WINNER ${Number(modelStats.all_metrics.winner_acc).toFixed(1)}%`
            : "LOADING MODEL STATS"}
        </span>
      </div>

      </div>
    </div>
  )
}
