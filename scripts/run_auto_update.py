import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE_SUMMARY = ROOT / "data" / "processed" / "feature_search_profile_live_summary.json"


def run(command, allow_update_exit=False):
    print("+", " ".join(str(part) for part in command))
    result = subprocess.run(command, cwd=ROOT)
    if allow_update_exit and result.returncode in (0, 2):
        return result.returncode
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    return result.returncode


def main():
    parser = argparse.ArgumentParser(description="Update F1 data and refresh live feature profiles when data changed.")
    parser.add_argument("--season", type=int)
    parser.add_argument("--with-fastf1", action="store_true")
    parser.add_argument("--force-train", action="store_true")
    args = parser.parse_args()

    update_command = [sys.executable, "scripts/update_f1_data.py"]
    if args.season:
        update_command.extend(["--season", str(args.season)])
    if args.with_fastf1:
        update_command.append("--with-fastf1")

    update_status = run(update_command, allow_update_exit=True)
    data_changed = update_status == 2

    if not data_changed and not args.force_train:
        print("No data changes detected; skipping feature search.")
        return 0

    if not LIVE_SUMMARY.exists():
        raise SystemExit(f"Missing live feature summary seed: {LIVE_SUMMARY}")

    run(
        [
            sys.executable,
            "scripts/feature_search_multi_objective.py",
            "--strategy",
            "neighbors",
            "--seed-summary",
            str(LIVE_SUMMARY),
            "--output",
            str(LIVE_SUMMARY),
        ]
    )

    env_file = os.environ.get("GITHUB_ENV")
    if env_file:
        with open(env_file, "a") as f:
            f.write("F1_AUTO_UPDATE_CHANGED=true\n")

    print("Auto update complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
