# F1 Strategy Lab — Race Predictor

Predicts the **full finishing order** of a Formula 1 race from pre-race
information, and is honest about how often it is wrong.

---

## Why I built this

Most F1 prediction projects answer "who wins?" with a classifier and report an
accuracy number. That framing hides two things I wanted to look at directly.

**A race is a ranking, not a label.** Getting P1 right while scrambling P2–P20
is a bad prediction dressed as a good one. Treating it as a ranking problem
means the model is judged on Spearman, MAE and NDCG — metrics that notice when
the rest of the grid is wrong.

**The interesting question is where prediction breaks down.** F1 has a hard
accuracy ceiling: safety cars, first-lap contact, DNFs and strategy gambles
decide a large share of races and none of them are visible before lights out.
A model that claims 90% winner accuracy is either overfitting or grading itself
generously. I wanted a build where the honest number is the one on screen, and
where the failure modes — regulation resets, tightly matched fields — are shown
rather than smoothed over.

The 2022 ground-effect reset is the clearest example, and the app has a section
on it: every model's learned pecking order expired in one off-season, and the
more flexible model suffered most.

---

## The model

Two linear/tree models, and a blend of them:

| Method | What it is | Strength |
|---|---|---|
| **Ridge** | linear regression on the feature set | stable under regulation drift |
| **XGBoost** | gradient-boosted trees | non-linear feature interactions |
| **Ensemble** | `α·Ridge + (1−α)·XGBoost` | variance reduction across the grid |

The target is finishing position, so every method is a regressor and the
prediction is the induced ordering.

### Two profiles, and how the live method is chosen

The app exposes two objectives, because the best model for one is not the best
for the other:

| Profile | Selects on | Currently runs |
|---|---|---|
| **Winner-Centric** | highest winner accuracy | **Ridge** |
| **Full Finishing Order** | lowest MAE | **Ensemble** (α ≈ 0.52) |

This is computed, not hardcoded. Each profile takes whichever method actually
wins its own metric on the walk-forward benchmark. If XGBoost overtakes on a
future update, it goes live with no code change.

A method choice *is* an α choice — α = 1 is pure Ridge, α = 0 is pure XGBoost —
so selection collapses to picking α, and one code path serves all three.

### Feature sets

Selected per profile by search, not intuition. The winner profile uses 11
features, full-order uses 9.

Consistently strong: grid, qualifying position, driver form, constructor
strength, team identity. Situational, and only included when they improve the
target metric: weather, track temperature, tyre compound, circuit encodings.

---

## Design process: getting to the best model

The interesting part of this project was discovering the benchmark was lying,
and fixing it.

### 1. The original benchmark could not lose

α was chosen by maximising a metric **on the test season**, then the blend was
scored on that same season. Since α = 1 is Ridge and α = 0 is XGBoost, a max
over a grid containing both endpoints can never lose to the better base model.
The ensemble "won" 11 of 11 seasons — by construction, not by merit.

### 2. Walk-forward evaluation

Rebuilt so every race is predicted using only rounds strictly before it, and α
is fitted the same way. Honestly measured, on winner accuracy:

| | leaky benchmark | walk-forward |
|---|---|---|
| blend beats both base models | 11/11 | **1/8** |
| best average | Ensemble | **Ridge, 62.5%** |

### 3. What survived the honest test

Paired per-season differences across 8 seasons, ~157 races:

- **Full Order / Spearman:** ensemble beats Ridge by +0.0050, 6 of 8 seasons,
  **2.07 standard errors** — the one result here that is distinguishable from
  noise. The blend earns its place.
- **Winner-Centric / winner accuracy:** ensemble is *worse* than Ridge by 1.11
  points, but that is only **0.72 SE**. Not distinguishable either — so Ridge
  is chosen because it is not worse *and* it is one model instead of three.

### 4. Removing a feature that was hurting

The pipeline weighted the current season 10× when fitting, to "adapt" to a new
season. Walk-forward testing showed it was a net loss:

```
Spearman, w=10 → w=1
  XGBoost  0.6514 → 0.6602   (+0.0088)   trees suffer under skewed weights
  Ridge    0.6583 → 0.6609   (+0.0026)
```

Skewed sample weights shrink the effective sample a tree model sees, so the
blend was pairing a good model with a crippled one. `w=1` scored best in 7 of
8 seasons — including 2022, the regulation reset the weighting existed for.
It is now **1.0**.

### 5. What was tried and rejected

**In-season α tuning.** Refit the blend weight on completed rounds of the
current season, shrinking toward a historical prior. The mechanism works — α
tracks visibly across a season — but it is worth −0.0002 to +0.0014 Spearman
at every season weight tested. Both models already see the current season, so
by the time α acts, the adaptation has happened upstream. Kept as a
measurement tool in `scripts/tune_alpha.py`, not shipped.

### Honest caveats

- 8 seasons is a small sample; most differences here are inside the noise.
- Winner accuracy over ~21 races per season can only take ~22 distinct values,
  so it ties constantly and resolves nothing finer than one race. Spearman is
  the reliable signal.
- The in-progress season has far fewer races than a completed one. The
  Analytics page shades it and shows the race count rather than drawing it at
  equal weight.

---

## Recurring batch updates

A GitHub Action keeps the model current without manual intervention.

```
every 6h (cron) ─┬─► scripts/update_f1_data.py       fetch from Jolpica (+FastF1)
                 │       exits 2 if any CSV changed
                 │
                 └─► if changed:
                     ├─► scripts/feature_search_multi_objective.py   re-select features
                     ├─► scripts/tune_alpha.py                       re-decide live method
                     └─► commit data/raw, data/processed, models
```

Two different things refresh, on different clocks:

**Every request** — Ridge and XGBoost are refit on all rounds *before* the race
being predicted. A completed race improves the next prediction immediately.

**Every new race** — `tune_alpha.py` rewrites `data/processed/alpha_schedule.json`
with a fresh walk-forward benchmark, which re-decides which method goes live
per profile. The API keys its cache on that file's mtime, so the switch takes
effect on the next request rather than the next deploy.

Because the method is picked from a small sample, expect it to change more
often than the underlying quality does. A hysteresis rule — only switch when
the challenger leads by a margin — would settle that if the churn matters.

---

## Tech stack

**Backend** — Python 3.11, FastAPI + Uvicorn. scikit-learn (Ridge,
StandardScaler, metrics), XGBoost, pandas, NumPy, SciPy. Deployed on Render.

**Frontend** — React 18 (Create React App), plain CSS with a tokenised design
system. [Motion](https://motion.dev) for interaction; charts are hand-built SVG
rather than a charting library. three.js for the 3D car (GLTF, meshopt-compressed).
Deployed on Vercel, which proxies `/api/*` to Render through an explicit
path allowlist.

**Data** — [Jolpica](https://api.jolpi.ca) (the Ergast successor) for results,
qualifying and standings; FastF1 for tyre and weather enrichment. Everything
is committed as CSV, so a checkout is reproducible with no database.

**Automation** — GitHub Actions on a 6-hourly cron.

### Why the charts are hand-written

Recharts was dropped during the rebuild. The chart requirements — a validated
colour-blind-safe palette, zero-based clustered bars, shared scales across
facets, sample-size annotation — were easier to satisfy in ~270 lines of SVG
than by fighting a library's defaults, and it removed **61 kB** from the
bundle (182.75 → 122 kB).

Palettes are validated rather than eyeballed. Four categorical series will not
pass colour-blind separation on this dark surface as lines, because every warm
hue collapses under deuteranopia. As clustered bars they do, since fixed
left-to-right order plus gaps supplies a second channel beyond hue.

---

## Running locally

Backend:

```bash
cd src/api && ../../venv/bin/python -m uvicorn main:app --port 8000
```

Frontend:

```bash
npm --prefix frontend start
```

Regenerate the benchmark and live method selection:

```bash
venv/bin/python scripts/tune_alpha.py
```

`ALLOWED_ORIGINS` defaults to `localhost:3000`. Set `TRUSTED_PROXY_COUNT` to the
number of proxies in front of the API — it decides which `X-Forwarded-For` entry
the rate limiter trusts.
