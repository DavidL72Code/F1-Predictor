import argparse
import json
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, ndcg_score
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.api.main import ALL_ENGINEERED_FEATURES, TARGET, df


DEFAULT_INPUT = ROOT / "data" / "processed" / "feature_search_results.json"
DEFAULT_OUTPUT = ROOT / "data" / "processed" / "feature_search_all_methods.json"
DEFAULT_SEED_SUMMARY = ROOT / "data" / "processed" / "feature_search_profile_summary.json"
CORE_FEATURES = ["grid", "quali_pos"]
OPTIONAL_FEATURES = [feature for feature in ALL_ENGINEERED_FEATURES if feature not in CORE_FEATURES]
METHODS = ("baseline", "xgboost", "ensemble_winner", "ensemble_position")
OBJECTIVES = ("winner_acc", "podium_acc", "spearman", "mae")
LOWER_IS_BETTER = {"mae"}
SUMMARY_METRICS = ("winner_acc", "podium_acc", "spearman", "mae", "ndcg", "within_3")
PROFILE_OBJECTIVES = {
    "winner": "winner_acc",
    "full_order": "spearman",
}


def load_test_configs(path: Path):
    if path.exists():
        data = json.loads(path.read_text())
        configs = [tuple(config) for config in data.get("test_configs", [])]
        if configs:
            return configs
    return [(2022, 2021), (2023, 2022), (2024, 2023)]


def canonicalize_feature_set(feature_set):
    optional = [feature for feature in OPTIONAL_FEATURES if feature in set(feature_set)]
    return CORE_FEATURES + optional


def load_seed_feature_sets(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Seed summary not found: {path}")

    data = json.loads(path.read_text())
    best_overall = data.get("best_overall_by_metric", {})
    seed_sets = {}
    for profile_key, metric_key in PROFILE_OBJECTIVES.items():
        best = best_overall.get(metric_key)
        if not best:
            continue
        seed_sets[profile_key] = canonicalize_feature_set(best.get("features", []))

    if not seed_sets:
        raise RuntimeError(f"No seed feature sets found in {path}")
    return seed_sets


def build_neighbor_candidates(seed_feature_sets):
    candidates = {}

    for profile_key, feature_set in seed_feature_sets.items():
        current = canonicalize_feature_set(feature_set)
        current_optional = [feature for feature in current if feature not in CORE_FEATURES]
        missing_optional = [feature for feature in OPTIONAL_FEATURES if feature not in current_optional]

        profile_candidates = {tuple(current)}

        for feature in current_optional:
            reduced = [item for item in current if item != feature]
            profile_candidates.add(tuple(canonicalize_feature_set(reduced)))

        for feature in missing_optional:
            expanded = current + [feature]
            profile_candidates.add(tuple(canonicalize_feature_set(expanded)))

        for old_feature in current_optional:
            base = [item for item in current if item != old_feature]
            for new_feature in missing_optional:
                swapped = base + [new_feature]
                profile_candidates.add(tuple(canonicalize_feature_set(swapped)))

        candidates[profile_key] = [list(items) for items in sorted(profile_candidates)]

    merged = []
    seen = set()
    for feature_sets in candidates.values():
        for feature_set in feature_sets:
            key = tuple(feature_set)
            if key in seen:
                continue
            seen.add(key)
            merged.append(feature_set)

    return merged, candidates


def build_candidates(strategy: str, min_k: int, max_k: int, random_samples: int, seed: int, seed_summary: Path):
    if strategy == "exhaustive":
        candidates = []
        for r in range(1, len(OPTIONAL_FEATURES) + 1):
            for combo in combinations(OPTIONAL_FEATURES, r):
                candidates.append(CORE_FEATURES + [str(feature) for feature in combo])
        return candidates

    if strategy == "min_k_max_k":
        candidates = []
        for r in range(min_k, max_k + 1):
            for combo in combinations(OPTIONAL_FEATURES, r):
                candidates.append(CORE_FEATURES + [str(feature) for feature in combo])
        return candidates

    if strategy == "random":
        rng = np.random.default_rng(seed)
        seen = set()
        candidates = []
        while len(candidates) < random_samples:
            k = int(rng.integers(min_k, max_k + 1))
            combo = tuple(sorted(str(feature) for feature in rng.choice(OPTIONAL_FEATURES, k, replace=False)))
            if combo in seen:
                continue
            seen.add(combo)
            candidates.append(CORE_FEATURES + list(combo))
        return candidates

    if strategy == "neighbors":
        seed_feature_sets = load_seed_feature_sets(seed_summary)
        merged, _ = build_neighbor_candidates(seed_feature_sets)
        return merged

    raise ValueError(f"Unsupported strategy: {strategy}")


def collect_metrics(preds, y_test, test_df):
    spearman, _ = spearmanr(preds, y_test)
    mae = mean_absolute_error(y_test, preds)
    max_pos = int(y_test.max()) + 1
    ndcg = ndcg_score(
        (max_pos - y_test.values).reshape(1, -1),
        (max_pos - preds).reshape(1, -1),
    )
    within_3 = (abs(preds - y_test) <= 3).mean() * 100

    check = test_df.copy()
    check["predicted_pos"] = preds
    total = check["round"].nunique()
    correct_winner = 0
    correct_podium = 0

    for round_num in check["round"].unique():
        race = check[check["round"] == round_num]
        predicted_winner = race.loc[race["predicted_pos"].idxmin(), "driver"]
        actual_winner = race.loc[race["won"] == 1, "driver"].values[0]
        if predicted_winner == actual_winner:
            correct_winner += 1

        predicted_top3 = set(race.nsmallest(3, "predicted_pos")["driver"])
        actual_top3 = set(race.nsmallest(3, "position")["driver"])
        if predicted_top3 == actual_top3:
            correct_podium += 1

    return {
        "winner_acc": round(correct_winner / total * 100, 3),
        "podium_acc": round(correct_podium / total * 100, 3),
        "spearman": round(float(spearman), 3),
        "mae": round(float(mae), 3),
        "ndcg": round(float(ndcg), 3),
        "within_3": round(float(within_3), 3),
        "races": int(total),
    }


def average_metrics(per_year_rows, method_key):
    return {
        metric_key: round(
            sum(row["methods"][method_key][metric_key] for row in per_year_rows) / len(per_year_rows),
            3,
        )
        for metric_key in SUMMARY_METRICS
    }


def evaluate_feature_set(df_clean, feature_set, test_configs):
    per_year_rows = []
    for test_year, train_until in test_configs:
        train_df = df_clean[df_clean["year"] <= train_until].dropna(subset=feature_set)
        test_df = df_clean[df_clean["year"] == test_year].dropna(subset=feature_set)
        if train_df.empty or test_df.empty:
            continue

        X_train = train_df[feature_set]
        y_train = train_df[TARGET]
        X_test = test_df[feature_set]
        y_test = test_df[TARGET]

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        baseline = Ridge()
        baseline.fit(X_train_scaled, y_train)
        baseline_preds = baseline.predict(X_test_scaled)

        xgb_model = XGBRegressor(
            colsample_bytree=0.7,
            learning_rate=0.05,
            max_depth=3,
            n_estimators=100,
            subsample=0.9,
            random_state=42,
            eval_metric="mae",
        )
        xgb_model.fit(X_train, y_train)
        xgb_preds = xgb_model.predict(X_test)

        best_alpha_winner = 0.0
        best_winner = -1.0
        best_alpha_position = 0.0
        best_spearman = -999.0

        for alpha in [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]:
            blend = (alpha * baseline_preds) + ((1 - alpha) * xgb_preds)
            corr, _ = spearmanr(blend, y_test)
            if corr > best_spearman:
                best_spearman = corr
                best_alpha_position = alpha

            check = test_df.copy()
            check["predicted_pos"] = blend
            total = check["round"].nunique()
            correct = 0
            for round_num in check["round"].unique():
                race = check[check["round"] == round_num]
                predicted_winner = race.loc[race["predicted_pos"].idxmin(), "driver"]
                actual_winner = race.loc[race["won"] == 1, "driver"].values[0]
                if predicted_winner == actual_winner:
                    correct += 1

            winner_acc = correct / total * 100
            if winner_acc > best_winner:
                best_winner = winner_acc
                best_alpha_winner = alpha

        ensemble_winner_preds = (best_alpha_winner * baseline_preds) + ((1 - best_alpha_winner) * xgb_preds)
        ensemble_position_preds = (best_alpha_position * baseline_preds) + ((1 - best_alpha_position) * xgb_preds)

        per_year_rows.append(
            {
                "test_year": int(test_year),
                "train_until": int(train_until),
                "best_alpha_winner": best_alpha_winner,
                "best_alpha_position": best_alpha_position,
                "methods": {
                    "baseline": collect_metrics(baseline_preds, y_test, test_df),
                    "xgboost": collect_metrics(xgb_preds, y_test, test_df),
                    "ensemble_winner": collect_metrics(ensemble_winner_preds, y_test, test_df),
                    "ensemble_position": collect_metrics(ensemble_position_preds, y_test, test_df),
                },
            }
        )

    if not per_year_rows:
        return None

    return {
        "features": feature_set,
        "years": [row["test_year"] for row in per_year_rows],
        "methods": {
            method_key: average_metrics(per_year_rows, method_key)
            for method_key in METHODS
        },
        "per_year": per_year_rows,
    }


def sort_entries(entries, metric_key):
    reverse = metric_key not in LOWER_IS_BETTER
    return sorted(entries, key=lambda entry: entry["value"], reverse=reverse)


def build_method_entries(results, method_key):
    entries = []
    for row in results:
        entries.append(
            {
                "features": row["features"],
                "years": row["years"],
                "metrics": row["methods"][method_key],
            }
        )
    return entries


def best_by_method_and_metric(results, top_n):
    payload = {}
    for method_key in METHODS:
        payload[method_key] = {}
        entries = build_method_entries(results, method_key)
        for metric_key in OBJECTIVES:
            ranked = sort_entries(
                [
                    {
                        "method": method_key,
                        "metric": metric_key,
                        "value": entry["metrics"][metric_key],
                        "features": entry["features"],
                        "years": entry["years"],
                        "all_metrics": entry["metrics"],
                    }
                    for entry in entries
                ],
                metric_key,
            )
            payload[method_key][metric_key] = {
                "best": ranked[0],
                "top_n": ranked[:top_n],
            }
    return payload


def best_overall_by_metric(results):
    payload = {}
    for metric_key in OBJECTIVES:
        candidates = []
        for row in results:
            for method_key in METHODS:
                candidates.append(
                    {
                        "method": method_key,
                        "metric": metric_key,
                        "value": row["methods"][method_key][metric_key],
                        "features": row["features"],
                        "years": row["years"],
                        "all_metrics": row["methods"][method_key],
                    }
                )
        payload[metric_key] = sort_entries(candidates, metric_key)[0]
    return payload


def feature_importance(results, method_key, metric_key):
    values = []
    for feature in OPTIONAL_FEATURES:
        metric_values = [
            row["methods"][method_key][metric_key]
            for row in results
            if feature in row["features"]
        ]
        if not metric_values:
            continue
        values.append(
            {
                "feature": feature,
                f"avg_{metric_key}": round(sum(metric_values) / len(metric_values), 3),
                "n_sets": len(metric_values),
            }
        )
    reverse = metric_key not in LOWER_IS_BETTER
    return sorted(values, key=lambda row: row[f"avg_{metric_key}"], reverse=reverse)


def build_profile_benchmarks(results, overall):
    benchmarks = {}
    for profile_key, metric_key in PROFILE_OBJECTIVES.items():
        best = overall.get(metric_key)
        if not best:
            continue

        matched_row = None
        for row in results:
            if row["features"] != best["features"]:
                continue
            if round(row["methods"][best["method"]][metric_key], 3) != round(best["value"], 3):
                continue
            matched_row = row
            break

        if not matched_row:
            continue

        benchmarks[profile_key] = {
            "years": matched_row["years"],
            "averages": matched_row["methods"],
            "rows": [
                {
                    "test_year": per_year["test_year"],
                    "train_until": per_year["train_until"],
                    "baseline": per_year["methods"]["baseline"],
                    "xgboost": per_year["methods"]["xgboost"],
                    "ensemble_winner": per_year["methods"]["ensemble_winner"],
                    "ensemble_position": per_year["methods"]["ensemble_position"],
                    "best_alpha_winner": per_year["best_alpha_winner"],
                    "best_alpha_position": per_year["best_alpha_position"],
                }
                for per_year in matched_row["per_year"]
            ],
        }

    return benchmarks


def main():
    parser = argparse.ArgumentParser(description="Exhaustive or sampled feature search across all four model methods")
    parser.add_argument("--strategy", choices=["exhaustive", "min_k_max_k", "random", "neighbors"], default="min_k_max_k")
    parser.add_argument("--min-k", type=int, default=3)
    parser.add_argument("--max-k", type=int, default=8)
    parser.add_argument("--random-samples", type=int, default=250)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--top-n", type=int, default=20)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed-summary", type=Path, default=DEFAULT_SEED_SUMMARY)
    args = parser.parse_args()

    test_configs = load_test_configs(args.input)
    df_clean = df.dropna(subset=ALL_ENGINEERED_FEATURES).copy()
    candidates = build_candidates(args.strategy, args.min_k, args.max_k, args.random_samples, args.seed, args.seed_summary)

    print(f"Evaluating {len(candidates):,} candidate feature sets")
    print(f"Test configs: {test_configs}")
    print(f"Methods: {', '.join(METHODS)}")
    print(f"Objectives: {', '.join(OBJECTIVES)}")
    if args.strategy == "neighbors":
        seed_feature_sets = load_seed_feature_sets(args.seed_summary)
        _, profile_candidates = build_neighbor_candidates(seed_feature_sets)
        print(f"Seed summary: {args.seed_summary}")
        for profile_key, feature_sets in profile_candidates.items():
            print(
                f"  {profile_key}: seed={seed_feature_sets[profile_key]} | "
                f"local candidates={len(feature_sets)}"
            )

    results = []
    for idx, feature_set in enumerate(candidates, start=1):
        result = evaluate_feature_set(df_clean, feature_set, test_configs)
        if result:
            results.append(result)

        if idx % 25 == 0 or idx == len(candidates):
            overall = best_overall_by_metric(results) if results else {}
            if overall:
                print(
                    f"[{idx:>5}/{len(candidates)}] "
                    f"winner={overall['winner_acc']['value']:.3f} ({overall['winner_acc']['method']}) "
                    f"podium={overall['podium_acc']['value']:.3f} ({overall['podium_acc']['method']}) "
                    f"spearman={overall['spearman']['value']:.3f} ({overall['spearman']['method']}) "
                    f"mae={overall['mae']['value']:.3f} ({overall['mae']['method']})"
                )

    if not results:
        raise RuntimeError("No feature sets produced valid results")

    by_method = best_by_method_and_metric(results, args.top_n)
    overall = best_overall_by_metric(results)
    importance = {
        method_key: {
            metric_key: feature_importance(results, method_key, metric_key)
            for metric_key in OBJECTIVES
        }
        for method_key in METHODS
    }
    profile_benchmarks = build_profile_benchmarks(results, overall)

    payload = {
        "strategy": args.strategy,
        "test_configs": test_configs,
        "methods": list(METHODS),
        "objectives": list(OBJECTIVES),
        "search_space": {
            "core_features": CORE_FEATURES,
            "optional_features": OPTIONAL_FEATURES,
            "min_k": args.min_k,
            "max_k": args.max_k,
            "random_samples": args.random_samples if args.strategy == "random" else None,
            "seed": args.seed if args.strategy == "random" else None,
            "candidate_count": len(candidates),
        },
        "best_overall_by_metric": overall,
        "best_by_method_and_metric": by_method,
        "feature_importance_by_method_and_metric": importance,
        "seed_summary": str(args.seed_summary) if args.strategy == "neighbors" else None,
        "seed_profiles": load_seed_feature_sets(args.seed_summary) if args.strategy == "neighbors" else None,
        "profile_benchmarks": profile_benchmarks,
        "all_results": results,
    }

    args.output.write_text(json.dumps(payload, indent=2))
    print(f"Saved feature search to {args.output}")
    print("Best overall by metric:")
    for metric_key in OBJECTIVES:
        best = overall[metric_key]
        print(f"  {metric_key}: {best['value']} via {best['method']} -> {best['features']}")


if __name__ == "__main__":
    main()
