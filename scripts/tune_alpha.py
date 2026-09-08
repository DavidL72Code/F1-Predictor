"""Walk-forward tuning of the ensemble blend weight.

The blend is  final = alpha*Ridge + (1-alpha)*XGBoost.

The existing feature search picks alpha by maximising a metric ON the test
year and then reports that same year's score, which is selection on the test
set: since alpha=1 is pure Ridge and alpha=0 is pure XGBoost, a max over a grid
containing both endpoints can never lose to the better base model. It also
tunes against a window fixed at 2022-2024, so a 2026 race cannot move it.

This script instead does what production can actually do:

  * alpha for round r is fitted only on rounds strictly before r,
  * early rounds fall back to a historical prior via shrinkage,
  * selection uses a continuous metric, because winner accuracy is a step
    function of alpha (it only moves when a predicted winner flips), which
    produces wide ties that the old `>` comparison broke toward alpha=0.0.

Outputs both the live alpha schedule and an honest walk-forward benchmark.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, ndcg_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.api.main import (  # noqa: E402
    ALL_ENGINEERED_FEATURES,
    CURRENT_SEASON_WEIGHT,
    TARGET,
    build_xgb_model,
    df,
)

DEFAULT_OUT = ROOT / "data" / "processed" / "alpha_schedule.json"
LIVE_SUMMARY = ROOT / "data" / "processed" / "feature_search_profile_live_summary.json"

ALPHA_GRID = [round(a * 0.05, 2) for a in range(21)]

# Races of current-season evidence needed before the in-season estimate carries
# as much weight as the historical prior. Six is roughly a quarter season —
# enough for Spearman to stabilise without ignoring a genuine regulation shift.
SHRINKAGE_K = 6.0

# alpha is a smoothing weight, so it wants a smooth objective. Both profiles
# select on a continuous metric even though the winner profile is *reported*
# on winner accuracy.
PROFILE_SELECTION_METRIC = {"winner": "spearman", "full_order": "spearman"}


def fit_pair(train_df, test_df, features, weights=None):
    """Fit Ridge + XGBoost on train_df and predict test_df."""
    scaler = StandardScaler()
    x_train = scaler.fit_transform(train_df[features])
    x_test = scaler.transform(test_df[features])

    ridge = Ridge()
    ridge.fit(x_train, train_df[TARGET], sample_weight=weights)

    xgb = build_xgb_model()
    xgb.fit(train_df[features], train_df[TARGET], sample_weight=weights)

    return ridge.predict(x_test), xgb.predict(test_df[features])


def score(blend, truth, metric):
    if metric == "spearman":
        corr, _ = spearmanr(blend, truth)
        return -1.0 if np.isnan(corr) else float(corr)
    if metric == "mae":
        return -float(mean_absolute_error(truth, blend))
    raise ValueError(f"alpha selection needs a continuous metric, got {metric}")


def best_alpha(ridge_preds, xgb_preds, truth, metric):
    """Argmax over the grid, resolving ties to the midpoint of the tied run.

    The old loop used a strict `>` from alpha=0.0 upward, so every tie silently
    became "pure XGBoost". Averaging the tied plateau is unbiased instead.
    """
    scores = [score(a * ridge_preds + (1 - a) * xgb_preds, truth, metric) for a in ALPHA_GRID]
    top = max(scores)
    tied = [a for a, s in zip(ALPHA_GRID, scores) if s >= top - 1e-12]
    return float(np.mean(tied)), top, len(tied)


def season_rounds(frame, year):
    return sorted(frame.loc[frame["year"] == year, "round"].unique())


def walk_forward_season(df_clean, features, year, prior_alpha, metric, min_train_rounds=1, season_weight=None):
    """Predict each round of `year` using only rounds before it.

    Returns per-round records: the alpha actually used, and the predictions.
    """
    records = []
    for rnd in season_rounds(df_clean, year):
        before = (df_clean["year"] < year) | ((df_clean["year"] == year) & (df_clean["round"] < rnd))
        train_df = df_clean[before]
        test_df = df_clean[(df_clean["year"] == year) & (df_clean["round"] == rnd)]
        if train_df.empty or test_df.empty:
            continue

        sw = CURRENT_SEASON_WEIGHT if season_weight is None else season_weight
        weights = np.where(train_df["year"] == year, sw, 1.0)

        # In-season evidence: refit on rounds before the *previous* round and
        # score the completed rounds, so the alpha estimate is itself
        # out-of-sample rather than fitted to the rows it is scored on.
        done = [r for r in season_rounds(df_clean, year) if r < rnd]
        in_season_alpha, n = None, len(done)
        if n >= min_train_rounds:
            val_df = df_clean[(df_clean["year"] == year) & (df_clean["round"].isin(done))]
            val_train = df_clean[df_clean["year"] < year]
            if not val_train.empty and not val_df.empty:
                vr, vx = fit_pair(val_train, val_df, features)
                in_season_alpha, _, _ = best_alpha(vr, vx, val_df[TARGET].to_numpy(), metric)

        if in_season_alpha is None:
            alpha = prior_alpha
        else:
            alpha = (n * in_season_alpha + SHRINKAGE_K * prior_alpha) / (n + SHRINKAGE_K)

        ridge_preds, xgb_preds = fit_pair(train_df, test_df, features, weights)
        records.append(
            {
                "round": int(rnd),
                "rounds_of_evidence": n,
                "alpha": round(float(alpha), 4),
                "in_season_alpha": None if in_season_alpha is None else round(in_season_alpha, 4),
                "_ridge": ridge_preds,
                "_xgb": xgb_preds,
                "_truth": test_df[TARGET].to_numpy(),
                "_won": test_df["won"].to_numpy() if "won" in test_df else None,
            }
        )
    return records


def season_metrics(records, alpha_of):
    """Aggregate per-round predictions into season metrics for a given alpha rule.

    Mirrors compute_eval_metrics in the API so the honest walk-forward figures
    are directly comparable with the ones the app already reports.
    """
    blend, truth = [], []
    winners_right = podiums_right = races = 0

    for rec in records:
        a = alpha_of(rec)
        b = a * rec["_ridge"] + (1 - a) * rec["_xgb"]
        t = rec["_truth"]
        blend.append(b)
        truth.append(t)

        # Each record is a single race, so winner/podium are per record.
        if rec["_won"] is not None and rec["_won"].sum() == 1:
            races += 1
            if int(np.argmin(b)) == int(np.argmax(rec["_won"])):
                winners_right += 1
            pred_top3 = set(np.argsort(b)[:3].tolist())
            actual_top3 = set(np.argsort(t)[:3].tolist())
            if pred_top3 == actual_top3:
                podiums_right += 1

    if not blend:
        return None

    blend = np.concatenate(blend)
    truth = np.concatenate(truth)
    corr, _ = spearmanr(blend, truth)
    max_pos = int(truth.max()) + 1
    return {
        "spearman": round(float(0.0 if np.isnan(corr) else corr), 4),
        "mae": round(float(mean_absolute_error(truth, blend)), 3),
        "ndcg": round(float(ndcg_score((max_pos - truth).reshape(1, -1), (max_pos - blend).reshape(1, -1))), 4),
        "within_3": round(float((np.abs(blend - truth) <= 3).mean() * 100), 2),
        "winner_acc": round(winners_right / races * 100, 2) if races else None,
        "podium_acc": round(podiums_right / races * 100, 2) if races else None,
        "races": races,
    }


def historical_prior(df_clean, features, years, metric):
    """Prior alpha: tuned per season on seasons that are all in the past."""
    per_year = {}
    for year in years:
        train_df = df_clean[df_clean["year"] < year]
        test_df = df_clean[df_clean["year"] == year]
        if train_df.empty or test_df.empty:
            continue
        r, x = fit_pair(train_df, test_df, features)
        a, _, ties = best_alpha(r, x, test_df[TARGET].to_numpy(), metric)
        per_year[int(year)] = {"alpha": round(a, 4), "tied_grid_points": ties}
    if not per_year:
        return 0.5, {}
    return float(np.mean([v["alpha"] for v in per_year.values()])), per_year


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, help="Season to produce a live alpha schedule for (default: latest).")
    ap.add_argument("--benchmark-from", type=int, default=2019, help="First season of the walk-forward benchmark.")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--quick", action="store_true", help="Benchmark the latest season only.")
    ap.add_argument(
        "--season-weight", type=float, default=None,
        help="Override CURRENT_SEASON_WEIGHT. The base models already upweight the "
             "current season 10x, which may leave the blend weight nothing to do; "
             "set 1.0 to test how much alpha is worth without that head start.",
    )
    args = ap.parse_args()

    df_clean = df.dropna(subset=ALL_ENGINEERED_FEATURES).copy()

    live = json.loads(LIVE_SUMMARY.read_text()) if LIVE_SUMMARY.exists() else {}
    # seed_profiles maps profile -> the feature list the live model actually
    # uses (11 for winner, 9 for full_order). Falling back to every engineered
    # feature would tune alpha for a model that is not the one being served.
    profile_features = {
        name: list(features)
        for name, features in (live.get("seed_profiles") or {}).items()
        if features
    } or {"winner": ALL_ENGINEERED_FEATURES, "full_order": ALL_ENGINEERED_FEATURES}

    all_years = sorted(df_clean["year"].unique())
    season = args.season or int(all_years[-1])
    prior_years = [y for y in all_years if y < season][-5:]

    out = {"season": season, "shrinkage_k": SHRINKAGE_K, "alpha_grid_step": 0.05,
           "season_weight": args.season_weight if args.season_weight is not None else CURRENT_SEASON_WEIGHT,
           "profiles": {}}

    for profile, features in profile_features.items():
        metric = PROFILE_SELECTION_METRIC.get(profile, "spearman")
        features = [f for f in features if f in df_clean.columns]
        print(f"\n=== profile {profile} · selecting alpha on {metric} · {len(features)} features ===")

        prior, per_year = historical_prior(df_clean, features, prior_years, metric)
        print(f"  prior alpha {prior:.3f} from {list(per_year)}")

        schedule = walk_forward_season(df_clean, features, season, prior, metric, season_weight=args.season_weight)
        for rec in schedule:
            print(
                f"    R{rec['round']:>2}  evidence={rec['rounds_of_evidence']:>2} rounds"
                f"  in-season={rec['in_season_alpha']}  ->  alpha={rec['alpha']}"
            )

        next_alpha = schedule[-1]["alpha"] if schedule else prior
        out["profiles"][profile] = {
            "selection_metric": metric,
            "prior_alpha": round(prior, 4),
            "prior_per_season": per_year,
            "next_race_alpha": round(float(next_alpha), 4),
            "schedule": [{k: v for k, v in r.items() if not k.startswith("_")} for r in schedule],
        }

        bench_years = [season] if args.quick else [y for y in all_years if args.benchmark_from <= y <= season]
        bench = []
        for year in bench_years:
            recs = walk_forward_season(df_clean, features, year, prior, metric, season_weight=args.season_weight)
            if not recs:
                continue
            row = {
                "year": int(year),
                "walk_forward": season_metrics(recs, lambda r: r["alpha"]),
                "ridge_only": season_metrics(recs, lambda r: 1.0),
                "xgboost_only": season_metrics(recs, lambda r: 0.0),
                "fixed_prior": season_metrics(recs, lambda r: prior),
            }
            bench.append(row)
            wf, ri, xg = row["walk_forward"], row["ridge_only"], row["xgboost_only"]
            print(
                f"  {year}  walk-forward spearman {wf['spearman']:.3f}"
                f" | ridge {ri['spearman']:.3f} | xgb {xg['spearman']:.3f}"
                f" | beats both: {'yes' if wf['spearman'] > max(ri['spearman'], xg['spearman']) else 'no'}"
            )
        out["profiles"][profile]["walk_forward_benchmark"] = bench

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
