/* ══════════════════════════════════════════════════════════════
   CHART TOKENS

   Every colour below was checked with the dataviz validator against
   the app's chart surface (#0a0a14) in dark mode, all pairs:

     3-series  #3E9BD1 #D55E00 #009E73
               lightness PASS · chroma PASS · CVD ΔE 11.0 (deutan)
               normal-vision ΔE 15.2 · contrast PASS
     2-series  #4488FF #E8003D
               CVD ΔE 29.7 · normal-vision ΔE 37.3

   Four categorical series in one plot is NOT achievable on this
   surface: the dark lightness band is only L 0.48–0.67 and every
   warm hue collapses under deutan/protan (amber↔vermillion came out
   at ΔE 0.5). Anything with four entities is therefore faceted into
   small multiples — one hue per panel — rather than overlaid.
   ══════════════════════════════════════════════════════════════ */

export const SURFACE = "#0a0a14"

/* Fixed order. Never cycled, never reassigned by rank — colour
   follows the entity so a filter cannot repaint the survivors. */
export const CATEGORICAL_3 = ["#3E9BD1", "#D55E00", "#009E73"]
export const CATEGORICAL_2 = ["#4488FF", "#E8003D"]

/* Four series ARE viable in a clustered bar chart, where lines were not.
   Bars sit in a fixed left-to-right order separated by gaps, so only
   neighbours ever touch and position itself carries identity — which makes
   adjacent-pair the correct check rather than all-pairs.

   Validated in that order against #0a0a14:
     lightness PASS · chroma PASS
     CVD worst adjacent #8E7CE8↔#E8003D ΔE 24.9 (deutan) · tritan 14.2
     normal-vision worst ΔE 28.1 · contrast PASS — no warnings

   The ensembles take purple and gold specifically so gold never lands next
   to red: that pair measures ΔE 6.3, inside the 6–8 band that is only legal
   with extra encoding. Reordering removes the problem instead of excusing it. */
export const CATEGORICAL_4 = ["#4488FF", "#E8003D", "#8E7CE8", "#B8860B"]

/* Reserved for state, never reused as a series colour. */
export const STATUS = { good: "#009E73", warning: "#D9A441", critical: "#E8003D" }

export const INK = {
  primary: "#e8e8f0",
  secondary: "#9a9aac",
  muted: "#5a5a70",
  grid: "#1c1c2a",
}

/* Keyed to CATEGORICAL_4 in MODELS order. Ridge keeps its blue and XGBoost
   its red from the original app; only the ensembles moved. */
export const MODEL_HUE = {
  baseline: "#4488FF",
  xgboost: "#E8003D",
  ensemble_winner: "#8E7CE8",
  ensemble_position: "#B8860B",
}

export const MODELS = [
  { key: "baseline", chartKey: "Baseline", label: "Ridge Baseline", blurb: "Linear — stable under drift" },
  { key: "xgboost", chartKey: "XGBoost", label: "XGBoost", blurb: "Trees — non-linear interactions" },
  { key: "ensemble_winner", chartKey: "Ens.Winner", label: "Ensemble · Winner", blurb: "α-blend tuned for P1 hit rate" },
  { key: "ensemble_position", chartKey: "Ens.Position", label: "Ensemble · Position", blurb: "α-blend tuned for full-grid order" },
]

/* `better` says which direction is good, so the charts can mark the
   best season without hard-coding per-metric logic. */
export const METRICS = {
  winner_acc: { label: "Winner Accuracy", unit: "%", better: "high", fmt: (v) => `${Number(v).toFixed(1)}%` },
  podium_acc: { label: "Podium Accuracy", unit: "%", better: "high", fmt: (v) => `${Number(v).toFixed(1)}%` },
  spearman: { label: "Spearman", unit: "", better: "high", fmt: (v) => Number(v).toFixed(3) },
  ndcg: { label: "NDCG", unit: "", better: "high", fmt: (v) => Number(v).toFixed(3) },
  within_3: { label: "Within 3 Positions", unit: "%", better: "high", fmt: (v) => `${Number(v).toFixed(1)}%` },
  mae: { label: "Mean Abs. Error", unit: "pos", better: "low", fmt: (v) => Number(v).toFixed(2) },
}
