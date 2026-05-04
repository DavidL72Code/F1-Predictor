"""
F1 Strategy Predictor API
Notebook-aligned feature pipeline and race prediction endpoints.
"""

import json
import os

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, ndcg_score
from sklearn.preprocessing import LabelEncoder, StandardScaler
from xgboost import XGBRegressor

app = FastAPI(title="F1 Strategy Predictor API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(BASE, "../..")
DATA = os.path.join(ROOT, "data")
MODELS = os.path.join(ROOT, "models")
FEATURE_SEARCH_RESULTS = os.path.join(DATA, "processed", "feature_search_results.json")
FEATURE_SEARCH_PROFILE_SUMMARY = os.path.join(DATA, "processed", "feature_search_profile_summary.json")
FEATURE_SEARCH_PROFILE_LIVE_SUMMARY = os.path.join(DATA, "processed", "feature_search_profile_live_summary.json")
DEFAULT_PROFILE = "winner"

PROFILE_METADATA = {
    "winner": {
        "label": "Winner-Centric",
        "description": "Optimized to pick P1 as often as possible.",
        "objective_metric": "winner_acc",
        "alpha_key": "best_alpha_winner",
        "default_alpha": 0.2,
    },
    "full_order": {
        "label": "Full Finishing Order",
        "description": "Optimized for the strongest full-grid ranking quality.",
        "objective_metric": "spearman",
        "alpha_key": "best_alpha_position",
        "default_alpha": 0.5,
    },
}

TEAM_COLORS = {
    "red_bull": "#3671C6",
    "mercedes": "#27F4D2",
    "ferrari": "#E8002D",
    "mclaren": "#FF8000",
    "aston_martin": "#229971",
    "alpine": "#FF87BC",
    "williams": "#64C4FF",
    "haas": "#B6BABD",
    "alfa": "#C92D4B",
    "alphatauri": "#5E8FAA",
    "rb": "#6692FF",
    "kick_sauber": "#52E252",
    "sauber": "#52E252",
    "cadillac": "#FF4400",
}

CIRCUIT_TYPES = {
    "monaco": 0,
    "baku": 0,
    "marina_bay": 0,
    "jeddah": 0,
    "vegas": 0,
    "albert_park": 0,
    "villeneuve": 0,
    "ifema_madrid": 0,
    "monza": 1,
    "spa": 1,
    "silverstone": 1,
    "red_bull_ring": 1,
    "zandvoort": 1,
    "suzuka": 1,
    "bahrain": 2,
    "shanghai": 2,
    "catalunya": 2,
    "hungaroring": 2,
    "americas": 2,
    "rodriguez": 2,
    "interlagos": 2,
    "yas_marina": 2,
    "losail": 2,
    "imola": 2,
    "miami": 2,
}

F1_2026_DRIVERS = [
    {"driver": "max_verstappen", "team": "red_bull"},
    {"driver": "isack_hadjar", "team": "red_bull"},
    {"driver": "lewis_hamilton", "team": "ferrari"},
    {"driver": "charles_leclerc", "team": "ferrari"},
    {"driver": "kimi_antonelli", "team": "mercedes"},
    {"driver": "george_russell", "team": "mercedes"},
    {"driver": "lando_norris", "team": "mclaren"},
    {"driver": "oscar_piastri", "team": "mclaren"},
    {"driver": "fernando_alonso", "team": "aston_martin"},
    {"driver": "lance_stroll", "team": "aston_martin"},
    {"driver": "pierre_gasly", "team": "alpine"},
    {"driver": "franco_calapinto", "team": "alpine"},
    {"driver": "carlos_sainz", "team": "williams"},
    {"driver": "alexander_albon", "team": "williams"},
    {"driver": "liam_lawson", "team": "rb"},
    {"driver": "arvid_lindblad", "team": "rb"},
    {"driver": "nico_hulkenberg", "team": "kick_sauber"},
    {"driver": "gabriel_bortoleto", "team": "kick_sauber"},
    {"driver": "oliver_bearman", "team": "haas"},
    {"driver": "esteban_ocon", "team": "haas"},
    {"driver": "sergio_perez", "team": "cadillac"},
    {"driver": "valtteri_bottas", "team": "cadillac"},
]

F1_2026_CIRCUITS = [
    {"round": 1, "circuit": "albert_park", "name": "Australian GP", "completed": True},
    {"round": 2, "circuit": "shanghai", "name": "Chinese GP (Sprint)", "completed": False},
    {"round": 3, "circuit": "suzuka", "name": "Japanese GP", "completed": False},
    {"round": 4, "circuit": "bahrain", "name": "Bahrain GP", "completed": False},
    {"round": 5, "circuit": "jeddah", "name": "Saudi Arabian GP", "completed": False},
    {"round": 6, "circuit": "miami", "name": "Miami GP (Sprint)", "completed": False},
    {"round": 7, "circuit": "villeneuve", "name": "Canadian GP (Sprint)", "completed": False},
    {"round": 8, "circuit": "monaco", "name": "Monaco GP", "completed": False},
    {"round": 9, "circuit": "catalunya", "name": "Barcelona GP", "completed": False},
    {"round": 10, "circuit": "red_bull_ring", "name": "Austrian GP", "completed": False},
    {"round": 11, "circuit": "silverstone", "name": "British GP (Sprint)", "completed": False},
    {"round": 12, "circuit": "spa", "name": "Belgian GP", "completed": False},
    {"round": 13, "circuit": "hungaroring", "name": "Hungarian GP", "completed": False},
    {"round": 14, "circuit": "zandvoort", "name": "Dutch GP (Sprint)", "completed": False},
    {"round": 15, "circuit": "monza", "name": "Italian GP", "completed": False},
    {"round": 16, "circuit": "ifema_madrid", "name": "Spanish GP", "completed": False},
    {"round": 17, "circuit": "baku", "name": "Azerbaijan GP", "completed": False},
    {"round": 18, "circuit": "marina_bay", "name": "Singapore GP (Sprint)", "completed": False},
    {"round": 19, "circuit": "americas", "name": "US GP", "completed": False},
    {"round": 20, "circuit": "rodriguez", "name": "Mexico City GP", "completed": False},
    {"round": 21, "circuit": "interlagos", "name": "Sao Paulo GP", "completed": False},
    {"round": 22, "circuit": "vegas", "name": "Las Vegas GP", "completed": False},
    {"round": 23, "circuit": "losail", "name": "Qatar GP", "completed": False},
    {"round": 24, "circuit": "yas_marina", "name": "Abu Dhabi GP", "completed": False},
]


def _read_csv(path):
    return pd.read_csv(path) if os.path.exists(path) else None


print("Loading CSVs...")
results_df = pd.read_csv(f"{DATA}/raw/historical_results.csv")
quali_df = pd.read_csv(f"{DATA}/raw/qualifying_results.csv")
gaps_df = pd.read_csv(f"{DATA}/processed/quali_gaps.csv")
standings_df = _read_csv(f"{DATA}/processed/constructor_standings.csv")
tyres_df = _read_csv(f"{DATA}/processed/tyre_data.csv")
weather_df = _read_csv(f"{DATA}/processed/race_weather.csv")

print(
    "  results:%s | quali:%s | gaps:%s | standings:%s | tyres:%s | weather:%s"
    % (
        len(results_df),
        len(quali_df),
        len(gaps_df),
        len(standings_df) if standings_df is not None else 0,
        len(tyres_df) if tyres_df is not None else 0,
        len(weather_df) if weather_df is not None else 0,
    )
)

print("Building notebook-aligned feature matrix...")
df = results_df.merge(
    quali_df[["year", "round", "driver", "quali_pos"]],
    on=["year", "round", "driver"],
    how="left",
)
df = df.merge(
    gaps_df[["year", "round", "driver", "quali_gap"]],
    on=["year", "round", "driver"],
    how="left",
)
df["quali_gap"] = df["quali_gap"].fillna(df["quali_gap"].median())

if standings_df is not None:
    df = df.merge(
        standings_df[["year", "round", "team", "constructor_rank_norm"]],
        on=["year", "round", "team"],
        how="left",
    )
    df["constructor_rank_norm"] = df["constructor_rank_norm"].fillna(0.5)
else:
    df["constructor_rank_norm"] = 0.5

if tyres_df is not None:
    df = df.merge(
        tyres_df[["year", "round", "driver", "starting_compound"]],
        on=["year", "round", "driver"],
        how="left",
    )
    df["starting_compound"] = df["starting_compound"].fillna(1)
else:
    df["starting_compound"] = 1

if weather_df is not None:
    df = df.merge(
        weather_df[["year", "round", "wet_race", "track_temp"]],
        on=["year", "round"],
        how="left",
    )
    df["wet_race"] = df["wet_race"].fillna(0).astype(int)
    df["track_temp"] = df["track_temp"].fillna(df["track_temp"].median())
else:
    df["wet_race"] = 0
    df["track_temp"] = 35.0

df["circuit_type"] = df["circuit"].map(CIRCUIT_TYPES).fillna(2)
df = df.sort_values(["driver", "year", "round"])

df["driver_form"] = (
    df.groupby("driver")["position"]
    .transform(lambda x: x.shift(1).rolling(5, min_periods=1).mean())
    .fillna(10.5)
)
df["team_win_rate"] = (
    df.groupby(["year", "team"])["won"]
    .transform(lambda x: x.shift(1).expanding().mean())
    .fillna(0)
)
df["circuit_wins_before"] = (
    df.groupby(["driver", "circuit"])["won"]
    .transform(lambda x: x.shift(1).expanding().sum())
    .fillna(0)
)
df["finished"] = (
    ~df["status"].str.contains("Lap|Accident|Collision|Engine|Gearbox", na=False)
).astype(int)
df["driver_finish_rate"] = (
    df.groupby("driver")["finished"]
    .transform(lambda x: x.shift(1).rolling(10, min_periods=1).mean())
    .fillna(0.9)
)
df["circuit_avg_finish"] = (
    df.groupby(["driver", "circuit"])["position"]
    .transform(lambda x: x.shift(1).expanding().mean())
    .fillna(10.5)
)
df["circuit_overperformance"] = df["circuit_avg_finish"] - df["driver_form"]
df["grid_penalty"] = (df["grid"] - df["quali_pos"]).clip(lower=0).fillna(0)
df["constructor_momentum"] = (
    df.groupby(["year", "team"])["constructor_rank_norm"]
    .transform(lambda x: x.diff(3))
    .fillna(0)
)

team_enc_obj = LabelEncoder()
circuit_enc_obj = LabelEncoder()
df["team_encoded"] = team_enc_obj.fit_transform(df["team"])
df["circuit_encoded"] = circuit_enc_obj.fit_transform(df["circuit"])

ALL_ENGINEERED_FEATURES = [
    "grid",
    "quali_pos",
    "quali_gap",
    "grid_penalty",
    "driver_form",
    "team_win_rate",
    "circuit_wins_before",
    "circuit_avg_finish",
    "circuit_overperformance",
    "driver_finish_rate",
    "constructor_rank_norm",
    "constructor_momentum",
    "starting_compound",
    "circuit_type",
    "wet_race",
    "track_temp",
    "team_encoded",
    "circuit_encoded",
]
TARGET = "position"


def load_best_feature_search_result():
    if not os.path.exists(FEATURE_SEARCH_RESULTS):
        return None

    try:
        with open(FEATURE_SEARCH_RESULTS) as f:
            search_data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Unable to load feature search results: {exc}")
        return None

    candidates = search_data.get("all_results") or search_data.get("top_20") or []
    if not candidates:
        return None

    best = max(candidates, key=lambda row: float(row.get("winner_acc", float("-inf"))))
    features = [str(feature) for feature in best.get("features", []) if str(feature) in ALL_ENGINEERED_FEATURES]
    if not features:
        return None

    return {
        "features": features,
        "winner_acc": float(best.get("winner_acc", 0.0)),
        "test_configs": [tuple(config) for config in search_data.get("test_configs", [])],
    }

def load_feature_profiles():
    profiles = {}
    search_all_methods = None
    search_source = None

    for candidate_path in [FEATURE_SEARCH_PROFILE_LIVE_SUMMARY, FEATURE_SEARCH_PROFILE_SUMMARY]:
        if not os.path.exists(candidate_path):
            continue
        try:
            with open(candidate_path) as f:
                search_all_methods = json.load(f)
            search_source = os.path.basename(candidate_path)
            break
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Unable to load feature search profile summary from {candidate_path}: {exc}")

    if search_all_methods:
        best_overall = search_all_methods.get("best_overall_by_metric", {})
        test_configs = [tuple(config) for config in search_all_methods.get("test_configs", [])]
        stored_benchmarks = search_all_methods.get("profile_benchmarks", {})

        for profile_key, meta in PROFILE_METADATA.items():
            objective_metric = meta["objective_metric"]
            best = best_overall.get(objective_metric)
            if not best:
                continue

            features = [
                str(feature)
                for feature in best.get("features", [])
                if str(feature) in ALL_ENGINEERED_FEATURES
            ]
            if not features:
                continue

            profiles[profile_key] = {
                "profile": profile_key,
                "label": meta["label"],
                "description": meta["description"],
                "objective_metric": objective_metric,
                "alpha_key": meta["alpha_key"],
                "default_alpha": meta["default_alpha"],
                "features": features,
                "objective_value": float(best.get("value", 0.0)),
                "selected_method": str(best.get("method", "")),
                "all_metrics": best.get("all_metrics", {}),
                "test_configs": test_configs,
                "source": search_source or "feature_search_profile_summary.json",
                "stored_benchmark": stored_benchmarks.get(profile_key),
            }

    winner_fallback = load_best_feature_search_result()
    if "winner" not in profiles and winner_fallback:
        profiles["winner"] = {
            "profile": "winner",
            "label": PROFILE_METADATA["winner"]["label"],
            "description": PROFILE_METADATA["winner"]["description"],
            "objective_metric": "winner_acc",
            "alpha_key": PROFILE_METADATA["winner"]["alpha_key"],
            "default_alpha": PROFILE_METADATA["winner"]["default_alpha"],
            "features": winner_fallback["features"],
            "objective_value": float(winner_fallback["winner_acc"]),
            "selected_method": "feature_search",
            "all_metrics": {"winner_acc": float(winner_fallback["winner_acc"])},
            "test_configs": winner_fallback["test_configs"],
            "source": "feature_search_results.json",
        }

    if "full_order" not in profiles:
        profiles["full_order"] = {
            "profile": "full_order",
            "label": PROFILE_METADATA["full_order"]["label"],
            "description": PROFILE_METADATA["full_order"]["description"],
            "objective_metric": "spearman",
            "alpha_key": PROFILE_METADATA["full_order"]["alpha_key"],
            "default_alpha": PROFILE_METADATA["full_order"]["default_alpha"],
            "features": list(ALL_ENGINEERED_FEATURES),
            "objective_value": None,
            "selected_method": "xgboost",
            "all_metrics": {},
            "test_configs": [],
            "source": "fallback_all_engineered_features",
        }

    return profiles


def train_profile_xgb(df_clean_profile, features):
    model = XGBRegressor(
        colsample_bytree=0.7,
        learning_rate=0.05,
        max_depth=3,
        n_estimators=100,
        subsample=0.9,
        random_state=42,
        eval_metric="mae",
    )
    model.fit(df_clean_profile[features], df_clean_profile[TARGET])
    return model


def build_profile_runtimes():
    runtimes = {}
    loaded_xgb_model = joblib.load(f"{MODELS}/position_ranker.pkl")
    loaded_model_features = [str(feature) for feature in getattr(loaded_xgb_model, "feature_names_in_", [])]

    for profile_key, profile in load_feature_profiles().items():
        features = profile["features"]
        missing_features = [feature for feature in features if feature not in df.columns]
        if missing_features:
            raise RuntimeError(f"Missing model features in API feature pipeline for {profile_key}: {missing_features}")

        df_clean_profile = df.dropna(subset=features).copy()
        if df_clean_profile.empty:
            raise RuntimeError(f"No rows available after dropping NaNs for profile {profile_key}")

        if loaded_model_features == features:
            profile_xgb = loaded_xgb_model
        else:
            print(f"Re-training historical ranker for profile '{profile_key}' with {len(features)} features...")
            profile_xgb = train_profile_xgb(df_clean_profile, features)

        runtimes[profile_key] = {
            **profile,
            "df_clean": df_clean_profile,
            "xgb_model": profile_xgb,
        }

        print(
            "Profile '%s': %s | features:%s | rows:%s"
            % (profile_key, ", ".join(features), len(features), len(df_clean_profile))
        )

    return runtimes

analytics_data = None
if os.path.exists(f"{DATA}/processed/analytics_results.json"):
    with open(f"{DATA}/processed/analytics_results.json") as f:
        analytics_data = json.load(f)


def compute_eval_metrics(preds, y_test, test_df):
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
    correct = 0
    correct_podium = 0

    for round_num in check["round"].unique():
        race = check[check["round"] == round_num]
        predicted_winner = race.loc[race["predicted_pos"].idxmin(), "driver"]
        actual_winner = race.loc[race["won"] == 1, "driver"].values[0]
        if predicted_winner == actual_winner:
            correct += 1

        predicted_top3 = set(race.nsmallest(3, "predicted_pos")["driver"])
        actual_top3 = set(race.nsmallest(3, "position")["driver"])
        if predicted_top3 == actual_top3:
            correct_podium += 1

    return {
        "spearman": round(float(spearman), 3),
        "ndcg": round(float(ndcg), 3),
        "mae": round(float(mae), 2),
        "within_3": round(float(within_3), 1),
        "winner_acc": round(correct / total * 100, 1),
        "podium_acc": round(correct_podium / total * 100, 1),
        "races": int(total),
    }


def compute_live_feature_search_benchmark(profile_runtime):
    test_configs = profile_runtime.get("test_configs") or []
    if not test_configs:
        return None

    df_clean_profile = profile_runtime["df_clean"]
    features = profile_runtime["features"]

    benchmark_rows = []
    for test_year, train_until in test_configs:
        train_df = df_clean_profile[df_clean_profile["year"] <= train_until].dropna(subset=features)
        test_df = df_clean_profile[df_clean_profile["year"] == test_year].dropna(subset=features)
        if train_df.empty or test_df.empty:
            continue

        X_train = train_df[features]
        y_train = train_df[TARGET]
        X_test = test_df[features]
        y_test = test_df[TARGET]

        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        baseline = Ridge()
        baseline.fit(X_train_scaled, y_train)
        baseline_preds = baseline.predict(X_test_scaled)

        benchmark_xgb = XGBRegressor(
            colsample_bytree=0.7,
            learning_rate=0.05,
            max_depth=3,
            n_estimators=100,
            subsample=0.9,
            random_state=42,
            eval_metric="mae",
        )
        benchmark_xgb.fit(X_train, y_train)
        xgb_preds = benchmark_xgb.predict(X_test)

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

        benchmark_rows.append(
            {
                "test_year": int(test_year),
                "train_until": int(train_until),
                "baseline": compute_eval_metrics(baseline_preds, y_test, test_df),
                "xgboost": compute_eval_metrics(xgb_preds, y_test, test_df),
                "ensemble_winner": compute_eval_metrics(ensemble_winner_preds, y_test, test_df),
                "ensemble_position": compute_eval_metrics(ensemble_position_preds, y_test, test_df),
                "best_alpha_winner": best_alpha_winner,
                "best_alpha_position": best_alpha_position,
            }
        )

    if not benchmark_rows:
        return None

    model_keys = ["baseline", "xgboost", "ensemble_winner", "ensemble_position"]
    metric_keys = ["winner_acc", "podium_acc", "spearman", "mae", "ndcg", "within_3"]
    averages = {}
    for model_key in model_keys:
        averages[model_key] = {}
        for metric_key in metric_keys:
            averages[model_key][metric_key] = round(
                sum(row[model_key][metric_key] for row in benchmark_rows) / len(benchmark_rows),
                3,
            )

    return {
        "years": [row["test_year"] for row in benchmark_rows],
        "rows": benchmark_rows,
        "averages": averages,
    }


print("Loading model artifacts...")
PROFILE_RUNTIMES = build_profile_runtimes()
for runtime in PROFILE_RUNTIMES.values():
    runtime["feature_search_benchmark"] = runtime.get("stored_benchmark") or compute_live_feature_search_benchmark(runtime)


def get_profile_runtime(profile):
    runtime = PROFILE_RUNTIMES.get(profile or DEFAULT_PROFILE)
    if runtime:
        return runtime
    available = ", ".join(sorted(PROFILE_RUNTIMES))
    raise HTTPException(status_code=400, detail=f"Unknown profile '{profile}'. Available profiles: {available}")


def get_historical_alpha(year, profile_runtime):
    benchmark = profile_runtime.get("feature_search_benchmark")
    alpha_key = profile_runtime["alpha_key"]
    default_alpha = float(profile_runtime["default_alpha"])

    if benchmark:
        for row in benchmark["rows"]:
            if int(row.get("test_year", -1)) == int(year):
                return float(row.get(alpha_key, default_alpha))
    if not analytics_data:
        return default_alpha
    for row in analytics_data.get("with_gap", []):
        if int(row.get("test_year", -1)) == int(year):
            return float(row.get(alpha_key, default_alpha))
    return default_alpha


def get_future_alpha(profile_runtime):
    benchmark = profile_runtime.get("feature_search_benchmark")
    alpha_key = profile_runtime["alpha_key"]
    default_alpha = float(profile_runtime["default_alpha"])
    if not benchmark or not benchmark.get("rows"):
        return default_alpha
    return round(
        float(sum(float(row.get(alpha_key, default_alpha)) for row in benchmark["rows"]) / len(benchmark["rows"])),
        3,
    )


def get_constructor_rank(team, profile_runtime):
    df_clean_profile = profile_runtime["df_clean"]
    team_data = df_clean_profile[df_clean_profile["team"] == team]
    if team_data.empty:
        return 0.5
    latest = team_data.sort_values(["year", "round"]).iloc[-1]
    return float(latest["constructor_rank_norm"])


def win_probs_from_preds(preds):
    inv = 1 / np.clip(preds, 0.1, 25)
    return (inv / inv.sum()) * 100


def make_results(rows, preds, win_probs, actual=None):
    results = []
    for i, row in enumerate(rows):
        results.append(
            {
                "driver": row["driver"],
                "team": row["team"],
                "team_color": TEAM_COLORS.get(row["team"], "#888"),
                "grid": int(row.get("grid", 10)),
                "quali_pos": int(row.get("quali_pos", 10)),
                "quali_gap": round(float(row.get("quali_gap", 0.5)), 3),
                "driver_form": round(float(row.get("driver_form", 0)), 3),
                "constructor_rank_norm": round(float(row.get("constructor_rank_norm", 0.5)), 3),
                "starting_compound": int(row.get("starting_compound", 1)),
                "wet_race": int(row.get("wet_race", 0)),
                "track_temp": round(float(row.get("track_temp", 35.0)), 1),
                "predicted_position": round(float(preds[i]), 2),
                "win_probability": round(float(win_probs[i]), 1),
                "actual_position": int(actual[i]) if actual is not None else None,
                "won": int(row.get("won", 0)),
            }
        )
    results.sort(key=lambda x: x["predicted_position"])
    for i, result in enumerate(results):
        result["predicted_rank"] = i + 1
    return results


def accuracy_metrics(results):
    if any(r["actual_position"] is None for r in results):
        return None
    predicted_winner = results[0]["driver"]
    actual_winner = min(results, key=lambda x: x["actual_position"])["driver"]
    predicted_podium = {r["driver"] for r in results[:3]}
    actual_podium = {r["driver"] for r in sorted(results, key=lambda x: x["actual_position"])[:3]}
    by_driver = sorted(results, key=lambda x: x["driver"])
    corr, _ = spearmanr(
        [r["predicted_position"] for r in by_driver],
        [r["actual_position"] for r in by_driver],
    )
    mae = mean_absolute_error(
        [r["actual_position"] for r in results],
        [r["predicted_position"] for r in results],
    )
    tolerance = {
        f"within_{t}": round(
            sum(1 for r in results if abs(r["predicted_rank"] - r["actual_position"]) <= t)
            / len(results)
            * 100,
            1,
        )
        for t in [1, 2, 3, 5]
    }
    return {
        "winner_correct": predicted_winner == actual_winner,
        "podium_correct": predicted_podium == actual_podium,
        "spearman": round(float(corr), 3),
        "mae": round(float(mae), 2),
        "tolerance": tolerance,
    }


def predict_historical(year, round_number, profile=DEFAULT_PROFILE):
    profile_runtime = get_profile_runtime(profile)
    df_clean_profile = profile_runtime["df_clean"]
    features = profile_runtime["features"]
    profile_xgb = profile_runtime["xgb_model"]

    race = df_clean_profile[(df_clean_profile["year"] == year) & (df_clean_profile["round"] == round_number)].copy()
    if race.empty:
        raise HTTPException(status_code=404, detail=f"No data for {year} round {round_number} with profile '{profile}'")

    train = df_clean_profile[df_clean_profile["year"] < year].dropna(subset=features)
    xgb_preds = profile_xgb.predict(race[features])

    if train.empty:
        preds = xgb_preds
    else:
        scaler = StandardScaler()
        baseline = Ridge()
        X_train_scaled = scaler.fit_transform(train[features])
        baseline.fit(X_train_scaled, train[TARGET])
        baseline_preds = baseline.predict(scaler.transform(race[features]))
        alpha = get_historical_alpha(year, profile_runtime)
        preds = (alpha * baseline_preds) + ((1 - alpha) * xgb_preds)

    win_probs = win_probs_from_preds(preds)
    results = make_results(race.to_dict("records"), preds, win_probs, race["position"].values)
    return results, accuracy_metrics(results)


def predict_future_2026(circuit_id, profile=DEFAULT_PROFILE, recent_weight=10):
    profile_runtime = get_profile_runtime(profile)
    df_clean_profile = profile_runtime["df_clean"]
    features = profile_runtime["features"]

    train_df = df_clean_profile.dropna(subset=features).copy()
    X_train = train_df[features]
    y_train = train_df[TARGET]

    weights = np.ones(len(train_df))
    weights[train_df["year"] == 2026] = recent_weight
    weights[train_df["year"] == 2025] = recent_weight * 0.3
    weights[train_df["year"] == 2024] = recent_weight * 0.1

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)

    baseline = Ridge()
    baseline.fit(X_train_scaled, y_train)

    weighted_xgb = XGBRegressor(
        n_estimators=300,
        max_depth=3,
        learning_rate=0.01,
        subsample=0.9,
        colsample_bytree=0.8,
        min_child_weight=1,
        reg_lambda=1,
        random_state=42,
        eval_metric="mae",
    )
    weighted_xgb.fit(X_train, y_train, sample_weight=weights)

    rows = []
    for driver_data in F1_2026_DRIVERS:
        driver = driver_data["driver"]
        team = driver_data["team"]
        driver_history = df_clean_profile[df_clean_profile["driver"] == driver]

        if driver_history.empty:
            team_history = df_clean_profile[df_clean_profile["team"] == team]
            driver_form = float(team_history["driver_form"].mean()) if not team_history.empty else 10.5
            finish_rate = float(team_history["driver_finish_rate"].mean()) if not team_history.empty else 0.8
            team_win_rate = float(team_history["team_win_rate"].mean()) if not team_history.empty else 0.0
            constructor_momentum = float(team_history["constructor_momentum"].iloc[-1]) if not team_history.empty else 0.0
        else:
            latest = driver_history.sort_values(["year", "round"]).iloc[-1]
            driver_form = float(latest["driver_form"])
            finish_rate = float(latest["driver_finish_rate"])
            team_win_rate = float(latest["team_win_rate"])
            team_history = df_clean_profile[df_clean_profile["team"] == team].sort_values(["year", "round"])
            constructor_momentum = float(team_history["constructor_momentum"].iloc[-1]) if not team_history.empty else 0.0

        circuit_wins = float(
            df_clean_profile[(df_clean_profile["driver"] == driver) & (df_clean_profile["circuit"] == circuit_id)]["won"].sum()
        )
        circuit_history = df_clean_profile[
            (df_clean_profile["driver"] == driver) & (df_clean_profile["circuit"] == circuit_id)
        ]
        circuit_avg_finish = float(circuit_history["position"].mean()) if not circuit_history.empty else 10.5
        circuit_overperformance = circuit_avg_finish - driver_form

        try:
            team_encoded = int(team_enc_obj.transform([team])[0])
        except ValueError:
            team_encoded = 0
        try:
            circuit_encoded = int(circuit_enc_obj.transform([circuit_id])[0])
        except ValueError:
            circuit_encoded = 0

        rows.append(
            {
                "driver": driver,
                "team": team,
                "grid": 10,
                "quali_pos": 10,
                "quali_gap": 0.5,
                "grid_penalty": 0,
                "driver_form": driver_form,
                "team_win_rate": team_win_rate,
                "circuit_wins_before": circuit_wins,
                "circuit_avg_finish": circuit_avg_finish,
                "circuit_overperformance": circuit_overperformance,
                "driver_finish_rate": finish_rate,
                "constructor_rank_norm": get_constructor_rank(team, profile_runtime),
                "constructor_momentum": constructor_momentum,
                "starting_compound": 1,
                "circuit_type": CIRCUIT_TYPES.get(circuit_id, 2),
                "wet_race": 0,
                "track_temp": 35.0,
                "team_encoded": team_encoded,
                "circuit_encoded": circuit_encoded,
                "won": 0,
            }
        )

    features_df = pd.DataFrame(rows)[features]
    baseline_preds = baseline.predict(scaler.transform(features_df))
    xgb_preds = weighted_xgb.predict(features_df)

    best_alpha = get_future_alpha(profile_runtime)
    preds = (best_alpha * baseline_preds) + ((1 - best_alpha) * xgb_preds)
    win_probs = win_probs_from_preds(preds)
    return make_results(rows, preds, win_probs, None), best_alpha


@app.get("/")
def root():
    return {
        "status": "F1 API",
        "default_profile": DEFAULT_PROFILE,
        "profiles": sorted(PROFILE_RUNTIMES),
        "years": sorted(df["year"].unique().tolist()),
    }


@app.head("/health")
def health_head():
    return {}


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "rows": len(df),
        "profiles": {
            profile_key: {
                "features": len(runtime["features"]),
                "rows": len(runtime["df_clean"]),
            }
            for profile_key, runtime in PROFILE_RUNTIMES.items()
        },
        "years": sorted(df["year"].unique().tolist()),
    }


@app.get("/races")
def get_races():
    hist = (
        df.groupby(["year", "circuit", "round"])
        .size()
        .reset_index(name="drivers")
        .sort_values(["year", "round"])
    )
    historical = [
        {
            "key": f"{int(r['year'])}_{int(r['round'])}",
            "year": int(r["year"]),
            "circuit": r["circuit"],
            "round": int(r["round"]),
            "drivers": int(r["drivers"]),
            "name": f"{int(r['year'])} Round {int(r['round'])} - {r['circuit'].replace('_', ' ').title()} GP",
            "is_future": False,
        }
        for _, r in hist.iterrows()
    ]
    future = [
        {
            "key": f"2026_{c['circuit']}",
            "year": 2026,
            "circuit": c["circuit"],
            "round": c["round"],
            "drivers": 22,
            "name": f"2026 — {c['name']}",
            "is_future": True,
        }
        for c in F1_2026_CIRCUITS
        if not c["completed"]
    ]
    return historical + future


@app.get("/races/{year}/{round_number}")
def get_race(year: int, round_number: int, profile: str = DEFAULT_PROFILE):
    profile_runtime = get_profile_runtime(profile)
    if year == 2026:
        future_race = next((r for r in F1_2026_CIRCUITS if r["round"] == round_number), None)
        if future_race is None:
            raise HTTPException(status_code=404, detail=f"No race found for {year} round {round_number}")
        circuit = future_race["circuit"]
        completed = df[(df["year"] == 2026) & (df["round"] == round_number)]
        if completed.empty:
            results, alpha = predict_future_2026(circuit, profile=profile)
            return {
                "year": year,
                "round": round_number,
                "circuit": circuit,
                "name": future_race["name"],
                "results": results,
                "accuracy": None,
                "mode": "future",
                "profile": profile_runtime["profile"],
                "profile_label": profile_runtime["label"],
                "best_alpha": alpha,
                "note": (
                    "Pre-qualifying prediction. 2026 races weighted 10x, 2025 weighted 3x, "
                    "2024 weighted 1x. Equal grid and medium tyre assumed."
                ),
            }

    results, accuracy = predict_historical(year, round_number, profile=profile)
    race = df[(df["year"] == year) & (df["round"] == round_number)].iloc[0]
    return {
        "year": year,
        "round": round_number,
        "circuit": race["circuit"],
        "name": f"{year} Round {round_number} - {str(race['circuit']).replace('_', ' ').title()} GP",
        "results": results,
        "accuracy": accuracy,
        "mode": "historical",
        "profile": profile_runtime["profile"],
        "profile_label": profile_runtime["label"],
    }


@app.get("/years")
def get_years():
    return sorted(df["year"].unique().tolist())


@app.get("/circuits")
def get_circuits():
    return sorted(df["circuit"].unique().tolist())


@app.get("/analytics")
def get_analytics():
    if not analytics_data:
        raise HTTPException(status_code=404, detail="Run analytics cell in notebook first")
    return analytics_data


@app.get("/model/stats")
def model_stats(profile: str = DEFAULT_PROFILE):
    profile_runtime = get_profile_runtime(profile)
    return {
        "model": "Feature-search-selected Ridge + XGBoost ensemble",
        "profile": profile_runtime["profile"],
        "profile_label": profile_runtime["label"],
        "profile_description": profile_runtime["description"],
        "objective_metric": profile_runtime["objective_metric"],
        "objective_value": profile_runtime["objective_value"],
        "selected_method": profile_runtime["selected_method"],
        "features": profile_runtime["features"],
        "all_metrics": profile_runtime["all_metrics"],
        "feature_search_source": profile_runtime["source"],
        "feature_search_benchmark": profile_runtime["feature_search_benchmark"],
        "available_profiles": [
            {
                "profile": runtime["profile"],
                "label": runtime["label"],
                "description": runtime["description"],
                "objective_metric": runtime["objective_metric"],
            }
            for runtime in PROFILE_RUNTIMES.values()
        ],
        "rows": len(profile_runtime["df_clean"]),
        "years": sorted(profile_runtime["df_clean"]["year"].unique().tolist()),
    }
