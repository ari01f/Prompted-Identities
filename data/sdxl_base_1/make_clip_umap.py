import os
import pandas as pd
import numpy as np
from PIL import Image
import torch
import clip
import umap

IMAGE_DIR = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\128"
OUT_CSV = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\umap_clip.csv"

device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

ids = []
features = []

files = [f for f in os.listdir(IMAGE_DIR) if f.endswith(".png")]

for f in files:
    path = os.path.join(IMAGE_DIR, f)
    image = preprocess(Image.open(path)).unsqueeze(0).to(device)

    with torch.no_grad():
        feat = model.encode_image(image)

    feat = feat.cpu().numpy()[0]
    feat = feat / np.linalg.norm(feat)

    features.append(feat)
    ids.append(os.path.splitext(f)[0])

features = np.array(features)

reducer = umap.UMAP(
    n_neighbors=15,
    min_dist=0.08,
    metric="cosine"
)

embedding = reducer.fit_transform(features)

df = pd.DataFrame({
    "id": ids,
    "x": embedding[:,0],
    "y": embedding[:,1]
})

df.to_csv(OUT_CSV, index=False)

print("Saved:", OUT_CSV)
