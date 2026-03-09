# fix_data_csv.py
# Usage (from the folder containing data_clean.csv):
#   python fix_data_csv.py
#
# Output:
#   data_clean_fixed.csv
#   plus a short report printed in terminal

import pandas as pd
import re
from pathlib import Path

IN_PATH = Path("data_clean.csv")
OUT_PATH = Path("data_clean_fixed.csv")

def normalize_keywords(s: str) -> str:
    if pd.isna(s):
        return ""
    s = str(s)

    # split by comma, trim, drop empties
    parts = [p.strip() for p in s.split(",")]
    parts = [p for p in parts if p]

    norm_parts = []
    for p in parts:
        p = p.lower()

        # Normalize spaces around ":" (e.g., "race : middle eastern" -> "race:middle eastern")
        p = re.sub(r"\s*:\s*", ":", p)

        # Replace any internal whitespace sequences with underscore (middle eastern -> middle_eastern)
        # Keep ":" as separator and only normalize the value side too (safe either way)
        p = re.sub(r"\s+", "_", p)

        norm_parts.append(p)

    # Remove duplicates while preserving order
    seen = set()
    out = []
    for p in norm_parts:
        if p not in seen:
            seen.add(p)
            out.append(p)

    return ",".join(out)

def normalize_id(s: str) -> str:
    if pd.isna(s):
        return ""
    return str(s).strip()

def main():
    if not IN_PATH.exists():
        raise FileNotFoundError(f"Can't find {IN_PATH.resolve()}")

    df = pd.read_csv(IN_PATH)

    # Basic required columns check
    required = {"id", "keywords", "year"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {sorted(missing)}")

    # Normalize id
    df["id"] = df["id"].apply(normalize_id)

    # Normalize year to string (trim)
    df["year"] = df["year"].astype(str).str.strip()

    # Normalize _profession if present
    if "_profession" in df.columns:
        df["_profession"] = df["_profession"].astype(str).str.strip()

    # Normalize keywords (lowercase, no spaces after commas, underscores in multiword values)
    df["keywords"] = df["keywords"].apply(normalize_keywords)

    # Drop rows with empty id (bad rows)
    before = len(df)
    df = df[df["id"].astype(str).str.len() > 0].copy()
    dropped_empty_id = before - len(df)

    # Remove duplicate IDs (keep first occurrence)
    dup_mask = df["id"].duplicated(keep="first")
    dup_ids = df.loc[dup_mask, "id"].tolist()
    dup_count = int(dup_mask.sum())
    df = df[~dup_mask].copy()

    # Write output
    df.to_csv(OUT_PATH, index=False)

    # Report
    print("Done.")
    print(f"Input rows:  {before}")
    if dropped_empty_id:
        print(f"Dropped rows with empty id: {dropped_empty_id}")
    print(f"Duplicate ids removed: {dup_count}")
    if dup_count:
        # show up to 20
        preview = dup_ids[:20]
        print("Example duplicate ids:", ", ".join(preview) + (" ..." if len(dup_ids) > 20 else ""))
    print(f"Output rows: {len(df)}")
    print(f"Wrote: {OUT_PATH.resolve()}")

if __name__ == "__main__":
    main()
