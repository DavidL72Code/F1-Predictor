import { useEffect, useMemo, useState } from "react"
import { motion, LayoutGroup } from "motion/react"
import { GroupedBars } from "./viz/Charts"
import { MODEL_HUE, CATEGORICAL_2, CATEGORICAL_3, METRICS } from "./viz/palette"
import "./viz/Charts.css"
import "./UnderTheHood.css"

const SECTIONS = [
  { id: "hood-overview", n: "01", label: "What it predicts" },
  { id: "hood-features", n: "02", label: "Choosing features" },
  { id: "hood-models", n: "03", label: "The four models" },
  { id: "hood-blend", n: "04", label: "The blend" },
  { id: "hood-ceiling", n: "05", label: "Why not 100%" },
  { id: "hood-drift", n: "06", label: "The 2022 drift" },
  { id: "hood-future", n: "07", label: "Future races" },
]

const MODEL_CARDS = [
  {
    key: "baseline",
    name: "Ridge Baseline",
    formula: "position = w₁·grid + w₂·quali_gap + w₃·driver_form + …",
    strong: "Picking the winner — best of the three at 62.5%, so it powers Winner-Centric.",
    weak: "Non-linear situations where small context changes flip the outcome.",
  },
  {
    key: "xgboost",
    name: "XGBoost",
    formula: "many sequential trees, each correcting the last",
    strong: "Competitive seasons where order depends on more than one linear trend.",
    weak: "Concept drift — the pattern it learned no longer matches the season.",
  },
  {
    key: "ensemble_winner",
    name: "Ensemble · Winner",
    formula: "final = α·Ridge + (1−α)·XGBoost,  α tuned for P1 hit rate",
    strong: "Ranking metrics — it lifts Spearman and MAE across the grid.",
    weak: "Picking the winner. Walk-forward testing put it below plain Ridge on winner accuracy, so the Winner-Centric profile does not use it.",
  },
  {
    key: "ensemble_position",
    name: "Ensemble · Position",
    formula: "same blend, α tuned for Spearman and MAE",
    strong: "Ordering the whole classification. Lowest MAE of the three, so it powers Full Finishing Order.",
    weak: "Its edge is small — about 0.005 Spearman over Ridge alone.",
  },
]

/* The honest part of the story: what the model cannot see. */
const UNKNOWNS = [
  "Safety cars", "Virtual safety cars", "First-lap contact", "Mechanical DNFs",
  "Strategy gambles", "Mid-race weather", "Pit-lane errors", "Penalties",
]

function BlendDemo() {
  const [alpha, setAlpha] = useState(0.5)
  /* Illustrative, not a live prediction — the point is the shape of the
     trade-off, so it is labelled as a sketch rather than dressed as data. */
  const ridge = 51.7
  const xgb = 45.3
  const blended = alpha * ridge + (1 - alpha) * xgb
  return (
    <div className="hood-blend">
      <div className="hood-blend-formula num">
        final = <b style={{ color: CATEGORICAL_2[0] }}>α</b>·Ridge + (1−<b style={{ color: CATEGORICAL_2[0] }}>α</b>)·XGBoost
      </div>
      <label className="hood-slider">
        <span className="num">α = {alpha.toFixed(2)}</span>
        <input
          type="range" min="0" max="1" step="0.01" value={alpha}
          onChange={(e) => setAlpha(Number(e.target.value))}
          aria-label="Blend weight alpha"
        />
      </label>
      <div className="hood-blend-bars">
        {[
          { label: "Ridge", value: ridge, weight: alpha, hue: MODEL_HUE.baseline },
          { label: "XGBoost", value: xgb, weight: 1 - alpha, hue: MODEL_HUE.xgboost },
        ].map((r) => (
          <div key={r.label} className="hood-blend-row">
            <span className="hood-blend-name">{r.label}</span>
            <div className="hood-blend-track">
              <motion.span
                className="hood-blend-fill"
                style={{ background: r.hue }}
                animate={{ width: `${r.weight * 100}%` }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
              />
            </div>
            <span className="hood-blend-pct num">{(r.weight * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <div className="hood-blend-out">
        <span className="hood-blend-out-label">ILLUSTRATIVE WINNER ACCURACY</span>
        <motion.span key={blended.toFixed(1)} className="hood-blend-out-value num"
          initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          {blended.toFixed(1)}%
        </motion.span>
        <span className="hood-blend-out-note">
          A sketch of the trade-off, not a live prediction. The real α is re-tuned every season.
        </span>
      </div>
    </div>
  )
}

export default function UnderTheHoodPage({ analytics }) {
  const [active, setActive] = useState(SECTIONS[0].id)

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-25% 0px -60% 0px" }
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  const driftRows = useMemo(
    () => (analytics?.with_gap || []).map((d) => ({
      year: d.test_year,
      baseline: d.baseline?.winner_acc ?? null,
      xgboost: d.xgboost?.winner_acc ?? null,
    })),
    [analytics]
  )
  const jump = (e, id) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="page hood">
      <motion.header
        className="hood-head"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <p className="kicker">TECHNICAL DEEP DIVE</p>
        <h1 className="hood-title">Why does it work?</h1>
        <p className="hood-sub">
          And, just as importantly, where it stops working. Seven sections on the models,
          the features, and the ceiling the sport itself imposes.
        </p>
      </motion.header>

      <div className="hood-layout">
        <nav className="hood-nav" aria-label="Sections">
          <LayoutGroup id="hood-nav">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => jump(e, s.id)}
                className={`hood-nav-item${active === s.id ? " active" : ""}`}
                aria-current={active === s.id ? "true" : undefined}
              >
                {active === s.id && (
                  <motion.span layoutId="hood-marker" className="hood-nav-marker"
                    transition={{ type: "spring", stiffness: 440, damping: 38 }} />
                )}
                <span className="hood-nav-n num">{s.n}</span>
                <span>{s.label}</span>
              </a>
            ))}
          </LayoutGroup>
        </nav>

        <div className="hood-body">
          <section id="hood-overview" className="hood-section viz-reveal">
            <h2>What it predicts</h2>
            <p>
              The predictor estimates the <strong>full finishing order</strong>, not a yes/no winner
              label. That makes it a ranking problem, so it is judged on ranking metrics —
              Spearman, MAE, NDCG — rather than plain accuracy alone.
            </p>
            <p>
              Two profiles sit on top of the same pipeline. <strong>Winner-Centric</strong> maximises
              P1 hit rate. <strong>Full Finishing Order</strong> gives the strongest overall ordering.
              They select different features and different blend weights, which is why both exist.
            </p>
          </section>

          <section id="hood-features" className="hood-section viz-reveal">
            <h2>Choosing features</h2>
            <p>
              Every engineered feature was <em>not</em> thrown at the model. More features can help,
              but they also invite overfitting — especially in a sport that changes regulations,
              tyres and team order every few seasons.
            </p>
            <div className="hood-split">
              <div className="hood-panel">
                <span className="hood-panel-tag" style={{ color: CATEGORICAL_3[2] }}>REPEATEDLY STRONG</span>
                <ul>
                  <li>Grid &amp; qualifying position</li>
                  <li>Driver form</li>
                  <li>Constructor strength</li>
                  <li>Team identity</li>
                </ul>
              </div>
              <div className="hood-panel">
                <span className="hood-panel-tag" style={{ color: CATEGORICAL_3[1] }}>SITUATIONAL</span>
                <ul>
                  <li>Weather &amp; track temperature</li>
                  <li>Tyre compound</li>
                  <li>Circuit encodings</li>
                  <li>Circuit overperformance</li>
                </ul>
              </div>
            </div>
            <p className="hood-aside">
              Situational features earn their place only when they improve the target metric without
              adding noise — decided by feature-search runs, not by intuition.
            </p>
          </section>

          <section id="hood-models" className="hood-section viz-reveal">
            <h2>The four models</h2>
            <div className="hood-models">
              {MODEL_CARDS.map((m) => (
                <article key={m.key} className="hood-model">
                  <header>
                    <i style={{ background: MODEL_HUE[m.key] }} aria-hidden="true" />
                    <h3>{m.name}</h3>
                  </header>
                  <code className="hood-formula">{m.formula}</code>
                  <dl>
                    <dt>Strong at</dt><dd>{m.strong}</dd>
                    <dt>Weak at</dt><dd>{m.weak}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </section>

          <section id="hood-blend" className="hood-section viz-reveal">
            <h2>The blend</h2>
            <p>
              Ridge and XGBoost fail in different directions — Ridge misses interactions, XGBoost is
              fragile under drift. Blending them helps rank quality, so Full Finishing Order uses
              the blend at α = 0.52. It does not help pick winners, so Winner-Centric runs plain
              Ridge instead. Each profile takes whichever method actually wins its own metric.
              Drag α to see the trade-off.
            </p>
            <BlendDemo />
          </section>

          <section id="hood-ceiling" className="hood-section viz-reveal">
            <h2>Why not 100%</h2>
            <p>
              F1 is not a closed system. Strong pre-race features still cannot see what decides
              a large share of races:
            </p>
            <div className="hood-unknowns">
              {UNKNOWNS.map((u) => <span key={u}>{u}</span>)}
            </div>
            <p>
              So there is a hard ceiling, and it moves with the era. In a dominant season one team
              makes the race easy to call; in a tightly matched one there is simply less separation
              at the front to detect.
            </p>
            <p className="hood-callout">
              When winner accuracy falls but Spearman holds, the model still understands the
              competitive order — the top of the sheet just got closer together.
            </p>
          </section>

          <section id="hood-drift" className="hood-section viz-reveal">
            <h2>The 2022 drift</h2>
            <p>
              2022 introduced ground-effect regulations and the pecking order changed fast.
              Team-strength assumptions that had held for years expired in one off-season — and the
              more flexible model suffered more, because it had more ways to learn a pattern that
              stopped being true.
            </p>
            {driftRows.length > 0 && (
              <div className="hood-drift">
                <GroupedBars
                  data={driftRows} xKey="year" formatter={METRICS.winner_acc.fmt}
                  highlightX={2022} height={200}
                  series={[
                    { key: "baseline", label: "Ridge Baseline", hue: MODEL_HUE.baseline },
                    { key: "xgboost", label: "XGBoost", hue: MODEL_HUE.xgboost },
                  ]}
                />
              </div>
            )}
            <p className="hood-aside">
              Winner accuracy, zero-based and paired by season, 2022 shaded. Model quality is not only about fitting
              the past — it is about surviving when the sport changes.
            </p>
          </section>

          <section id="hood-future" className="hood-section viz-reveal">
            <h2>Future races</h2>
            <p>
              For a race with no qualifying session yet, the app has to assume: comparable grid,
              neutral tyre choice, dry conditions. The model is refit on every round completed
              before the one being predicted, so it tracks the current order as the season runs.
            </p>
            <p className="hood-aside">
              It used to weight the current season 10× on top of that. Walk-forward testing over
              2019–2026 showed the upweighting was a net loss — it barely helped Ridge and clearly
              hurt XGBoost, whose effective sample shrinks under skewed weights. Even 2022, the
              regulation reset the weighting existed for, scored better without it.
            </p>
            <p className="hood-callout">
              Known limitation: before qualifying, two teammates on similar form look nearly
              identical. Once real qualifying gaps arrive, the prediction sharpens considerably.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
