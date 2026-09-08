import { CATEGORICAL_2, STATUS } from "./viz/palette"
import "./RaceResult.css"

const surname = (n) => n.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ").split(" ").pop()
const teamName = (t) => t.replace(/_/g, " ").toUpperCase()

/* Accuracy bands. Each ships an icon AND a label — never colour alone —
   and draws from the reserved status palette rather than series hues. */
const band = (diff) => {
  if (diff === null) return null
  if (diff === 0) return { label: "EXACT", icon: "●", color: STATUS.good }
  if (diff <= 2) return { label: `±${diff}`, icon: "◐", color: CATEGORICAL_2[0] }
  if (diff <= 4) return { label: `±${diff}`, icon: "◑", color: STATUS.warning }
  return { label: `±${diff}`, icon: "○", color: STATUS.critical }
}

export function Podium({ results, teamColors }) {
  if (!results?.length) return null
  const [p1, p2, p3] = results
  /* Visual order puts the winner centre and tallest. */
  const steps = [
    { d: p2, pos: 2, h: 76 },
    { d: p1, pos: 1, h: 108 },
    { d: p3, pos: 3, h: 58 },
  ].filter((s) => s.d)

  return (
    <figure className="rr-podium">
      <figcaption className="rr-label">PREDICTED PODIUM</figcaption>
      <div className="rr-podium-row">
        {steps.map((s, i) => {
          const tc = teamColors[s.d.team] || "#888"
          return (
            <div key={s.d.driver} className="rr-step">
              <div className="rr-step-driver">
                <span className="rr-step-name">{surname(s.d.driver)}</span>
                {/* Team colour rides on a mark; the text stays ink. */}
                <span className="rr-step-team">
                  <i style={{ background: tc }} aria-hidden="true" />
                  {teamName(s.d.team)}
                </span>
                <span className="rr-step-prob num">{s.d.win_probability}% win</span>
              </div>
              <div
                className={`rr-step-block rr-step-${s.pos}`}
                style={{ height: s.h }}
              >
                <span className="rr-step-pos num">{s.pos}</span>
                <span className="rr-step-edge" style={{ background: tc }} />
              </div>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

export function GridRow({ r, i, showActual, teamColors }) {
  const tc = teamColors[r.team] || "#888"
  const diff = r.actual_position ? Math.abs(r.predicted_rank - r.actual_position) : null
  const b = band(diff)
  const podium = i < 3

  return (
    <div className={`rr-row${podium ? " is-podium" : ""}`}>
      <span className="rr-pos num">{i + 1}</span>
      {/* A 3px team-coloured slab down the card edge is the classic
          generated-UI tell; identity sits on this chip instead. */}
      <span className="rr-team-chip" style={{ background: tc }} aria-hidden="true" />
      <span className="rr-driver">
        <span className="rr-driver-name">{surname(r.driver)}</span>
        <span className="rr-driver-meta">
          {teamName(r.team)}{r.quali_gap != null ? ` · +${r.quali_gap.toFixed(3)}s` : ""}
        </span>
      </span>

      {/* One series → one hue for every bar. Colouring by team here would
          burn the only free channel on information already in the label. */}
      <span className="rr-prob">
        <span className="rr-prob-track">
          <span className="rr-prob-fill" style={{ width: `${Math.min(r.win_probability * 2, 100)}%` }} />
        </span>
        <span className="rr-prob-value num">{r.win_probability}%</span>
      </span>

      <span className="rr-grid num">P{r.grid}</span>

      {showActual && r.actual_position ? (
        <span className="rr-actual num" style={{ color: b.color }} title={`Predicted P${i + 1}, finished P${r.actual_position}`}>
          <span aria-hidden="true">{b.icon}</span> P{r.actual_position}
        </span>
      ) : (
        <span className="rr-actual rr-actual-empty">—</span>
      )}
    </div>
  )
}

export function AccuracyKey() {
  return (
    <div className="rr-key">
      {[
        { icon: "●", label: "Exact", color: STATUS.good },
        { icon: "◐", label: "Within 2", color: CATEGORICAL_2[0] },
        { icon: "◑", label: "Within 4", color: STATUS.warning },
        { icon: "○", label: "Missed by 5+", color: STATUS.critical },
      ].map((k) => (
        <span key={k.label}>
          <i style={{ color: k.color }} aria-hidden="true">{k.icon}</i>
          {k.label}
        </span>
      ))}
    </div>
  )
}
