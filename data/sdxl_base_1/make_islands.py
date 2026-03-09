import argparse
import math
import numpy as np
import pandas as pd


def normalize_xy(X: np.ndarray) -> np.ndarray:
    X = X.astype(float)
    X = X - X.mean(axis=0, keepdims=True)
    X = X / (X.std(axis=0, keepdims=True) + 1e-9)
    return X


def try_dbscan_labels(X: np.ndarray, eps: float, min_samples: int):
    """
    Returns labels (N,), where -1 is noise. Uses sklearn if available.
    """
    try:
        from sklearn.cluster import DBSCAN  # type: ignore
        labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(X)
        return labels
    except Exception:
        return None


def kmeans_numpy(X: np.ndarray, k: int, iters: int = 50, seed: int = 0) -> np.ndarray:
    """
    Simple k-means in numpy as fallback.
    Returns labels (N,).
    """
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    # init centers from random points
    centers = X[rng.choice(n, size=k, replace=False)].copy()

    labels = np.zeros(n, dtype=int)
    for _ in range(iters):
        # assign
        d2 = ((X[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = d2.argmin(axis=1)

        if np.array_equal(new_labels, labels):
            break
        labels = new_labels

        # update
        for ci in range(k):
            mask = labels == ci
            if mask.any():
                centers[ci] = X[mask].mean(axis=0)
            else:
                # re-seed empty cluster
                centers[ci] = X[rng.integers(0, n)]
    return labels


def pack_points(X: np.ndarray, tile: float, repulse: float, pull: float, iters: int) -> np.ndarray:
    """
    Collision-avoidance packing that preserves the original shape via 'pull' to anchors.
    X: (n,2) normalized-ish coords.
    tile: minimum distance between points in the same cluster.
    """
    X = X.copy()
    A = X.copy()
    cell = tile

    for _ in range(iters):
        gx = np.floor(X[:, 0] / cell).astype(int)
        gy = np.floor(X[:, 1] / cell).astype(int)
        buckets = {}
        for i in range(len(X)):
            buckets.setdefault((gx[i], gy[i]), []).append(i)

        disp = np.zeros_like(X)

        for (cx, cy), idxs in buckets.items():
            neigh_cells = [(cx + dx, cy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
            candidates = []
            for nc in neigh_cells:
                candidates.extend(buckets.get(nc, []))
            if not candidates:
                continue

            for i in idxs:
                xi = X[i]
                for j in candidates:
                    if j <= i:
                        continue
                    xj = X[j]
                    d = xj - xi
                    dist2 = float(d[0] * d[0] + d[1] * d[1])
                    if dist2 < 1e-12:
                        r = (np.random.rand(2) - 0.5) * 1e-2
                        disp[i] -= r
                        disp[j] += r
                        continue

                    dist = math.sqrt(dist2)
                    if dist < tile:
                        push = (tile - dist) / dist
                        v = d * push * repulse
                        disp[i] -= v * 0.5
                        disp[j] += v * 0.5

        # pull to anchor to preserve internal structure
        disp += (A - X) * pull
        X += disp * 0.5

    return X


def bbox(X: np.ndarray):
    mn = X.min(axis=0)
    mx = X.max(axis=0)
    return mn, mx, mx - mn


def arrange_islands(cluster_points: list[np.ndarray], island_gap: float) -> list[np.ndarray]:
    """
    Places each packed cluster on a grid so islands are separated by whitespace.
    Returns list of shifted point arrays.
    """
    # compute sizes
    sizes = []
    for pts in cluster_points:
        _, _, wh = bbox(pts)
        sizes.append(wh)

    # grid dims (roughly square)
    m = len(cluster_points)
    cols = max(1, int(math.ceil(math.sqrt(m))))
    rows = int(math.ceil(m / cols))

    # compute per-cell size based on max cluster bbox
    max_w = max(s[0] for s in sizes) + island_gap
    max_h = max(s[1] for s in sizes) + island_gap

    out = []
    for idx, pts in enumerate(cluster_points):
        r = idx // cols
        c = idx % cols

        mn, mx, wh = bbox(pts)
        # center cluster in its cell
        cell_origin = np.array([c * max_w, r * max_h], dtype=float)
        center = (mn + mx) * 0.5
        cell_center = cell_origin + np.array([max_w, max_h]) * 0.5
        shift = cell_center - center
        out.append(pts + shift)

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in_csv", required=True, help="Input CSV with columns id,x,y")
    ap.add_argument("--out_csv", required=True, help="Output CSV")
    ap.add_argument("--tile", type=float, default=1.25, help="Min distance between thumbnails (cluster-local)")
    ap.add_argument("--repulse", type=float, default=0.30, help="Repulsion strength")
    ap.add_argument("--pull", type=float, default=0.004, help="Pull back to original coords (lower = more freedom)")
    ap.add_argument("--pack_iters", type=int, default=800, help="Packing iterations per cluster")
    ap.add_argument("--island_gap", type=float, default=6.0, help="Whitespace between islands in final coords")

    # clustering controls
    ap.add_argument("--dbscan_eps", type=float, default=0.55, help="DBSCAN eps on normalized coords")
    ap.add_argument("--dbscan_min_samples", type=int, default=20, help="DBSCAN min_samples")
    ap.add_argument("--k_fallback", type=int, default=8, help="Fallback k for kmeans if DBSCAN unavailable")
    args = ap.parse_args()

    df = pd.read_csv(args.in_csv)
    if not {"id", "x", "y"}.issubset(df.columns):
        raise ValueError("Input must have columns: id,x,y")

    X0 = df[["x", "y"]].to_numpy(dtype=float)
    X = normalize_xy(X0)

    labels = try_dbscan_labels(X, eps=args.dbscan_eps, min_samples=args.dbscan_min_samples)
    if labels is None:
        # sklearn not available -> kmeans fallback
        labels = kmeans_numpy(X, k=args.k_fallback, iters=60, seed=0)

    labels = np.asarray(labels, dtype=int)

    # Treat DBSCAN noise (-1) as its own small clusters (each point = cluster) to avoid dumping into a blob
    # but keep them grouped in one "noise island" if you prefer: set NOISE_AS_SINGLE = True
    NOISE_AS_SINGLE = True

    clusters = []
    cluster_ids = []

    if (labels == -1).any() and NOISE_AS_SINGLE:
        # First, real clusters
        for lab in sorted(set(labels) - {-1}):
            idx = np.where(labels == lab)[0]
            clusters.append(idx)
            cluster_ids.append(lab)
        # Then one island for all noise
        idx = np.where(labels == -1)[0]
        clusters.append(idx)
        cluster_ids.append(-1)
    else:
        # Each label is a cluster; if -1 exists, keep it as separate “cluster”
        for lab in sorted(set(labels)):
            idx = np.where(labels == lab)[0]
            clusters.append(idx)
            cluster_ids.append(lab)

    # Pack each cluster separately
    packed_clusters = []
    for idx in clusters:
        pts = X[idx]
        pts_packed = pack_points(
            pts,
            tile=args.tile,
            repulse=args.repulse,
            pull=args.pull,
            iters=args.pack_iters,
        )
        packed_clusters.append(pts_packed)

    # Arrange clusters as islands with whitespace
    arranged = arrange_islands(packed_clusters, island_gap=args.island_gap)

    # Write back into dataframe
    X_out = np.zeros_like(X)
    for cl_idx, idx in enumerate(clusters):
        X_out[idx] = arranged[cl_idx]

    df["x_islands"] = X_out[:, 0]
    df["y_islands"] = X_out[:, 1]
    df["cluster"] = labels
    df.to_csv(args.out_csv, index=False)
    print("Wrote:", args.out_csv)
    print("Tip: in your viewer, point it to columns x_islands / y_islands (or overwrite x/y).")


if __name__ == "__main__":
    main()