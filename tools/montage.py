# Combine PNGs into a grid: python3 tools/montage.py out.png cols a.png b.png ...
import sys
from PIL import Image
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
M = Image.new('RGB', (w * cols, h * rows), (0, 0, 0))
for i, im in enumerate(ims): M.paste(im, ((i % cols) * w, (i // cols) * h))
M.save(out)
