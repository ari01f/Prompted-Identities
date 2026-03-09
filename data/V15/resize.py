from PIL import Image
import os

folder = r"C:\Users\Arianna\Desktop\vikus-viewer-clean\vikus-viewer-clean\data\V15\object_detection"

valid_ext = (".png", ".jpg", ".jpeg", ".webp")

for filename in os.listdir(folder):
    if filename.lower().endswith(valid_ext):
        path = os.path.join(folder, filename)

        img = Image.open(path)
        img = img.resize((300, 300), Image.LANCZOS)

        img.save(path)

print("Resize completato.")