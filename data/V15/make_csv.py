# make_vikus_csv.py
# Uso:
#   python make_vikus_csv.py input.csv output.csv
#
# Legge un file "wide" (profession, filename, id, year, model, age, gender, race, emotion, features...)
# e produce il CSV nel formato atteso dal viewer:
# keywords,filename,id,year,_image_url,_model,_age,_gender,_dominant_race,_dominant_emotion,...

import sys
import re
import csv
import pandas as pd

# ---- CONFIG: cambia questi valori ----
HF_BASE = "https://huggingface.co/datasets/Arifacc12345/ai-image-bias-images/resolve/main"
IMAGES_ROOT = "images_small"    # oppure "images"
VERSION = "V15"                # es. "sdxl_base_1" oppure "V15"
# -------------------------------------

OUT_COLS = [
    "keywords", "filename", "id", "year", "_image_url", "_model", "_age", "_gender",
    "_dominant_race", "_dominant_emotion",
    "_glasses", "_tie", "_book", "_laptop", "_phone", "_chair", "_table", "_bag", "_watch", "_uniform",
    "_pen", "_desk", "_gloves", "_apron", "_monitor", "_clipboard", "_profession"
]

# Colonne attese in input (posizionali) in base alle righe che mi hai mandato
IN_COLS = [
    "_profession",
    "filename",
    "id",
    "year",
    "_model",
    "_age",
    "_gender",
    "_dominant_race",
    "_dominant_emotion",
    "_glasses",
    "_tie",
    "_book",
    "_laptop",
    "_phone",
    "_chair",
    "_table",
    "_bag",
    "_watch",
    "_uniform",
    "_pen",
    "_desk",
    "_gloves",
    "_apron",
    "_monitor",
    "_clipboard",
]

def norm_keyword_value(x) -> str:
    if x is None:
        return ""
    s = str(x).strip().lower()
    s = re.sub(r"\s+", "_", s)   # spazi -> underscore
    s = s.replace("/", "_")
    return s

def norm_gender(x) -> str:
    s = norm_keyword_value(x)
    if s in ("man", "male"):
        return "man"
    if s in ("woman", "female"):
        return "woman"
    return s

def build_image_url(prof: str, filename: str) -> str:
    prof = str(prof).strip()
    filename = str(filename).strip()
    return f"{HF_BASE}/{IMAGES_ROOT}/{VERSION}/{prof}/{filename}"

def sniff_delimiter(path: str) -> str:
    # prova a capire il separatore (TAB, ;, ,)
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        sample = f.read(8192)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t", "|"])
        return dialect.delimiter
    except Exception:
        # fallback: se contiene tab -> tab, altrimenti ; se molto comune, altrimenti ,
        if "\t" in sample:
            return "\t"
        if sample.count(";") > sample.count(","):
            return ";"
        return ","

def read_input(path: str) -> pd.DataFrame:
    delim = sniff_delimiter(path)

    # header=None perché spesso il file è senza header (solo righe dati)
    df = pd.read_csv(path, sep=delim, header=None, dtype=str, engine="python")

    # Se per qualche motivo è 1 colonna (es. spazi), prova con whitespace
    if df.shape[1] == 1:
        df = pd.read_csv(path, delim_whitespace=True, header=None, dtype=str, engine="python")

    # Drop colonne tutte vuote
    df = df.dropna(axis=1, how="all")

    return df

def main():
    if len(sys.argv) < 3:
        print("Uso: python make_vikus_csv.py input.csv output.csv")
        sys.exit(1)

    in_path = sys.argv[1]
    out_path = sys.argv[2]

    df = read_input(in_path)

    if df.shape[1] < len(IN_COLS):
        raise ValueError(
            f"Il file ha {df.shape[1]} colonne utili ma ne servono almeno {len(IN_COLS)}.\n"
            f"Probabile separatore sbagliato o file non realmente CSV. Apri data.csv e verifica se usa ; oppure TAB."
        )

    # Tieni solo le prime N colonne che ci interessano (eventuali extra finali vengono ignorate)
    df = df.iloc[:, :len(IN_COLS)]
    df.columns = IN_COLS

    # strip su tutto
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()

    # keywords
    df["keywords"] = (
        "gender:" + df["_gender"].apply(norm_gender)
        + ",race:" + df["_dominant_race"].apply(norm_keyword_value)
        + ",emotion:" + df["_dominant_emotion"].apply(norm_keyword_value)
    )

    # image url
    df["_image_url"] = df.apply(lambda r: build_image_url(r["_profession"], r["filename"]), axis=1)

    # assicurati che tutte le colonne output esistano
    for c in OUT_COLS:
        if c not in df.columns:
            df[c] = ""

    out_df = df[OUT_COLS].copy()
    out_df.to_csv(out_path, index=False)

    print(f"OK: scritto {out_path} con {len(out_df)} righe.")
    print(f"Separatore rilevato: {sniff_delimiter(in_path)!r}")

if __name__ == "__main__":
    main()