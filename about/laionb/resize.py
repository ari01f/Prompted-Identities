from PIL import Image
import os

# Cartella da elaborare
folder = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\about\laionb"

# Estensioni supportate
valid_ext = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff")

# Dimensione massima
max_size = (200, 200)

count_processed = 0
count_skipped = 0
count_errors = 0

for filename in os.listdir(folder):
    if not filename.lower().endswith(valid_ext):
        continue

    path = os.path.join(folder, filename)

    try:
        with Image.open(path) as img:
            original_size = img.size

            # Ridimensiona mantenendo il ratio, senza superare 200x200
            img.thumbnail(max_size, Image.Resampling.LANCZOS)

            # Mantiene formato originale quando possibile
            save_kwargs = {}

            # Per JPEG bisogna gestire RGB se l'immagine ha alpha o palette
            ext = os.path.splitext(filename)[1].lower()
            if ext in (".jpg", ".jpeg") and img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
                save_kwargs["quality"] = 90
                save_kwargs["optimize"] = True

            # Per PNG/WebP puoi comunque salvare ottimizzato
            if ext == ".png":
                save_kwargs["optimize"] = True
            elif ext == ".webp":
                save_kwargs["quality"] = 90

            img.save(path, **save_kwargs)

            print(f"OK  {filename}: {original_size} -> {img.size}")
            count_processed += 1

    except Exception as e:
        print(f"ERRORE {filename}: {e}")
        count_errors += 1

print("\n--- RISULTATO ---")
print(f"File elaborati: {count_processed}")
print(f"File saltati:   {count_skipped}")
print(f"Errori:         {count_errors}")