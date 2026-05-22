import argparse
import datetime as dt
import math
import os
import re
import sys
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"


def slug(value):
    text = str(value or "").strip().lower()
    text = text.replace("&", "and")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


TEAM_ALIASES = {
    "red_bull": "red_bull",
    "mercedes": "mercedes",
    "ferrari": "ferrari",
    "mclaren": "mclaren",
    "aston_martin": "aston_martin",
    "alpine": "alpine",
    "williams": "williams",
    "haas": "haas",
    "rb": "rb",
    "racing_bulls": "rb",
    "visa_cash_app_rb": "rb",
    "sauber": "kick_sauber",
    "kick_sauber": "kick_sauber",
    "alfa": "alfa",
    "alfa_romeo": "alfa",
    "alphatauri": "alphatauri",
    "toro_rosso": "toro_rosso",
    "force_india": "force_india",
    "racing_point": "racing_point",
    "renault": "renault",
    "lotus_f1": "lotus_f1",
    "audi": "audi",
    "cadillac": "cadillac",
}


def normalize_team(constructor):
    constructor_id = slug(constructor.get("constructorId"))
    return TEAM_ALIASES.get(constructor_id, constructor_id)


def normalize_driver(driver):
    return slug(driver.get("driverId"))


def fetch_json(url):
    response = requests.get(url, timeout=45)
    response.raise_for_status()
    return response.json()["MRData"]


def fetch_all(path):
    url = f"{JOLPICA_BASE}/{path}.json?limit=1000"
    data = fetch_json(url)
    total = int(data.get("total", 0))
    rows = []
    offset = 0
    while True:
        page_url = f"{JOLPICA_BASE}/{path}.json?limit=1000&offset={offset}"
        page = fetch_json(page_url)
        rows.append(page)
        offset += 1000
        if offset >= total or total == 0:
            break
    return rows


def parse_time_to_seconds(value):
    if not value:
        return math.nan
    parts = str(value).split(":")
    try:
        if len(parts) == 2:
            return (float(parts[0]) * 60) + float(parts[1])
        return float(parts[0])
    except ValueError:
        return math.nan


def best_quali_seconds(result):
    times = [parse_time_to_seconds(result.get(key)) for key in ("Q1", "Q2", "Q3")]
    valid = [value for value in times if not math.isnan(value)]
    return min(valid) if valid else math.nan


def read_csv(path):
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


def replace_rounds(existing, incoming, keys=("year", "round")):
    if incoming.empty:
        return existing, False
    if existing.empty:
        return incoming, True

    current = existing.copy()
    for key_values in incoming[list(keys)].drop_duplicates().itertuples(index=False, name=None):
        mask = pd.Series(True, index=current.index)
        for key, value in zip(keys, key_values):
            mask &= current[key].astype(str).eq(str(value))
        current = current.loc[~mask]

    combined = pd.concat([current, incoming], ignore_index=True)
    sort_cols = [col for col in ["year", "round", "position", "quali_pos", "driver", "team"] if col in combined.columns]
    combined = combined.sort_values(sort_cols).reset_index(drop=True)
    return combined, not combined.equals(existing.reset_index(drop=True))


def write_if_changed(path, frame):
    old = read_csv(path)
    if not old.empty and frame.reset_index(drop=True).equals(old.reset_index(drop=True)):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    return True


def build_results(season):
    rows = []
    for page in fetch_all(f"{season}/results"):
        for race in page["RaceTable"].get("Races", []):
            year = int(race["season"])
            round_number = int(race["round"])
            circuit = slug(race["Circuit"]["circuitId"])
            for result in race.get("Results", []):
                position = int(result.get("positionOrder") or result.get("position"))
                rows.append(
                    {
                        "year": year,
                        "round": round_number,
                        "circuit": circuit,
                        "driver": normalize_driver(result["Driver"]),
                        "team": normalize_team(result["Constructor"]),
                        "grid": int(result.get("grid") or 0),
                        "position": position,
                        "won": 1 if position == 1 else 0,
                        "points": float(result.get("points") or 0),
                        "laps": int(result.get("laps") or 0),
                        "status": result.get("status", ""),
                    }
                )
    return pd.DataFrame(rows)


def build_qualifying(season):
    quali_rows = []
    gap_rows = []
    for page in fetch_all(f"{season}/qualifying"):
        for race in page["RaceTable"].get("Races", []):
            year = int(race["season"])
            round_number = int(race["round"])
            circuit = slug(race["Circuit"]["circuitId"])
            timed = []
            for result in race.get("QualifyingResults", []):
                driver = normalize_driver(result["Driver"])
                quali_rows.append(
                    {
                        "year": year,
                        "round": round_number,
                        "circuit": circuit,
                        "driver": driver,
                        "quali_pos": int(result["position"]),
                    }
                )
                timed.append((driver, best_quali_seconds(result)))

            valid_times = [seconds for _, seconds in timed if not math.isnan(seconds)]
            if valid_times:
                fastest = min(valid_times)
                for driver, seconds in timed:
                    if not math.isnan(seconds):
                        gap_rows.append(
                            {
                                "year": year,
                                "round": round_number,
                                "driver": driver,
                                "quali_gap": seconds - fastest,
                            }
                        )
    return pd.DataFrame(quali_rows), pd.DataFrame(gap_rows)


def build_constructor_standings(season, rounds):
    rows = []
    for round_number in rounds:
        try:
            data = fetch_json(f"{JOLPICA_BASE}/{season}/{round_number}/constructorstandings.json?limit=1000")
        except requests.HTTPError as exc:
            print(f"Skipping constructor standings for {season} round {round_number}: {exc}")
            continue

        lists = data["StandingsTable"].get("StandingsLists", [])
        if not lists:
            continue
        standings = lists[0].get("ConstructorStandings", [])
        total = max(len(standings), 1)
        denom = max(total - 1, 1)
        for standing in standings:
            rank = int(standing.get("position") or 0)
            rows.append(
                {
                    "year": int(season),
                    "round": int(round_number),
                    "team": normalize_team(standing["Constructor"]),
                    "constructor_rank_norm": (total - rank) / denom,
                }
            )
    return pd.DataFrame(rows)


def compound_code(compound):
    return {
        "SOFT": 0,
        "MEDIUM": 1,
        "HARD": 2,
        "INTERMEDIATE": 3,
        "WET": 4,
    }.get(str(compound or "").upper(), 1)


def enrich_fastf1(season, rounds, cache_dir):
    try:
        import fastf1
    except ImportError:
        print("FastF1 is not installed; skipping tyre and weather enrichment.")
        return pd.DataFrame(), pd.DataFrame()

    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(cache_dir))
    tyre_rows = []
    weather_rows = []
    for round_number in rounds:
        try:
            session = fastf1.get_session(season, round_number, "R")
            session.load(laps=True, telemetry=False, weather=True, messages=False)
        except Exception as exc:
            print(f"Skipping FastF1 enrichment for {season} round {round_number}: {exc}")
            continue

        laps = session.laps
        if laps is not None and not laps.empty:
            lap_one = laps[laps["LapNumber"] == 1]
            for _, lap in lap_one.dropna(subset=["Driver", "Compound"]).iterrows():
                try:
                    driver_id = session.get_driver(lap["Driver"])["DriverId"]
                except Exception:
                    driver_id = lap["Driver"]
                tyre_rows.append(
                    {
                        "year": int(season),
                        "round": int(round_number),
                        "driver": slug(driver_id),
                        "starting_compound": compound_code(lap["Compound"]),
                    }
                )

        weather = getattr(session, "weather_data", None)
        if weather is not None and not weather.empty:
            weather_rows.append(
                {
                    "year": int(season),
                    "round": int(round_number),
                    "wet_race": int(bool(weather.get("Rainfall", pd.Series([False])).fillna(False).any())),
                    "track_temp": round(float(weather["TrackTemp"].dropna().mean()), 1)
                    if "TrackTemp" in weather and not weather["TrackTemp"].dropna().empty
                    else 35.0,
                    "air_temp": round(float(weather["AirTemp"].dropna().mean()), 1)
                    if "AirTemp" in weather and not weather["AirTemp"].dropna().empty
                    else 25.0,
                }
            )

    return pd.DataFrame(tyre_rows), pd.DataFrame(weather_rows)


def update_file(path, incoming, keys=("year", "round")):
    existing = read_csv(path)
    updated, changed = replace_rounds(existing, incoming, keys=keys)
    if changed:
        write_if_changed(path, updated)
    return changed


def main():
    parser = argparse.ArgumentParser(description="Update local F1 CSVs from Jolpica and optional FastF1 data.")
    parser.add_argument("--season", type=int, default=dt.datetime.utcnow().year)
    parser.add_argument("--with-fastf1", action="store_true")
    parser.add_argument("--cache-dir", type=Path, default=DATA / "raw" / "fastf1_cache")
    args = parser.parse_args()

    changed = False
    results = build_results(args.season)
    if results.empty:
        print(f"No completed Jolpica race results found for {args.season}.")
        return 0

    rounds = sorted(results["round"].astype(int).unique().tolist())
    qualifying, gaps = build_qualifying(args.season)
    standings = build_constructor_standings(args.season, rounds)

    changed |= update_file(DATA / "raw" / "historical_results.csv", results)
    changed |= update_file(DATA / "raw" / "qualifying_results.csv", qualifying)
    changed |= update_file(DATA / "processed" / "quali_gaps.csv", gaps)
    changed |= update_file(DATA / "processed" / "constructor_standings.csv", standings)

    if args.with_fastf1:
        tyres, weather = enrich_fastf1(args.season, rounds, args.cache_dir)
        changed |= update_file(DATA / "processed" / "tyre_data.csv", tyres)
        changed |= update_file(DATA / "processed" / "race_weather.csv", weather)

    if changed:
        print(f"Updated local F1 data for {args.season}; rounds: {rounds}")
        return 2

    print(f"Local F1 data already up to date for {args.season}; rounds: {rounds}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
