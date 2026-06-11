import { useEffect, useRef, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts"
import "./App.css"

const API = process.env.REACT_APP_API_URL?.replace(/\/$/, "")
  || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "/api")
const BACKEND_KEEPALIVE_MS = 4 * 60 * 1000

const surname = (n) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").split(" ").pop()
const fmtCircuit = (c) => c?.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || ""
const posColor = (i) => i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "#2A2A3A"

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

const TRACK_PATH = "M 128 56 H 356 Q 416 56 416 116 V 204 Q 416 264 356 264 H 104 Q 44 264 44 204 V 116 Q 44 56 104 56 H 128"
const FINISH_LINE_X = 128
const LOADER_LAP_MS = 3200

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

/* ── Scroll progress bar across the top of the viewport ── */
const ScrollProgress = () => {
  const barRef = useRef(null)
  useEffect(() => {
    const onScroll = () => {
      const bar = barRef.current
      if (!bar) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      bar.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : "0%"
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])
  return <div className="scroll-progress" ref={barRef} />
}

/* ── Back-to-top button, appears after scrolling down ── */
const BackToTop = () => {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 500)
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

const Podium = ({ results }) => {
  if (!results?.length) return null
  const [p1, p2, p3] = [results[0], results[1], results[2]]
  const order = [p2, p1, p3]
  const heights = [80, 112, 60]
  const pos = [2, 1, 3]
  const colors = ["#C0C0C0", "#FFD700", "#CD7F32"]
  return (
    <div style={{ marginBottom: "28px" }}>
      <div className="card-label">PREDICTED PODIUM</div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "4px" }}>
        {order.map((driver, i) => (
          <div key={driver.driver} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <div style={{ textAlign: "center", width: "96px" }}>
              <div style={{ fontSize: "13px", fontWeight: "800", color: "#fff" }}>{surname(driver.driver)}</div>
              <div style={{ fontSize: "9px", color: TEAM_COLORS[driver.team] || "#888", letterSpacing: "0.5px", marginTop: "2px" }}>{driver.team.replace(/_/g, " ").toUpperCase()}</div>
              <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "2px" }}>{driver.win_probability}% win prob</div>
            </div>
            <div
              style={{
                width: "92px",
                height: `${heights[i]}px`,
                background: `linear-gradient(180deg,${TEAM_COLORS[driver.team] || "#888"}22,${TEAM_COLORS[driver.team] || "#888"}08)`,
                border: `1px solid ${TEAM_COLORS[driver.team] || "#888"}55`,
                borderBottom: "none",
                borderRadius: "6px 6px 0 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <div style={{ fontSize: "38px", fontWeight: "800", color: colors[i], opacity: 0.5 }}>{pos[i]}</div>
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "3px", background: TEAM_COLORS[driver.team] || "#888" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: "2px", background: "linear-gradient(90deg,transparent,#E8003D33,transparent)" }} />
    </div>
  )
}

const GridRow = ({ r, i, showActual }) => {
  const tc = TEAM_COLORS[r.team] || "#888"
  const diff = r.actual_position ? Math.abs(r.predicted_rank - r.actual_position) : null
  const color = diff === null ? "#333" : diff === 0 ? "#00A550" : diff <= 2 ? "#4488FF" : diff <= 4 ? "#FF6B00" : "#E8003D"
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 3px 1fr 90px 44px 50px",
        alignItems: "center",
        gap: "0 12px",
        padding: "8px 12px",
        marginBottom: "3px",
        borderRadius: "5px",
        background: i < 3 ? `${posColor(i)}08` : "var(--surface)",
        borderLeft: `3px solid ${i < 3 ? posColor(i) : tc}`,
      }}
    >
      <div className="num" style={{ fontSize: i < 3 ? "15px" : "12px", fontWeight: "800", color: posColor(i), textAlign: "center" }}>{i + 1}</div>
      <div style={{ width: "3px", height: "32px", background: tc, borderRadius: "2px" }} />
      <div>
        <div style={{ fontSize: "12px", fontWeight: "700", color: "#fff" }}>{surname(r.driver)}</div>
        <div style={{ fontSize: "9px", color: "var(--text-faint)", letterSpacing: "0.5px" }}>{r.team.replace(/_/g, " ").toUpperCase()} · +{r.quali_gap?.toFixed(3)}s</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <div style={{ flex: 1, height: "3px", background: "var(--border)", borderRadius: "2px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(r.win_probability * 2, 100)}%`, background: tc, borderRadius: "2px" }} />
        </div>
        <div className="num" style={{ fontSize: "10px", color: tc, fontWeight: "700", minWidth: "30px", textAlign: "right" }}>{r.win_probability}%</div>
      </div>
      <div className="num" style={{ textAlign: "center", fontSize: "10px", color: "var(--text-faint)" }}>P{r.grid}</div>
      {showActual && r.actual_position ? (
        <div className="num" style={{ textAlign: "center", padding: "3px 4px", borderRadius: "4px", background: `${color}15`, border: `1px solid ${color}55`, color, fontSize: "10px", fontWeight: "700" }}>P{r.actual_position}</div>
      ) : (
        <div style={{ textAlign: "center", fontSize: "10px", color: "var(--border)" }}>—</div>
      )}
    </div>
  )
}

const Reveal = ({ children, delay = 0 }) => {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("in"); obs.unobserve(el) } },
      { threshold: 0.06 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className="reveal" style={{ "--reveal-delay": `${delay}s` }}>{children}</div>
}

const AnalyticsHero = ({ children }) => {
  const heroRef = useRef(null)
  const contentRef = useRef(null)
  const slRef = useRef(null)

  useEffect(() => {
    const el = slRef.current
    if (el) {
      for (let i = 0; i < 30; i++) {
        const line = document.createElement("div")
        line.className = "sline"
        line.style.cssText = `top:${Math.random() * 100}%;width:${60 + Math.random() * 200}px;animation-duration:${0.28 + Math.random() * 0.6}s;animation-delay:${-Math.random() * 1.5}s;opacity:${0.05 + Math.random() * 0.18};`
        el.appendChild(line)
      }
    }

    const onScroll = () => {
      const hero = heroRef.current
      const content = contentRef.current
      if (!hero || !content) return
      const rect = hero.getBoundingClientRect()
      const progress = -rect.top / Math.max(rect.height, 1)
      content.style.transform = `translateY(${progress * 48}px) scale(${1 + progress * 0.04})`
      el.style.transform = `translateY(${progress * 28}px)`
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      if (el) el.innerHTML = ""
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <div className="analytics-hero" ref={heroRef}>
      <div className="speedlines" ref={slRef} />
      <div className="vignette" />
      <div className="analytics-hero-content" ref={contentRef}>{children}</div>
    </div>
  )
}

const AnalyticsPage = ({ analytics, modelStats, selectedProfile }) => {
  const [metric, setMetric] = useState("winner_acc")
  if (!analytics) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}><div style={{ fontSize: "12px", color: "var(--text-muted)", letterSpacing: "3px" }}>LOADING ANALYTICS...</div></div>
  const featureSearchBenchmark = modelStats?.feature_search_benchmark
  const data = featureSearchBenchmark?.rows || analytics.with_gap || []
  const METRICS = {
    winner_acc:{label:"Winner Accuracy %",fmt:(v)=>`${Number(v).toFixed(1)}%`},
    podium_acc:{label:"Podium Accuracy %",fmt:(v)=>`${Number(v).toFixed(1)}%`},
    spearman:{label:"Spearman Rank",fmt:(v)=>Number(v).toFixed(3)},
    mae:{label:"MAE (positions off)",fmt:(v)=>Number(v).toFixed(2)},
    ndcg:{label:"NDCG Score",fmt:(v)=>Number(v).toFixed(3)},
    within_3:{label:"Within 3 Positions %",fmt:(v)=>`${Number(v).toFixed(1)}%`},
  }
  const MODEL_META = [
    { key:"baseline", chartKey:"Baseline", label:"Ridge Baseline", short:"RIDGE", color:"#4488FF", desc:"Linear, stable, conservative" },
    { key:"xgboost", chartKey:"XGBoost", label:"XGBoost", short:"XGB", color:"#E8003D", desc:"Non-linear tree model" },
    { key:"ensemble_winner", chartKey:"Ens.Winner", label:"Ensemble (Winner)", short:"ENS-W", color:"#FFD700", desc:"Blend optimized for picking P1" },
    { key:"ensemble_position", chartKey:"Ens.Position", label:"Ensemble (Position)", short:"ENS-P", color:"#00A550", desc:"Blend optimized for full-grid order" },
  ]
  const SUMMARY_METRICS = ["winner_acc", "podium_acc", "spearman", "mae"]
  const liveFeatures = modelStats?.features || []
  const benchmarkYears = featureSearchBenchmark?.years || []
  const activeProfile = MODEL_PROFILES.find((profile) => profile.key === selectedProfile)
  const profileLabel = modelStats?.profile_label || activeProfile?.label || "Profile"
  const profileDescription = modelStats?.profile_description || activeProfile?.description || ""
  const objectiveMetric = modelStats?.objective_metric
  const objectiveValue = modelStats?.objective_value
  const selectedMethod = modelStats?.selected_method
  const averageMetricValue = (modelKey, metricKey) => {
    const rows = data.filter((d) => d[modelKey]?.[metricKey] !== undefined && d[modelKey]?.[metricKey] !== null)
    if (!rows.length) return null
    return rows.reduce((sum, row) => sum + row[modelKey][metricKey], 0) / rows.length
  }
  const averageOverallStats = MODEL_META.map((model) => ({
    ...model,
    stats: Object.fromEntries(
      SUMMARY_METRICS.map((metricKey) => [
        metricKey,
        featureSearchBenchmark?.averages?.[model.key]?.[metricKey] ?? averageMetricValue(model.key, metricKey),
      ])
    ),
  }))
  const m = METRICS[metric]
  const chartData = data.map((d) => ({
    year: d.test_year,
    Baseline: d.baseline[metric],
    XGBoost: d.xgboost[metric],
    "Ens.Winner": d.ensemble_winner?.[metric],
    "Ens.Position": d.ensemble_position?.[metric],
    is2022: d.test_year === 2022,
  }))
  const MODEL_COLORS = { Baseline:"#4488FF", XGBoost:"#E8003D", "Ens.Winner":"#FFD700", "Ens.Position":"#00A550" }
  const CustomBar = (props) => {
    const { x, y, width, height, fill, payload, dataKey } = props
    return <rect x={x} y={y} width={width} height={height} fill={fill} opacity={payload?.is2022 && dataKey === "XGBoost" ? 0.4 : 1} rx={2} />
  }
  return (
    <div>
      <AnalyticsHero>
        <div className="kicker">MODEL ANALYSIS</div>
        <div className="page-title">Top Feature Set Performance</div>
        <div className="page-sub">
          {data.length} evaluation windows · <span style={{ color: "#fff" }}>{profileLabel}</span> profile · 4 models
        </div>
      </AnalyticsHero>
      <div className="page">
      <Reveal>
        <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", marginBottom: "14px" }}>
            <div>
              <div className="kicker">ACTIVE PROFILE</div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: "1.7", maxWidth: "720px" }}>
                <span style={{ color: "#fff", fontWeight: "700" }}>{profileLabel}</span> is active.
                {profileDescription ? ` ${profileDescription}` : ""}
                {objectiveMetric && objectiveValue !== undefined && objectiveValue !== null ? (
                  <>
                    {" "}Feature-search selected score: <span style={{ color: "#fff", fontWeight: "700" }}>
                      {METRICS[objectiveMetric]?.fmt ? METRICS[objectiveMetric].fmt(objectiveValue) : Number(objectiveValue).toFixed(3)}
                    </span>
                    {selectedMethod ? ` via ${selectedMethod}.` : "."}
                  </>
                ) : "."}
                {benchmarkYears.length > 0 ? ` Benchmark window: ${benchmarkYears.join(", ")}.` : ""}
              </div>
            </div>
            <div style={{ alignSelf: "flex-start", padding: "10px 14px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: "6px", textAlign: "center" }}>
              <div style={{ fontSize: "9px", color: "var(--text-faint)", letterSpacing: "2px", marginBottom: "4px" }}>ACTIVE MODE</div>
              <div style={{ fontSize: "12px", color: "#fff", fontWeight: "700" }}>{liveFeatures.length || 10} FEATURES</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {liveFeatures.map((feature) => (
              <div key={feature} style={{ fontSize: "11px", color: "var(--text-muted)", padding: "6px 11px", border: "1px solid var(--border)", borderRadius: "14px", background: "var(--surface-2)" }}>
                {feature.replace(/_/g, " ")}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal delay={0.05}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div>
              <div className="card-label">AVERAGE PERFORMANCE BY METHOD</div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: "1.7", maxWidth: "720px" }}>
                Average performance for each method on the active profile's benchmark window.
              </div>
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-faint)", letterSpacing: "1.5px", alignSelf: "flex-start" }}>
              {benchmarkYears.length > 0 ? benchmarkYears.join(" · ") : "TOP FEATURE SET, AVERAGED"}
            </div>
          </div>
          <div className="card-grid">
            {averageOverallStats.map((model) => (
              <div key={model.key} className="tile" style={{ borderTop: `3px solid ${model.color}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: model.color, marginBottom: "4px" }}>{model.label}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-faint)", lineHeight: "1.5" }}>{model.desc}</div>
                  </div>
                  <div style={{ fontSize: "9px", color: "var(--text-faint)", letterSpacing: "1.5px" }}>{model.short}</div>
                </div>
                {SUMMARY_METRICS.map((metricKey) => (
                  <div key={metricKey} style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "11px", color: "var(--text-faint)" }}>{METRICS[metricKey].label}</div>
                    <div className="num" style={{ fontSize: "12px", color: "#fff", fontWeight: "700" }}>
                      {model.stats[metricKey] === null ? "n/a" : METRICS[metricKey].fmt(model.stats[metricKey])}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal>
        <div style={{ marginBottom: "14px" }}>
          <div className="card-label">BY YEAR BREAKDOWN</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {Object.entries(METRICS).map(([key]) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={`profile-chip${metric === key ? " active" : ""}`}
              >
                {key.replace(/_/g, " ").toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal>
        <div className="card">
          <div className="card-label">
            {m.label.toUpperCase()} — ALL 4 MODELS BY SEASON
            <span style={{ color: "var(--text-faint)", fontWeight: "400", letterSpacing: "0.5px" }}> (2022 XGBoost faded = concept drift)</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid stroke="#1A1A2A" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#5A5A70", fontSize: 11 }} axisLine={{ stroke: "#1A1A2A" }} tickLine={false} />
              <YAxis tick={{ fill: "#3A3A4A", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0A0A14", border: "1px solid #262638", borderRadius: "6px", fontSize: "12px" }}
                labelStyle={{ color: "#fff", fontWeight: "700", marginBottom: "4px" }}
                formatter={(val, name) => [m.fmt(val), name]}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "#5A5A70" }} />
              {Object.entries(MODEL_COLORS).map(([name, color]) => (
                <Bar key={name} dataKey={name} fill={color} maxBarSize={18} shape={<CustomBar dataKey={name} />} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Reveal>
      <Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(112px,1fr))", gap: "8px", marginBottom: "16px" }}>
          {data.map((d) => {
            const borderColor = d.test_year === 2022 ? "#E8003D" : d.test_year === 2026 ? "#3671C6" : "#FF6B00"
            return (
              <div key={d.test_year} className="tile" style={{ borderTop: `3px solid ${borderColor}`, minWidth: "100px", padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div className="num" style={{ fontSize: "16px", fontWeight: "800", color: "#fff" }}>{d.test_year}</div>
                  {d.test_year === 2022 && <div style={{ fontSize: "7px", color: "#E8003D", background: "#E8003D15", padding: "2px 5px", borderRadius: "3px" }}>REG RESET</div>}
                  {d.test_year === 2026 && <div style={{ fontSize: "7px", color: "#3671C6", background: "#3671C615", padding: "2px 5px", borderRadius: "3px" }}>2 RACES</div>}
                </div>
                {[
                  {label:"BASE",val:d.baseline[metric],color:"#4488FF"},
                  {label:"XGB",val:d.xgboost[metric],color:"#E8003D"},
                  {label:"ENS-W",val:d.ensemble_winner?.[metric],color:"#FFD700"},
                  {label:"ENS-P",val:d.ensemble_position?.[metric],color:"#00A550"},
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                    <div style={{ fontSize: "9px", color: "var(--text-faint)" }}>{row.label}</div>
                    <div className="num" style={{ fontSize: "10px", color: row.color, fontWeight: "700" }}>{m.fmt(row.val)}</div>
                  </div>
                ))}
                <div className="num" style={{ marginTop: "6px", fontSize: "8px", color: "var(--text-faint)" }}>
                  αW={d.best_alpha_winner ?? d.best_alpha ?? "-"} αP={d.best_alpha_position ?? "-"}
                </div>
              </div>
            )
          })}
        </div>
      </Reveal>
      <Reveal>
        <div className="card">
          <div className="card-label">MODEL KEY</div>
          <div className="card-grid">
            {[
              {color:"#4488FF",name:"Ridge Baseline",desc:"Linear — stable, conservative"},
              {color:"#E8003D",name:"XGBoost",desc:"300 decision trees — non-linear patterns"},
              {color:"#FFD700",name:"Ensemble (Winner)",desc:"Winner-optimized blend — used in SIMULATE RACE ★"},
              {color:"#00A550",name:"Ensemble (Position)",desc:"Spearman-optimized — best full grid ranking"},
            ].map((mKey) => (
              <div key={mKey.name} className="tile" style={{ borderLeft: `2px solid ${mKey.color}55` }}>
                <div className="tile-title" style={{ color: mKey.color }}>{mKey.name}</div>
                <div className="tile-desc">{mKey.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
      <Reveal>
        <div className="card">
          <div className="card-label">METRIC GLOSSARY</div>
          <div className="card-grid">
            {[
              {name:"Winner Accuracy",color:"#E8003D",desc:"% of races where the predicted P1 driver actually won."},
              {name:"Podium Accuracy",color:"#00A550",desc:"% of races where all 3 predicted podium drivers matched P1/P2/P3 exactly."},
              {name:"Spearman Rank",color:"#4488FF",desc:"Correlation of predicted vs actual order all 20 drivers. 1.0 = perfect."},
              {name:"MAE",color:"#27F4D2",desc:"Mean Absolute Error in positions. Lower is better."},
              {name:"NDCG",color:"#FF6B00",desc:"Like Spearman but top positions matter more. Missing P1 hurts more than missing P17."},
              {name:"Within 3 Positions",color:"#AAA",desc:"% of predictions landing within 3 positions of reality."},
            ].map((g) => (
              <div key={g.name} className="tile" style={{ borderLeft: `2px solid ${g.color}44` }}>
                <div className="tile-title" style={{ color: g.color }}>{g.name}</div>
                <div className="tile-desc">{g.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
      </div>
    </div>
  )
}

const HOOD_SECTIONS = [
  { id: "hood-overview", label: "Overview" },
  { id: "hood-features", label: "Feature Set" },
  { id: "hood-models", label: "Model Types" },
  { id: "hood-accuracy", label: "Why Not 100%" },
  { id: "hood-data", label: "Data Effects" },
  { id: "hood-drift", label: "2022 Drift" },
  { id: "hood-future", label: "Future Races" },
]

const UnderTheHoodPage = () => {
  const [activeSection, setActiveSection] = useState(HOOD_SECTIONS[0].id)

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    )
    HOOD_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  const scrollToSection = (e, id) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div>
      <AnalyticsHero>
        <div className="kicker" style={{ color: "#fff" }}>TECHNICAL DEEP DIVE</div>
        <div className="page-title">Under The Hood</div>
        <div className="page-sub">How the prediction engine actually works — models, features, data, and limitations</div>
      </AnalyticsHero>
      <div className="page">

      <div className="hood-layout">
        <div className="hood-sidebar">
          <div className="card" style={{ padding: "16px" }}>
            <div className="card-label" style={{ marginBottom: "10px" }}>SECTIONS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {HOOD_SECTIONS.map((section, index) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={(e) => scrollToSection(e, section.id)}
                  className={`hood-nav-link${activeSection === section.id ? " active" : ""}`}
                >
                  {index + 1}. {section.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="hood-content">
          <Reveal>
          <section id="hood-overview" className="hood-section">
            <h2>Overview</h2>
            <div className="prose">
              The predictor is trained on rolling historical F1 race data and tries to estimate the full finishing order, not just a yes-or-no winner label. That matters because the model is really solving a ranking problem: who is likely to finish ahead of whom across the whole grid.
              <br /><br />
              The app exposes two prediction profiles. <strong>Winner-Centric</strong> is tuned to maximize P1 hit rate. <strong>Full Finishing Order</strong> is tuned to give the strongest overall race ranking. Same race, same inputs, different optimization target.
              <br /><br />
              The data pipeline combines historical race results, qualifying data, qualifying gaps, constructor standings, tyre compounds, and weather context into the inputs used by the prediction models.
            </div>
            <h3>Tech Stack</h3>
            <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
              {[
                { name: "FastAPI", desc: "Backend API" },
                { name: "React", desc: "Frontend UI" },
                { name: "Pandas", desc: "Data pipeline" },
                { name: "scikit-learn", desc: "Ridge and scaling" },
                { name: "XGBoost", desc: "Tree ensemble" },
                { name: "Recharts", desc: "Charts" },
              ].map((item) => (
                <div key={item.name} className="tile">
                  <div className="tile-title">{item.name}</div>
                  <div className="tile-desc">{item.desc}</div>
                </div>
              ))}
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-features" className="hood-section">
            <h2>How We Chose the Feature Set</h2>
            <div className="two-col">
              <div className="prose">
                We did not just throw every engineered feature into the live model and hope for the best. More features can help, but they can also create overfitting, especially when the sport changes quickly across regulation eras, circuits, tyre behavior, and team performance cycles.
                <br /><br />
                So the project ran feature-search experiments to compare many combinations across winner accuracy, Spearman rank correlation, MAE, and podium accuracy. That is why the app now supports two profile-specific feature sets instead of pretending one single set is best for every objective.
              </div>
              <div className="prose">
                The winner profile keeps features that help identify who is most likely to win right now. The full-order profile leans more toward features that improve grid-wide ordering quality.
                <br /><br />
                Stable signals like grid, qualifying position, driver form, constructor strength, and team identity matter a lot because they repeatedly showed up in the strongest searches. More situational features like weather, tyres, or circuit encodings are useful too, but only when they improve the target metric without adding too much noise.
              </div>
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-models" className="hood-section">
            <h2>Model Types</h2>
            <div className="two-col" style={{ gap: "12px" }}>
              <div className="tile" style={{ padding: "22px" }}>
                <div className="tile-title" style={{ fontSize: "16px", marginBottom: "12px" }}>Ridge Regression</div>
                <div className="prose">
                  Ridge draws one straight line: position = w1×grid + w2×quali_gap + w3×driver_form + ...
                  <br /><br />
                  <strong>Best at:</strong> stable, dominated seasons where simple pre-race strength maps well to finishing result.
                  <br /><br />
                  <strong>Weak at:</strong> non-linear race situations where small context changes create very different outcomes.
                </div>
              </div>
              <div className="tile" style={{ padding: "22px" }}>
                <div className="tile-title" style={{ fontSize: "16px", marginBottom: "12px" }}>XGBoost</div>
                <div className="prose">
                  XGBoost builds many sequential trees that learn interactions such as qualifying gap, circuit behavior, constructor form, weather, and recent reliability.
                  <br /><br />
                  <strong>Best at:</strong> competitive seasons where race order depends on more than one linear trend.
                  <br /><br />
                  <strong>Weak at:</strong> concept drift, where the historical pattern it learned no longer matches the current season.
                </div>
              </div>
              <div className="tile" style={{ padding: "22px" }}>
                <div className="tile-title" style={{ fontSize: "16px", marginBottom: "12px" }}>Winner Ensemble</div>
                <div className="prose">
                  final = α×Ridge + (1-α)×XGBoost, with α tuned to improve winner accuracy.
                  <br /><br />
                  <strong>Why it exists:</strong> sometimes the safest model is better for P1, and sometimes the aggressive one is. The blend lets us land between them.
                  <br /><br />
                  This is the right profile when the user mainly cares about who wins.
                </div>
              </div>
              <div className="tile" style={{ padding: "22px" }}>
                <div className="tile-title" style={{ fontSize: "16px", marginBottom: "12px" }}>Full-Order Ensemble</div>
                <div className="prose">
                  Same blend idea, but α is tuned for ranking quality metrics like Spearman and MAE.
                  <br /><br />
                  <strong>Why it exists:</strong> the best full-grid model is not always the best winner-picking model.
                  <br /><br />
                  This is the right profile when the user cares about the whole classification, not only P1.
                </div>
              </div>
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-accuracy" className="hood-section">
            <h2>Why the Model Is Not 100% Right</h2>
            <div className="two-col">
              <div className="prose">
                F1 is not a closed system. Even with strong pre-race features, the model does not know every in-race event that will decide the result: safety cars, VSC timing, bad pit stops, tyre degradation surprises, rain arriving early or late, first-lap contact, mechanical failures, red flags, strategy gambles, and driver mistakes.
                <br /><br />
                That means there is a hard ceiling on accuracy. A model can be very useful without being anywhere close to 100%, because the sport itself is noisy and often chaotic.
              </div>
              <div className="prose">
                Even 80% winner accuracy is unrealistic in a tightly matched era. In dominant seasons, one driver or team can make the race easy to predict. In competitive seasons, several front-runners can all plausibly win on merit, strategy, or circumstance.
                <br /><br />
                So when winner accuracy drops while Spearman stays strong, that usually means the model still understands the competitive order fairly well, but the difference between P1, P2, and P3 is too small and too unstable to call perfectly every weekend.
              </div>
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-data" className="hood-section">
            <h2>How Data Shapes the Results</h2>
            <div className="two-col">
              <div className="prose">
                More data helps, but only if it is relevant. Expanding the historical window gave the models more regulation cycles, circuit types, and driver/team combinations to learn from. That improved robustness compared with a shorter training span.
                <br /><br />
                Feature quality beats model complexity. Real qualifying gaps, constructor standings, tyre compounds, and race weather add signal the older version did not use. Better inputs often matter more than adding another fancy model layer.
              </div>
              <div className="prose">
                Rolling training prevents leakage. Each evaluation year only trains on seasons that happened before it. That keeps the benchmark honest and closer to real deployment.
                <br /><br />
                Competitive eras reduce winner accuracy naturally. When four teams can realistically win, there is simply less predictable separation at the top than in a one-team-dominant season.
              </div>
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-drift" className="hood-section">
            <h2>2022 Concept Drift</h2>
            <div className="prose">
              2022 introduced completely new ground-effect regulations, which changed the pecking order fast. Historical team-strength assumptions that looked safe through 2021 stopped being safe almost overnight.
              <br /><br />
              That is why XGBoost can struggle more than Ridge in drift-heavy years. A flexible model learns richer patterns, but it also has more ways to learn patterns that later expire. The ensemble recovered by leaning much harder on Ridge once the aggressive tree model became less trustworthy.
              <br /><br />
              This is a reminder that model quality is not just about fitting the past. It is also about surviving when the sport changes.
            </div>
          </section>
          </Reveal>

          <Reveal>
          <section id="hood-future" className="hood-section">
            <h2>Future Race Prediction</h2>
            <div className="prose">
              For upcoming races with no qualifying session yet, the app has to make several equal-assumption inputs: similar grid, neutral tyre choice, and dry conditions. That means future-race predictions lean more on longer-term competitive signals like form, constructor strength, reliability, and circuit history.
              <br /><br />
              Recent 2026 races get extra weight so the model does not over-anchor on old eras. That nudges the output toward the current competitive order while still preserving enough historical data to avoid learning from a tiny sample.
              <br /><br />
              Limitation: before qualifying, two teammates with similar form can still look very close. Once real qualifying gaps arrive, prediction quality should improve because the model finally gets the strongest same-weekend pace signal.
            </div>
          </section>
          </Reveal>
        </div>
      </div>
      </div>
    </div>
  )
}

const RaceSimulator = ({ results }) => {
  const [phase, setPhase] = useState("idle")
  const slRef = useRef(null)
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const simulate = () => {
    if (phase === "running") return
    setPhase("running")
    const c = slRef.current
    if (c) {
      c.innerHTML = ""
      for (let i = 0; i < 22; i++) {
        const el = document.createElement("div")
        el.className = "sline"
        el.style.cssText = `top:${Math.random() * 100}%;width:${40 + Math.random() * 140}px;animation-duration:${0.18 + Math.random() * 0.35}s;animation-delay:${-Math.random() * 0.5}s;opacity:${0.12 + Math.random() * 0.32};`
        c.appendChild(el)
      }
    }
    timerRef.current = setTimeout(() => { setPhase("done"); if (c) c.innerHTML = "" }, 4200)
  }

  const reset = () => { clearTimeout(timerRef.current); setPhase("idle") }
  const active = phase !== "idle"
  const gridOrder = [...results].sort((a, b) => a.grid - b.grid)

  return (
    <div className="sim-shell">
      <div className="sim-speedlines" ref={slRef} />
      <div className="sim-header">
        <div>
          <div className="kicker" style={{ marginBottom: "4px" }}>RACE SIMULATION</div>
          <div style={{ fontSize: "12px", color: "var(--text-faint)" }}>
            {phase === "idle" ? "Animate predicted finishing positions from grid" : phase === "running" ? "Lights out and away we go..." : "Chequered flag — predicted result"}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={simulate} disabled={phase === "running"} className="btn-primary" style={{ padding: "9px 22px", fontSize: "11px" }}>
            {phase === "idle" ? "▶ SIMULATE" : phase === "running" ? "RACING..." : "▶ REPLAY"}
          </button>
          {phase !== "idle" && <button onClick={reset} className="btn-ghost">RESET</button>}
        </div>
      </div>
      <div className="sim-lanes">
        {gridOrder.map((driver, i) => {
          const finishPos = results.findIndex(r => r.driver === driver.driver) + 1
          const tc = TEAM_COLORS[driver.team] || "#888"
          const startPct = 4 + (20 - driver.grid) * 0.3
          const finishPct = 95 - (finishPos - 1) * 3.5
          return (
            <div key={driver.driver} className="sim-lane">
              <div className="sim-lane-label">
                <span style={{ color: "var(--border-strong)" }}>G{driver.grid}</span> {surname(driver.driver)}
              </div>
              <div className="sim-lane-track">
                <div
                  className="sim-car-fill"
                  style={{
                    width: active ? `${finishPct}%` : `${startPct}%`,
                    background: `linear-gradient(90deg,${tc}20,${tc}70)`,
                    borderRight: `3px solid ${tc}`,
                    transition: active ? `width 2.6s cubic-bezier(0.2,0.8,0.4,1) ${i * 0.07}s` : "width 0.1s",
                  }}
                />
              </div>
              {phase === "done" && (
                <div className="num" style={{ fontSize: "11px", color: tc, fontWeight: "800", width: "26px", textAlign: "right", flexShrink: 0 }}>P{finishPos}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const IMG_URL = `${process.env.PUBLIC_URL}/f1-car.png`

function HeroStage({ years, selectedYear, setYear, raceOptions, selectedRaceKey, setSelectedRaceKey, predict, loading, modelStats, selectedProfile, error }) {
  const frameRef = useRef(null)

  const imgStyle = { "--img": `url("${IMG_URL}")` }

  return (
    <div className="stage">
      <div className="frame" ref={frameRef} style={imgStyle}>
        <div className="layer sharp" style={imgStyle} />
        <div className="layer ghost g1" style={imgStyle} />
        <div className="layer ghost g2" style={imgStyle} />
        <div className="layer ghost g3" style={imgStyle} />
        <div className="speedlines" />
        <div className="vignette" />
        <div className="hero-fade" />
      </div>

      <div className="controls">
        <div className="controls-head">
          <div className="kicker" style={{ marginBottom: "4px" }}>SELECT RACE</div>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)" }}>
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
          <button onClick={predict} disabled={loading || !selectedRaceKey} className="btn-primary">
            ▶ PREDICT RACE
          </button>
        </div>
        {error && <div className="hero-error">{error}</div>}
        <div className="hero-stat-chips">
          {[
            {label:"2016 WINNER ACC",val:"66.7%",color:"#4488FF"},
            {label:"2023 WINNER ACC",val:"86.4%",color:"#00A550"},
            {label:"2024 SPEARMAN",val:"0.763",color:"#FFD700"},
            {label:"2024 MAE",val:"2.90p",color:"#FF6B00"},
          ].map((s) => (
            <div key={s.label} className="hero-stat-chip" style={{ "--chip-color": s.color }}>
              <div className="chip-label">{s.label}</div>
              <div className="chip-value num" style={{ color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState("predict")
  const [selectedProfile, setSelectedProfile] = useState("winner")
  const [races, setRaces] = useState([])
  const [years, setYears] = useState([])
  const [raceOptions, setRaceOptions] = useState([])
  const [selectedYear, setYear] = useState(2026)
  const [selectedRaceKey, setSelectedRaceKey] = useState("")
  const [results, setResults] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [raceInfo, setRaceInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showActual, setShowActual] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [modelStats, setModelStats] = useState(null)
  const [isFuture, setIsFuture] = useState(false)
  const [futureNote, setFutureNote] = useState("")
  const [error, setError] = useState("")

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
    fetch(`${API}/races`)
      .then((r) => {
        if (!r.ok) {
          return readErrorMessage(r, `Race list request failed with status ${r.status}`).then((message) => {
            throw new Error(message)
          })
        }
        return r.json()
      })
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

    fetch(`${API}/analytics`)
      .then((r) => r.json())
      .then(setAnalytics)
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch(`${API}/model/stats?profile=${encodeURIComponent(selectedProfile)}`)
      .then((r) => {
        if (!r.ok) {
          return readErrorMessage(r, `Model stats request failed with status ${r.status}`).then((message) => {
            throw new Error(message)
          })
        }
        return r.json()
      })
      .then(setModelStats)
      .catch(console.error)
  }, [selectedProfile])

  useEffect(() => {
    if (!Array.isArray(races)) return
    const rs = races.filter((r) => r.year === selectedYear).sort((a, b) => a.round - b.round)
    setRaceOptions(rs)
    setSelectedRaceKey(rs[0]?.key || "")
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")
  }, [selectedYear, races])

  useEffect(() => {
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")
    setError("")
  }, [selectedProfile])

  const predict = async () => {
    const selectedRace = raceOptions.find((r) => r.key === selectedRaceKey)
    if (!selectedRace) return

    const minLoadingMs = LOADER_LAP_MS
    const startedAt = Date.now()

    setError("")
    setLoading(true)
    setResults(null)
    setAccuracy(null)
    setRaceInfo(null)
    setIsFuture(false)
    setFutureNote("")

    try {
      const res = await fetch(`${API}/races/${selectedYear}/${selectedRace.round}?profile=${encodeURIComponent(selectedProfile)}`)
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, `Prediction request failed with status ${res.status}`))
      }
      const data = await res.json()
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

  return (
    <div style={{ minHeight: "100vh" }}>
      <ScrollProgress />
      <BackToTop />

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

      {page === "analytics" && <AnalyticsPage analytics={analytics} modelStats={modelStats} selectedProfile={selectedProfile} />}
      {page === "hood" && <UnderTheHoodPage />}

      {page === "predict" && (
        <>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "65vh" }}>
              <RaceCarLoader />
            </div>
          )}

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
            />
          )}

          {!loading && results && (
            <div className="page" style={{ animation: "fadeUp 0.3s ease" }}>

              <div className="selector-bar">
                <div className="field">
                  <span className="field-label">YEAR</span>
                  <select value={selectedYear} onChange={(e) => setYear(Number(e.target.value))} className="select">
                    {years.map((y) => <option key={y} value={y}>{y}{y === 2026 ? " (Current Season)" : ""}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">CIRCUIT</span>
                  <select value={selectedRaceKey} onChange={(e) => setSelectedRaceKey(e.target.value)} className="select" style={{ minWidth: "260px" }}>
                    {raceOptions.map((r) => <option key={r.key} value={r.key}>{r.name}{r.is_future ? " ◆ Future" : ""}</option>)}
                  </select>
                </div>
                <button onClick={predict} disabled={loading || !selectedRaceKey} className="btn-primary">
                  ▶ PREDICT RACE
                </button>
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
                  <Podium results={results} />
                  <div className="card" style={{ padding: "16px" }}>
                    <div className="card-label" style={{ marginBottom: "10px" }}>{isFuture ? "PREDICTION METHOD" : "ACTUAL POSITION KEY"}</div>
                    {isFuture ? (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.8" }}>
                        {raceInfo?.profileLabel || modelStats?.profile_label}<br />
                        2026 weighted 10x, 2025 weighted 3x<br />
                        Equal grid, medium tyre, dry track assumed<br />
                        No actual results available yet
                      </div>
                    ) : [
                      {color:"#00A550",label:"Exact match"},
                      {color:"#4488FF",label:"Within 2 positions"},
                      {color:"#FF6B00",label:"Within 4 positions"},
                      {color:"#E8003D",label:"Missed by 5+"},
                    ].map((k) => (
                      <div key={k.label} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: `${k.color}22`, border: `1px solid ${k.color}` }} />
                        <div style={{ fontSize: "11px", color: "var(--text-faint)" }}>{k.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "32px 3px 1fr 90px 44px 50px", gap: "0 12px", padding: "6px 12px", fontSize: "9px", color: "var(--text-faint)", letterSpacing: "1.5px", borderBottom: "1px solid var(--border)", marginBottom: "6px" }}>
                    <div style={{ textAlign: "center" }}>POS</div><div />
                    <div>DRIVER</div><div>WIN PROB</div>
                    <div style={{ textAlign: "center" }}>GRID</div>
                    <div style={{ textAlign: "center" }}>{showActual && !isFuture ? "ACTUAL" : "—"}</div>
                  </div>
                  {results.map((r, i) => <GridRow key={r.driver} r={r} i={i} showActual={showActual && !isFuture} />)}
                </div>
              </div>
              <RaceSimulator results={results} />
            </div>
          )}
        </>
      )}

      <div className="footer">
        <span>F1 STRATEGY LAB — 2015–2026</span>
        <span>4 MODELS · WINNER + FULL ORDER PROFILES · TYRE + WEATHER FEATURES</span>
        <span>2024 SPEARMAN 0.763 · 2023 WINNER 86.4%</span>
      </div>
    </div>
  )
}
