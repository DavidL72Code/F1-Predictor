import { useEffect, useMemo, useState } from "react"
import { motion, LayoutGroup } from "motion/react"
import { GroupedBars, RankedBars, DualLine, StatTile } from "./viz/Charts"
import { METRICS, CATEGORICAL_2, CATEGORICAL_3 } from "./viz/palette"
import "./viz/Charts.css"

const API = process.env.REACT_APP_API_URL?.replace(/\/$/, "")
  || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "/api")

const METRIC_KEYS = ["winner_acc", "podium_acc", "spearman", "ndcg", "within_3", "mae"]

/* The walk-forward benchmark compares three things, not four: the two base
   models and the blend of them. Three series fits the validated categorical
   palette exactly, with no facetting needed. */
const SERIES = [
  { key: "ridge_only", label: "Ridge", hue: CATEGORICAL_3[0] },
  { key: "xgboost_only", label: "XGBoost", hue: CATEGORICAL_3[1] },
  { key: "walk_forward", label: "Ensemble", hue: CATEGORICAL_3[2] },
]

/* /model/stats reports which method is actually deployed for the profile.
   Each profile picks the one that wins ITS metric, so the deployed model is
   not always the best on the metric currently being viewed — highlighting the
   best row instead of the live one would quietly misrepresent that. */
const METHOD_TO_SERIES = { baseline: "ridge_only", xgboost: "xgboost_only", ensemble: "walk_forward" }

function MetricSwitch({ value, onChange }) {
  return (
    <LayoutGroup id="metric-switch">
      <div className="metric-picker">
        <span className="metric-picker-label">SHOWING</span>
        <div className="metric-picker-options" role="tablist" aria-label="Metric">
          {METRIC_KEYS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={value === key}
              className={`metric-opt${value === key ? " active" : ""}`}
              onClick={() => onChange(key)}
            >
              {value === key && (
                <motion.span layoutId="metric-pill" className="metric-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }} />
              )}
              <span>{METRICS[key].label}</span>
            </button>
          ))}
        </div>
      </div>
    </LayoutGroup>
  )
}

function Section({ title, note, children, action }) {
  return (
    <section className="card viz-reveal">
      <header className="viz-head">
        <div>
          <h2 className="viz-title">{title}</h2>
          {note && <p className="viz-note">{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export default function AnalyticsPage({ analytics, modelStats, selectedProfile }) {
  const [metric, setMetric] = useState("winner_acc")
  const [showTable, setShowTable] = useState(false)
  const [wf, setWf] = useState(null)
  const [wfError, setWfError] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`${API}/analytics/walk-forward`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setWf(d))
      .catch(() => live && setWfError(true))
    return () => { live = false }
  }, [])

  const profile = wf?.profiles?.[selectedProfile] || wf?.profiles?.winner
  const bench = useMemo(() => profile?.walk_forward_benchmark || [], [profile])
  const meta = METRICS[metric]

  const rows = useMemo(
    () => bench.map((r) => ({
      year: r.year,
      ...Object.fromEntries(SERIES.map((s) => [s.key, r[s.key]?.[metric] ?? null])),
      races: r.walk_forward?.races,
    })),
    [bench, metric]
  )

  const averages = useMemo(
    () => SERIES.map((s) => {
      const vals = rows.map((r) => r[s.key]).filter((v) => v != null && isFinite(v))
      return { key: s.key, label: s.label, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null }
    }).filter((r) => r.value != null),
    [rows]
  )

  const ranked = useMemo(
    () => [...averages].sort((a, b) => (meta.better === "high" ? b.value - a.value : a.value - b.value)),
    [averages, meta]
  )

  const best = ranked[0]
  const seasonBest = useMemo(() => {
    if (!best) return null
    const vals = rows.map((r) => ({ year: r.year, v: r[best.key], races: r.races })).filter((r) => r.v != null)
    if (!vals.length) return null
    return vals.reduce((acc, r) => (meta.better === "high" ? (r.v > acc.v ? r : acc) : (r.v < acc.v ? r : acc)))
  }, [rows, best, meta])

  /* Seasons are not the same size — the in-progress one has a handful of races
     against 20+ for a completed season, so a headline percentage from it is far
     less certain than the identical-looking number beside it. */
  const median = useMemo(() => {
    const n = rows.map((r) => r.races).filter(Boolean).sort((a, b) => a - b)
    return n.length ? n[Math.floor(n.length / 2)] : 0
  }, [rows])
  const partial = useMemo(() => rows.filter((r) => r.races && r.races < median * 0.6), [rows, median])

  /* How often the blend actually beat both of the models it blends. Under the
     old procedure this was 11/11 by construction. */
  const beatsBoth = useMemo(
    () => bench.filter((r) => {
      const e = r.walk_forward?.[metric], a = r.ridge_only?.[metric], b = r.xgboost_only?.[metric]
      if ([e, a, b].some((v) => v == null)) return false
      return meta.better === "high" ? e > Math.max(a, b) : e < Math.min(a, b)
    }).length,
    [bench, metric, meta]
  )

  const liveKey = METHOD_TO_SERIES[modelStats?.selected_method] || null
  const liveLabel = SERIES.find((s) => s.key === liveKey)?.label
  const liveFeatures = modelStats?.features || []
  const profileLabel = modelStats?.profile_label || selectedProfile
  const alphaRows = useMemo(
    () => (analytics?.with_gap || []).map((d) => ({
      year: d.test_year,
      alphaWinner: d.best_alpha_winner,
      alphaPosition: d.best_alpha_position,
    })),
    [analytics]
  )

  if (wfError) {
    return (
      <div className="page viz-page">
        <div className="viz-loading"><span>WALK-FORWARD BENCHMARK UNAVAILABLE — RUN scripts/tune_alpha.py</span></div>
      </div>
    )
  }
  if (!wf) {
    return <div className="page viz-page"><div className="viz-loading"><span>LOADING ANALYTICS</span></div></div>
  }

  return (
    <div className="page viz-page">
      <motion.header
        className="viz-page-head"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <p className="kicker">MODEL ANALYSIS</p>
        <h1 className="viz-page-title">How the models actually perform</h1>
        <p className="viz-page-sub">
          Walk-forward evaluation: every race is predicted using only the rounds before it, and the
          blend weight is fitted the same way. <strong>{profileLabel}</strong> currently runs{" "}
          <strong>{liveLabel || "—"}</strong>, chosen as whichever method wins that profile's own metric.
        </p>
      </motion.header>

      {/* The control comes first and reads as a control — it drives every
          number on the page, and buried in a card header nobody found it. */}
      <MetricSwitch value={metric} onChange={setMetric} />

      <div className="viz-stats">
        <StatTile
          label="BEST AVERAGE"
          value={best ? meta.fmt(best.value) : "—"}
          note={best?.label}
          hue={best ? SERIES.find((s) => s.key === best.key)?.hue : undefined}
        />
        <StatTile
          label="BEST SEASON"
          value={seasonBest ? meta.fmt(seasonBest.v) : "—"}
          note={seasonBest ? `${best.label} · ${seasonBest.year} · ${seasonBest.races} races` : undefined}
        />
        <StatTile label="BLEND BEATS BOTH" value={`${beatsBoth}/${bench.length}`} note="seasons where the ensemble won" />
        <StatTile label="SEASONS TESTED" value={bench.length} note={`${bench[0]?.year}–${bench[bench.length - 1]?.year}`} />
      </div>

      <Section
        title={`${meta.label} by season`}
        note="Ridge, XGBoost and the blend of them, side by side, on one zero-based scale."
      >
        <GroupedBars
          data={rows}
          xKey="year"
          formatter={meta.fmt}
          highlightX={partial[0]?.year}
          series={SERIES.map((s) => ({ key: s.key, label: s.label, hue: s.hue }))}
        />
        <p className="viz-caption">
          The blend beat both base models in <strong>{beatsBoth} of {bench.length}</strong> seasons on this metric.
          The earlier benchmark reported 11 of 11 — but it chose the blend weight by maximising the
          score on the very season it was grading, and since one end of that weight is pure Ridge
          and the other is pure XGBoost, it could not lose. These figures fit the weight on prior
          rounds only.
        </p>
        {partial.length > 0 && (
          <p className="viz-caption">
            {partial.map((r) => `${r.year} (${r.races} races)`).join(", ")} {partial.length === 1 ? "is" : "are"} shaded
            because {partial.length === 1 ? "it is" : "they are"} still in progress. Drawn at the
            same weight as a {median}-race season, {partial[0].races} races look far more settled
            than they are — one more result can still move them substantially.
          </p>
        )}
      </Section>

      <Section
        title={`Average ${meta.label.toLowerCase()}, ranked`}
        note={`${meta.better === "high" ? "Higher is better." : "Lower is better."}${
          liveLabel && best && liveKey !== best.key
            ? ` ${liveLabel} is deployed for this profile even though ${best.label} leads on this particular metric — the profile selects on its own objective.`
            : ""
        }`}
        action={
          <button className="viz-table-toggle" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "SHOW CHART" : "SHOW TABLE"}
          </button>
        }
      >
        {showTable ? (
          <table className="viz-table">
            <thead>
              <tr><th>Model</th>{METRIC_KEYS.map((k) => <th key={k}>{METRICS[k].label}</th>)}</tr>
            </thead>
            <tbody>
              {SERIES.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  {METRIC_KEYS.map((k) => {
                    const vals = bench.map((r) => r[s.key]?.[k]).filter((v) => v != null)
                    return <td key={k}>{vals.length ? METRICS[k].fmt(vals.reduce((a, b) => a + b, 0) / vals.length) : "—"}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <RankedBars rows={ranked} hue={CATEGORICAL_2[0]} formatter={meta.fmt} highlightKey={liveKey} liveLabel="LIVE" />
        )}
      </Section>

      {alphaRows.length > 0 && (
        <Section
          title="Blend weight per season"
          note="α is how much of the ensemble comes from Ridge rather than XGBoost. These are the per-season values the old procedure produced — kept here because their instability is the point."
        >
          <DualLine
            data={alphaRows}
            xKey="year"
            formatter={(v) => Number(v).toFixed(2)}
            series={[
              { key: "alphaWinner", label: "Winner objective", hue: CATEGORICAL_2[0] },
              { key: "alphaPosition", label: "Full-order objective", hue: CATEGORICAL_2[1] },
            ]}
          />
          <p className="viz-caption">
            Swinging between 0 and 1 in consecutive seasons is what fitting ~20 races of noise looks
            like. The deployed model uses a single prior instead — <strong>α = {profile?.prior_alpha}</strong> for
            this profile, fitted only on earlier seasons.
          </p>
        </Section>
      )}

      <Section title="Live feature set" note={`${liveFeatures.length} features selected for the ${profileLabel} objective.`}>
        <div className="viz-features">
          {liveFeatures.map((f) => <span key={f} className="viz-feature">{f.replace(/_/g, " ")}</span>)}
        </div>
      </Section>
    </div>
  )
}
