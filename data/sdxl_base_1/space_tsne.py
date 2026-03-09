import pandas as pd
import numpy as np

# === PATHS ===
IN_CSV  = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\tsne.csv"
OUT_CSV = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\tsne_spaced.csv"

# === TUNING ===
# Quanto "lontane" devono stare le immagini, in unità del layout.
# Se ancora si sovrappongono: aumenta (es. 1.2 / 1.5)
# Se è troppo sparso: diminuisci (es. 0.6 / 0.8)
MIN_DIST = 1.0

# Quante celle di ricerca massimo per trovare posto libero (non toccare di solito)
SPIRAL_RADIUS = 80


def spiral_offsets(rmax: int):
    """Generate (dx,dy) offsets in an expanding square spiral."""
    yield (0, 0)
    for r in range(1, rmax + 1):
        for dx in range(-r, r + 1):
            yield (dx, -r)
            yield (dx, r)
        for dy in range(-r + 1, r):
            yield (-r, dy)
            yield (r, dy)


def main():
    df = pd.read_csv(IN_CSV)

    if not set(["id", "x", "y"]).issubset(df.columns):
        raise ValueError("tsne.csv must contain columns: id,x,y")

    x = df["x"].to_numpy(dtype=float)
    y = df["y"].to_numpy(dtype=float)

    # 1) Normalize (center + scale) to make spacing predictable
    x = (x - np.mean(x)) / (np.std(x) + 1e-9)
    y = (y - np.mean(y)) / (np.std(y) + 1e-9)

    # 2) Convert to grid coords
    cell = float(MIN_DIST)
    gx = np.round(x / cell).astype(int)
    gy = np.round(y / cell).astype(int)

    occupied = set()
    out_gx = np.empty_like(gx)
    out_gy = np.empty_like(gy)

    offsets = list(spiral_offsets(SPIRAL_RADIUS))

    # Optional: place denser areas first (helps preserve local structure)
    # Sort by distance from center (you can comment this out if you want)
    order = np.argsort(np.hypot(gx, gy))

    for idx in order:
        base = (gx[idx], gy[idx])
        placed = None
        for dx, dy in offsets:
            cand = (base[0] + dx, base[1] + dy)
            if cand not in occupied:
                placed = cand
                occupied.add(cand)
                break
        if placed is None:
            placed = base  # unlikely, but safe fallback
        out_gx[idx], out_gy[idx] = placed

    # 3) Back to continuous coords
    df["x"] = out_gx * cell
    df["y"] = out_gy * cell

    df.to_csv(OUT_CSV, index=False)
    print("Wrote:", OUT_CSV)
    print("Tip: if it's still overlapping, increase MIN_DIST (e.g., 1.2 or 1.5).")


if __name__ == "__main__":
    main()
