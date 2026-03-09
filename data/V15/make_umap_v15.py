import os
import argparse
import numpy as np
import pandas as pd
from PIL import Image

import torch
import open_clip
from tqdm import tqdm

from sklearn.decomposition import PCA
import umap


def resolve_local_image_path(row: pd.Series, project_root: str, prefer_1024: bool = True) -> str:
    """
    Risolve un path locale per l'immagine associata alla riga.
    Priorità:
      1) se _image_url è un path locale (non http), usa quello (relativo a project_root o assoluto)
      2) prova data/V15/1024/<filename> e data/V15/4096/<filename>
         con fallback estensioni (.png <-> .jpg/.jpeg)
    """
    filename = str(row.get("filename", "")).strip()
    img_url = str(row.get("_image_url", "")).strip()

    # 1) _image_url locale (assoluto o relativo)
    if img_url and not (img_url.startswith("http://") or img_url.startswith("https://")):
        p0 = os.path.normpath(img_url)
        if os.path.isabs(p0) and os.path.isfile(p0):
            return p0

        p1 = os.path.normpath(os.path.join(project_root, img_url.replace("/", os.sep)))
        if os.path.isfile(p1):
            return p1

    # 2) fallback su cartelle locali V15
    if not filename:
        return ""

    base_dir = os.path.join(project_root, "data", "V15")

    stem, ext = os.path.splitext(filename)
    ext = ext.lower()

    alt_names = [filename]
    if ext == ".png":
        alt_names += [stem + ".jpg", stem + ".jpeg"]
    elif ext in (".jpg", ".jpeg"):
        alt_names += [stem + ".png"]

    folders = ["1024", "4096"] if prefer_1024 else ["4096", "1024"]

    for folder in folders:
        for nm in alt_names:
            cand = os.path.join(base_dir, folder, nm)
            if os.path.isfile(cand):
                return cand

    return ""


def load_clip_model(device: str, model_name: str = "ViT-B-32", pretrained: str = "openai"):
    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
    model = model.to(device)
    model.eval()
    return model, preprocess


def compute_clip_embeddings(df: pd.DataFrame, project_root: str, device: str, batch_size: int = 64):
    if "id" not in df.columns or "filename" not in df.columns:
        raise ValueError("Nel CSV servono almeno le colonne: id, filename")

    paths, ids, professions = [], [], []
    missing = 0

    for _, row in df.iterrows():
        p = resolve_local_image_path(row, project_root, prefer_1024=True)
        if p:
            paths.append(p)
            ids.append(str(row["id"]))
            professions.append(str(row.get("_profession", "")))
        else:
            missing += 1

    if not paths:
        raise RuntimeError(
            "Non ho trovato nessuna immagine locale.\n"
            "Controlla che esistano file in data/V15/1024 o data/V15/4096 e che i filename nel CSV combacino."
        )

    if missing:
        print(f"Attenzione: {missing} righe senza immagine trovata (saltate).")

    model, preprocess = load_clip_model(device)

    embs = []
    with torch.no_grad():
        for i in tqdm(range(0, len(paths), batch_size), desc="CLIP embeddings"):
            batch_paths = paths[i:i + batch_size]
            imgs = []
            for bp in batch_paths:
                img = Image.open(bp).convert("RGB")
                imgs.append(preprocess(img))
            x = torch.stack(imgs).to(device)

            feat = model.encode_image(x)
            feat = feat / feat.norm(dim=-1, keepdim=True)  # cosine-friendly
            embs.append(feat.detach().cpu().numpy())

    emb = np.vstack(embs).astype(np.float32)
    meta = pd.DataFrame({"id": ids, "_profession": professions, "_path": paths})
    return emb, meta


def minmax_01(v: np.ndarray) -> np.ndarray:
    vmin = float(np.min(v))
    vmax = float(np.max(v))
    denom = (vmax - vmin) if (vmax - vmin) > 1e-12 else 1.0
    return (v - vmin) / denom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="data/V15/data.csv", help="CSV input (relativo alla root progetto)")
    ap.add_argument("--out", default="data/V15/umap.csv", help="CSV output (relativo alla root progetto)")
    ap.add_argument("--root", default=".", help="root del progetto (dove c'è la cartella data/)")

    ap.add_argument("--batch", type=int, default=64)

    # PCA (stabilizza e rende UMAP più “globale”)
    ap.add_argument("--pca", type=int, default=50, help="0 = disattiva PCA")
    ap.add_argument("--pca_whiten", action="store_true")

    # UMAP: default “globale” (meno isole)
    ap.add_argument("--neighbors", type=int, default=120, help="più alto = più globale")
    ap.add_argument("--min_dist", type=float, default=0.25, help="più alto = meno cluster compatti")
    ap.add_argument("--metric", default="cosine")
    ap.add_argument("--spread", type=float, default=1.0, help="aumenta lo spread globale")
    ap.add_argument("--repulsion_strength", type=float, default=1.0, help="repulsione tra punti")
    ap.add_argument("--seed", type=int, default=42)

    args = ap.parse_args()

    project_root = os.path.abspath(args.root)
    in_csv = os.path.join(project_root, args.csv)
    out_csv = os.path.join(project_root, args.out)

    if not os.path.isfile(in_csv):
        raise FileNotFoundError(f"CSV non trovato: {in_csv}")

    df = pd.read_csv(in_csv)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    emb, meta = compute_clip_embeddings(df, project_root, device=device, batch_size=args.batch)
    print(f"Immagini usate per embedding: {len(meta)}")

    X = emb
    if args.pca and args.pca > 0 and args.pca < X.shape[1]:
        print(f"PCA -> {args.pca}D (whiten={args.pca_whiten})")
        pca = PCA(n_components=args.pca, whiten=args.pca_whiten, random_state=args.seed)
        X = pca.fit_transform(X).astype(np.float32)

    print(
        f"UMAP neighbors={args.neighbors}, min_dist={args.min_dist}, metric={args.metric}, "
        f"spread={args.spread}, repulsion_strength={args.repulsion_strength}"
    )

    um = umap.UMAP(
        n_neighbors=args.neighbors,
        min_dist=args.min_dist,
        n_components=2,
        metric=args.metric,
        spread=args.spread,
        repulsion_strength=args.repulsion_strength,
        random_state=args.seed,
    )
    xy = um.fit_transform(X).astype(np.float32)

    out = meta[["id", "_profession"]].copy()
    out["x"] = xy[:, 0]
    out["y"] = xy[:, 1]

    # normalizza 0..1 (comodo per viewer)
    out["x"] = minmax_01(out["x"].to_numpy(dtype=np.float32))
    out["y"] = minmax_01(out["y"].to_numpy(dtype=np.float32))

    os.makedirs(os.path.dirname(out_csv), exist_ok=True)
    out[["id", "x", "y"]].to_csv(out_csv, index=False)
    print(f"OK scritto: {out_csv} (righe: {len(out)})")


if __name__ == "__main__":
    main()