import { useMemo, useState } from "react"
import { INK, METRICS, SURFACE } from "./palette"

/* ══════════════════════════════════════════════════════════════
   Chart primitives, hand-built in SVG.

   Built to the dataviz spec: thin marks, hairline recessive grid,
   one y-axis only, selective direct labels (never a value on every
   point), a legend whenever there is more than one series, and a
   hover layer on everything that has a plot.
   ══════════════════════════════════════════════════════════════ */

const PAD = { top: 14, right: 16, bottom: 22, left: 34 }

const niceTicks = (min, max, count = 4) => {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min]
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

/* Shared scale across facets is what makes small multiples comparable;
   computing it per panel would silently rescale each one. */
const sharedExtent = (series, pad = 0.12) => {
  const vals = series.flat().filter((v) => v != null && isFinite(v))
  if (!vals.length) return [0, 1]
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || Math.abs(hi) || 1
  return [lo - span * pad, hi + span * pad]
}

function Tooltip({ x, y, width, children }) {
  if (children == null) return null
  /* Flip before the edge so the tip never leaves the plot. */
  const flip = x > width - 96
  return (
    <foreignObject x={flip ? x - 150 : x + 8} y={Math.max(y - 30, 0)} width={146} height={62} style={{ overflow: "visible", pointerEvents: "none" }}>
      <div className="viz-tip">{children}</div>
    </foreignObject>
  )
}

/* ── Clustered bars: several series compared side by side within each
      category. Bars start at zero — a truncated bar axis exaggerates
      differences, because a bar encodes magnitude by its length. ── */
export function GroupedBars({ data, xKey, series, height = 230, formatter, highlightX }) {
  const [hover, setHover] = useState(null)
  const width = 760
  const iw = width - PAD.left - PAD.right
  const ih = height - PAD.top - PAD.bottom

  const max = Math.max(
    ...data.flatMap((d) => series.map((s) => d[s.key])).filter((v) => v != null && isFinite(v)),
    0
  ) || 1
  const top = max * 1.1

  const groupW = iw / data.length
  const GAP = 2
  const barW = Math.max((groupW * 0.78 - GAP * (series.length - 1)) / series.length, 2)
  const groupPad = (groupW - (barW * series.length + GAP * (series.length - 1))) / 2

  const sy = (v) => PAD.top + ih - (v / top) * ih

  return (
    <figure className="viz-wide">
      {/* Legend order matches the bar order inside every group, so position
          is a second channel carrying identity alongside hue. */}
      <div className="viz-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.hue, width: 10, height: 10, borderRadius: 2 }} />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="viz-svg" role="img"
        aria-label={`${series.map((s) => s.label).join(", ")} by ${xKey}`}>
        {niceTicks(0, top, 4).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} stroke={INK.grid} strokeWidth="1" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" className="viz-axis">{formatter ? formatter(t) : t}</text>
          </g>
        ))}

        {data.map((d, gi) => {
          const gx = PAD.left + gi * groupW
          const isHot = highlightX != null && d[xKey] === highlightX
          return (
            <g key={d[xKey]}>
              {isHot && <rect x={gx} y={PAD.top} width={groupW} height={ih} fill="#ffffff" opacity="0.045" />}
              {series.map((s, si) => {
                const v = d[s.key]
                if (v == null || !isFinite(v)) return null
                const x = gx + groupPad + si * (barW + GAP)
                const y = sy(v)
                const h = PAD.top + ih - y
                const on = hover && hover.gi === gi && hover.si === si
                return (
                  <rect
                    key={s.key} x={x} y={y} width={barW} height={Math.max(h, 1)}
                    rx={Math.min(3, barW / 2)} fill={s.hue}
                    opacity={hover && !on ? 0.42 : 1}
                    onMouseEnter={() => setHover({ gi, si, d, s, v })}
                    onMouseLeave={() => setHover(null)}
                  />
                )
              })}
            </g>
          )
        })}

        {hover && (
          <Tooltip x={PAD.left + hover.gi * groupW + groupW / 2} y={sy(hover.v)} width={width}>
            <b>{hover.d[xKey]}</b>
            <span><i style={{ background: hover.s.hue }} />{hover.s.label} {formatter ? formatter(hover.v) : hover.v}</span>
          </Tooltip>
        )}

        {data.map((d, gi) => (
          <text key={d[xKey]} x={PAD.left + gi * groupW + groupW / 2} y={height - 6}
            textAnchor="middle" className="viz-axis">{d[xKey]}</text>
        ))}
      </svg>
    </figure>
  )
}

/* ── Ranked horizontal bars. One series → one hue for every bar;
      a value-ramp here would double-encode length as colour. ── */
export function RankedBars({ rows, hue, formatter, highlightKey, liveLabel }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0) || 1
  return (
    <div className="viz-bars">
      {rows.map((r, i) => {
        const pct = (Math.abs(r.value) / max) * 100
        const isTop = r.key === highlightKey
        return (
          <div key={r.key} className={`viz-bar-row${isTop ? " is-live" : ""}`}>
            <span className="viz-bar-label">
              {r.label}
              {isTop && liveLabel && <em className="viz-bar-live">{liveLabel}</em>}
            </span>
            <div className="viz-bar-track">
              <span
                className="viz-bar-fill"
                style={{ background: hue, opacity: isTop ? 1 : 0.55, width: `${pct}%`, animationDelay: `${i * 0.05}s` }}
              />
            </div>
            <span className="viz-bar-value num">{formatter(r.value)}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Two-series line. Uses the validated 2-colour pair, with a legend
      (always, for ≥2 series) and endpoint direct labels. ── */
export function DualLine({ data, xKey, series, height = 190, formatter }) {
  const [hover, setHover] = useState(null)
  const width = 720
  const iw = width - PAD.left - PAD.right
  const ih = height - PAD.top - PAD.bottom
  const extent = useMemo(
    () => sharedExtent(series.map((s) => data.map((d) => d[s.key]))),
    [data, series]
  )
  const [lo, hi] = extent
  const sx = (i) => PAD.left + (i / (data.length - 1)) * iw
  const sy = (v) => PAD.top + ih - ((v - lo) / (hi - lo)) * ih

  return (
    <figure className="viz-wide">
      <div className="viz-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: s.hue }} aria-hidden="true" />{s.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="viz-svg" role="img" aria-label="Blend weight by season">
        {niceTicks(lo, hi, 4).map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} stroke={INK.grid} strokeWidth="1" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" className="viz-axis">{formatter ? formatter(t) : t}</text>
          </g>
        ))}
        {series.map((s) => {
          const path = data.map((d, i) => (d[s.key] == null ? null : `${sx(i)},${sy(d[s.key])}`)).filter(Boolean).join(" L ")
          return (
            <path
              key={s.key} className="viz-line" style={{ "--len": iw * 2 }}
              d={`M ${path}`} fill="none" stroke={s.hue} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            />
          )
        })}
        {data.map((d, i) => (
          <rect key={d[xKey]} x={sx(i) - iw / (data.length * 2)} y={PAD.top} width={iw / data.length} height={ih}
            fill="transparent" onMouseEnter={() => setHover({ i, d })} onMouseLeave={() => setHover(null)} />
        ))}
        {hover && (
          <>
            <line x1={sx(hover.i)} x2={sx(hover.i)} y1={PAD.top} y2={PAD.top + ih} stroke={INK.muted} strokeWidth="1" />
            {series.map((s) => (
              hover.d[s.key] == null ? null :
              <circle key={s.key} cx={sx(hover.i)} cy={sy(hover.d[s.key])} r="4" fill={s.hue} stroke={SURFACE} strokeWidth="2" />
            ))}
            <Tooltip x={sx(hover.i)} y={PAD.top + 8} width={width}>
              <b>{hover.d[xKey]}</b>
              {series.map((s) => (
                <span key={s.key}><i style={{ background: s.hue }} />{s.label} {formatter ? formatter(hover.d[s.key]) : hover.d[s.key]}</span>
              ))}
            </Tooltip>
          </>
        )}
        {data.map((d, i) => (i % 2 === 0 ? <text key={d[xKey]} x={sx(i)} y={height - 6} textAnchor="middle" className="viz-axis">{d[xKey]}</text> : null))}
      </svg>
    </figure>
  )
}

/* ── Stat tile. When the story is one number, the number IS the chart. ── */
export function StatTile({ label, value, note, trend, hue }) {
  return (
    <div className="viz-stat viz-reveal">
      <span className="viz-stat-label">{label}</span>
      <span className="viz-stat-value num" style={hue ? { color: hue } : undefined}>{value}</span>
      {note && <span className="viz-stat-note">{note}</span>}
      {trend != null && (
        <span className={`viz-stat-trend${trend >= 0 ? " up" : " down"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}
        </span>
      )}
    </div>
  )
}

export { METRICS }
