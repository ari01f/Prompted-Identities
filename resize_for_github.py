from PIL import Image
import os

folders = [
    r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\sdxl_base_1\object_detection",
    r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\V15\object_detection",
]

valid_ext = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff")
max_size = (180, 180)

processed = 0
errors = 0

for folder in folders:
    print(f"\n--- Cartella: {folder} ---")
    for filename in os.listdir(folder):
        if not filename.lower().endswith(valid_ext):
            continue

        path = os.path.join(folder, filename)

        try:
            with Image.open(path) as img:
                original_size = img.size
                img.thumbnail(max_size, Image.Resampling.LANCZOS)

                ext = os.path.splitext(filename)[1].lower()
                save_kwargs = {}

                if ext in (".jpg", ".jpeg"):
                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                    save_kwargs["quality"] = 78
                    save_kwargs["optimize"] = True
                elif ext == ".png":
                    save_kwargs["optimize"] = True
                elif ext == ".webp":
                    save_kwargs["quality"] = 78

                img.save(path, **save_kwargs)
                print(f"OK {filename}: {original_size} -> {img.size}")
                processed += 1

        except Exception as e:
            print(f"ERRORE {filename}: {e}")
            errors += 1

print("\n--- RISULTATO ---")
print(f"File elaborati: {processed}")
print(f"Errori: {errors}")