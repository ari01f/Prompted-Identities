import pandas as pd
import numpy as np

IN_CSV  = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\tsne.csv"
OUT_CSV = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\tsne_packed.csv"

# TUNING (valori pratici per 2000 tiles)


TILE = 1.05
REPULSE = 0.18
ITERS = 600        
PULL = 0.025
SNAP = TILE * 0.7
JITTER = TILE * 0.2
USE_DISK = False


def main():
    df = pd.read_csv(IN_CSV)
    if not {"id","x","y"}.issubset(df.columns):
        raise ValueError("Input must have columns: id,x,y")

    X = df[["x","y"]].to_numpy(dtype=float)

    # 1) Normalize (center + scale) so parameters behave consistently
    X -= X.mean(axis=0, keepdims=True)
    X /= (X.std(axis=0, keepdims=True) + 1e-9)

    # Keep a copy as "anchor" positions (original embedding)
    A = X.copy()

    # 2) Simple continuous collision solver
    # Grid hashing for speed
    cell = TILE
    for t in range(ITERS):
        # build hash grid
        gx = np.floor(X[:,0] / cell).astype(int)
        gy = np.floor(X[:,1] / cell).astype(int)
        buckets = {}
        for i in range(len(X)):
            key = (gx[i], gy[i])
            buckets.setdefault(key, []).append(i)

        disp = np.zeros_like(X)

        # check neighbors in 3x3 cells
        for (cx, cy), idxs in buckets.items():
            neigh_cells = [(cx+dx, cy+dy) for dx in (-1,0,1) for dy in (-1,0,1)]
            candidates = []
            for nc in neigh_cells:
                candidates.extend(buckets.get(nc, []))
            if not candidates:
                continue

            # resolve overlaps among idxs vs candidates
            for i in idxs:
                xi = X[i]
                for j in candidates:
                    if j <= i:
                        continue
                    xj = X[j]
                    d = xj - xi
                    dist2 = d[0]*d[0] + d[1]*d[1]
                    if dist2 < 1e-12:
                        # random nudge if identical
                        r = (np.random.rand(2) - 0.5) * 1e-2
                        disp[i] -= r
                        disp[j] += r
                        continue

                    dist = np.sqrt(dist2)
                    if dist < TILE:
                        # overlap amount
                        push = (TILE - dist) / dist
                        v = d * push * REPULSE
                        disp[i] -= v * 0.5
                        disp[j] += v * 0.5

        # pull back towards anchor (preserve structure)
        disp += (A - X) * PULL

        # update with damping
        X += disp * 0.5

        # optional disk disabled for cloud layout
        pass


    # --- soft grid snap (cloud grid effect) ---
    SNAP = TILE * 0.65
    JITTER = TILE * 0.18

    X_snap = np.round(X / SNAP) * SNAP
    X = 0.72 * X + 0.28 * X_snap
    X += (np.random.rand(*X.shape) - 0.5) * JITTER


            

    df["x"] = X[:,0]
    df["y"] = X[:,1]
    df.to_csv(OUT_CSV, index=False)
    print("Wrote:", OUT_CSV)

if __name__ == "__main__":
    main()
