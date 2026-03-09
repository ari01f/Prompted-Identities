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


VALID_EXTS = (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp")


def try_paths(paths):
    for p in paths:
        if p and os.path.isfile(p):
            return p
    return ""


def resolve_local_image_path(project_root: str, dataset_dir: str, row: pd.Series, prefer_1024: bool = True) -> str:
    """
    Cerca l'immagine in:
      <root>/<dataset_dir>/1024/<filename>
      <root>/<dataset_dir>/4096/<filename>
    e (se serve) anche dentro sottocartella professione:
      .../1024/<_profession>/<filename>
    con fallback estensioni.
    """
    filename = str(row.get("filename", "")).strip()
    profession = str(row.get("_profession", "")).strip()

    if not filename:
        return ""

    base = os.path.join(project_root, dataset_dir)
    stem, ext = os.path.splitext(filename)
    ext = ext.lower()

    # prova nomi alternativi con estensione diversa
    names = [filename]
    if ext == ".png":
        names += [stem + ".jpg", stem + ".jpeg"]
    elif ext in (".jpg", ".jpeg"):
        names += [stem + ".png"]

    folders = ["1024", "4096"] if prefer_1024 else ["4096", "1024"]

    candidates = []
    for folder in folders:
        for nm in names:
            candidates.append(os.path.join(base, folder, nm))
            if profession:
                candidates.append(os.path.join(base, folder, profession, nm))

    p = try_paths(candidates)
    if p:
        return p

    # fallback: cerca per stem con estensioni note
    for folder in folders:
        for e in VALID_EXTS:
            candidates2 = [os.path.join(base, folder, stem + e)]
            if profession:
                candidates2.append(os.path.join(base, folder, profession, stem + e))
            p2 = try_paths(candidates2)
            if p2:
                return p2

    return ""


def load_clip(device: str, model_name="ViT-B-32", pretrained="openai"):
    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
    model = model.to(device).eval()
    return model, preprocess


def compute_clip_embeddings(
    df: pd.DataFrame,
    project_root: str,
    dataset_dir: str,
    device: str,
    batch: int,
    prefer_1024: bool = True,
):
    if "id" not in df.columns or "filename" not in df.columns:
        raise ValueError("Nel CSV servono almeno: id, filename")

    paths, ids = [], []
    missing = 0

    for _, row in df.iterrows():
        p = resolve_local_image_path(project_root, dataset_dir, row, prefer_1024=prefer_1024)
        if p:
            paths.append(p)
            ids.append(str(row["id"]))
        else:
            missing += 1

    if not paths:
        raise RuntimeError(
            f"Non ho trovato immagini locali per dataset_dir='{dataset_dir}'. "
            f"Controlla che esistano {dataset_dir}/1024 o {dataset_dir}/4096 e che filename combaci."
        )

    if missing:
        print(f"[warn] righe senza immagine trovata (saltate): {missing}")

    model, preprocess = load_clip(device)

    embs = []
    with torch.no_grad():
        for i in tqdm(range(0, len(paths), batch), desc="CLIP embeddings"):
            batch_paths = paths[i:i + batch]
            imgs = []
            for bp in batch_paths:
                img = Image.open(bp).convert("RGB")
                imgs.append(preprocess(img))
            x = torch.stack(imgs).to(device)

            feat = model.encode_image(x)
            feat = feat / feat.norm(dim=-1, keepdim=True)  # cosine normalize
            embs.append(feat.detach().cpu().numpy())

    emb = np.vstack(embs).astype(np.float32)
    meta = pd.DataFrame({"id": ids})
    return emb, meta


def robust_01(v: np.ndarray, lo=2.0, hi=98.0) -> np.ndarray:
    """
    Normalizzazione 0..1 robusta:
    - clippa per percentile (riduce outlier che "svuotano" la mappa)
    - poi scala in 0..1
    """
    qlo = np.percentile(v, lo)
    qhi = np.percentile(v, hi)
    if qhi - qlo < 1e-12:
        return np.zeros_like(v, dtype=np.float32)
    vv = np.clip(v, qlo, qhi)
    return ((vv - qlo) / (qhi - qlo)).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="root progetto (contiene la cartella data/)")
    ap.add_argument("--dataset_dir", required=True, help="es: data/V15 oppure data/sdxl_base_1")
    ap.add_argument("--csv", required=True, help="es: data/V15/data.csv")
    ap.add_argument("--out", required=True, help="es: data/V15/umap.csv")

    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--prefer_1024", action="store_true", help="preferisci immagini 1024 rispetto a 4096")

    # caching embeddings (consigliato)
    ap.add_argument("--cache_emb", default="", help="es: data/V15/clip_emb.npy (se esiste, lo ricarica)")
    ap.add_argument("--cache_ids", default="", help="es: data/V15/clip_ids.csv (per coerenza con cache_emb)")

    # PCA
    ap.add_argument("--pca", type=int, default=50)

    # UMAP params (preset cloud)
    ap.add_argument("--neighbors", type=int, default=500)     # molto globale
    ap.add_argument("--min_dist", type=float, default=0.70)   # più continuo
    ap.add_argument("--metric", default="cosine")
    ap.add_argument("--seed", type=int, default=42)

    ap.add_argument("--spread", type=float, default=3.0)
    ap.add_argument("--repulsion_strength", type=float, default=0.30)

    # densMAP: a volte rende densità più uniforme (può aiutare “nuvola”)
    ap.add_argument("--densmap", action="store_true")

    # robust scaling per output 0..1
    ap.add_argument("--robust_lo", type=float, default=2.0)
    ap.add_argument("--robust_hi", type=float, default=98.0)

    args = ap.parse_args()

    project_root = os.path.abspath(args.root)
    in_csv = os.path.join(project_root, args.csv)
    out_csv = os.path.join(project_root, args.out)

    if not os.path.isfile(in_csv):
        raise FileNotFoundError(f"CSV non trovato: {in_csv}")

    df = pd.read_csv(in_csv)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print("Device:", device)

    # ---------- embeddings: cache o compute ----------
    emb = None
    meta = None

    if args.cache_emb and os.path.isfile(os.path.join(project_root, args.cache_emb)):
        emb_path = os.path.join(project_root, args.cache_emb)
        print("[cache] loading:", emb_path)
        emb = np.load(emb_path).astype(np.float32)

        if args.cache_ids and os.path.isfile(os.path.join(project_root, args.cache_ids)):
            ids_path = os.path.join(project_root, args.cache_ids)
            meta = pd.read_csv(ids_path, dtype={"id": str})
        else:
            # fallback: usa gli id dal csv (attenzione: deve essere stesso ordine del cache)
            meta = pd.DataFrame({"id": df["id"].astype(str).tolist()})
    else:
        emb, meta = compute_clip_embeddings(
            df, project_root, args.dataset_dir, device, args.batch, prefer_1024=args.prefer_1024
        )
        if args.cache_emb:
            emb_path = os.path.join(project_root, args.cache_emb)
            os.makedirs(os.path.dirname(emb_path), exist_ok=True)
            np.save(emb_path, emb)
            print("[cache] saved:", emb_path)
            if args.cache_ids:
                ids_path = os.path.join(project_root, args.cache_ids)
                os.makedirs(os.path.dirname(ids_path), exist_ok=True)
                meta.to_csv(ids_path, index=False)
                print("[cache] saved:", ids_path)

    X = emb
    if args.pca and 0 < args.pca < X.shape[1]:
        pca = PCA(n_components=args.pca, random_state=args.seed, svd_solver="randomized")
        X = pca.fit_transform(X).astype(np.float32)

    print(f"UMAP params: neighbors={args.neighbors}, min_dist={args.min_dist}, spread={args.spread}, repulsion={args.repulsion_strength}, densmap={args.densmap}")

    um = umap.UMAP(
        n_neighbors=args.neighbors,
        min_dist=args.min_dist,
        n_components=2,
        metric=args.metric,
        spread=args.spread,
        repulsion_strength=args.repulsion_strength,
        random_state=args.seed,
        densmap=args.densmap,
    )
    xy = um.fit_transform(X).astype(np.float32)

    out = meta.copy()
    out["x"] = robust_01(xy[:, 0], lo=args.robust_lo, hi=args.robust_hi)
    out["y"] = robust_01(xy[:, 1], lo=args.robust_lo, hi=args.robust_hi)

    os.makedirs(os.path.dirname(out_csv), exist_ok=True)
    out[["id", "x", "y"]].to_csv(out_csv, index=False)
    print("OK scritto:", out_csv, "righe:", len(out))


if __name__ == "__main__":
    main()