from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1])
target = Path(sys.argv[2])
max_width = int(sys.argv[3]) if len(sys.argv) > 3 else 2400

with Image.open(source) as image:
    image = image.convert("RGB")
    if image.width > max_width:
        height = round(image.height * max_width / image.width)
        image = image.resize((max_width, height), Image.Resampling.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "JPEG", quality=86, optimize=True)
    print(f"{target}: {image.width}x{image.height}, {target.stat().st_size} bytes")
