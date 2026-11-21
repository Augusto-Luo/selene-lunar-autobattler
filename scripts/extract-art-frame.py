from pathlib import Path
import sys
import numpy as np
from PIL import Image

source = Path(sys.argv[1])
target = Path(sys.argv[2])
wanted_row = int(sys.argv[3])
wanted_col = int(sys.argv[4])


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    padded = np.pad(mask.astype(np.int8), (1, 1))
    changes = np.diff(padded)
    starts = np.flatnonzero(changes == 1)
    ends = np.flatnonzero(changes == -1)
    return list(zip(starts.tolist(), ends.tolist()))


with Image.open(source) as image:
    pixels = np.asarray(image.convert("RGB"))
    dark = pixels.mean(axis=2) < 110
    columns = runs(dark.mean(axis=0) > 0.45)
    rows = runs(dark.mean(axis=1) > 0.45)
    if len(columns) != 4 or len(rows) != 4:
        raise RuntimeError(f"Expected a 4x4 contact sheet, found {len(rows)} rows and {len(columns)} columns")
    x0, x1 = columns[wanted_col]
    y0, y1 = rows[wanted_row]
    frame = image.crop((x0, y0, x1, y1))
    target.parent.mkdir(parents=True, exist_ok=True)
    frame.save(target, "PNG", optimize=True)
    print(f"{target}: {frame.width}x{frame.height}, row={wanted_row}, col={wanted_col}")
