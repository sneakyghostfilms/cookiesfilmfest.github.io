"""Crop each item's photo frame from a catalog PDF into a small WebP for the local demo.

Usage: python3 -I crop_thumbs.py CATALOG.pdf PLAN.json OUT_DIR

PLAN.json maps item keys to {"page": N, "box": [x0, top, x1, bottom]} in pdfplumber's
top-down points. Prints {"key": [width, height], ...} as JSON.

The output directory must be inside the repository, ignored by git and outside public/
and src/: the thumbnails are vendor photos and must never be committed or published.
The check runs before pdfplumber and Pillow are imported.
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
THUMB_WIDTH = 320
MAX_DPI = 300


def private_output_problem(directory):
    resolved = Path(directory).resolve()
    if not resolved.is_relative_to(REPO_ROOT):
        return f"{resolved} is outside the repository"
    for published in ("public", "src"):
        if resolved.is_relative_to(REPO_ROOT / published):
            return f"{resolved} is under {published}/"
    probe = resolved / "probe.webp"
    check = subprocess.run(["git", "-C", str(REPO_ROOT), "check-ignore", "-q", str(probe)], check=False)
    if check.returncode != 0:
        return f"git does not ignore {resolved}"
    return None


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    pdf_path, plan_path, out_dir = sys.argv[1:4]
    problem = private_output_problem(out_dir)
    if problem:
        sys.exit(f"Refusing to write vendor photos: {problem}")

    import pdfplumber
    from PIL import Image

    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    pages = {}
    for key, entry in plan.items():
        pages.setdefault(entry["page"], []).append((key, entry["box"]))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    sizes = {}
    with pdfplumber.open(pdf_path) as pdf:
        for number, crops in sorted(pages.items()):
            narrowest = min(box[2] - box[0] for _, box in crops)
            dpi = min(MAX_DPI, max(72, 72 * THUMB_WIDTH / narrowest))
            scale = dpi / 72
            rendered = pdf.pages[number - 1].to_image(resolution=dpi).original.convert("RGB")
            for key, (x0, top, x1, bottom) in crops:
                frame = rendered.crop((round(x0 * scale), round(top * scale), round(x1 * scale), round(bottom * scale)))
                if frame.width > THUMB_WIDTH:
                    frame = frame.resize((THUMB_WIDTH, round(frame.height * THUMB_WIDTH / frame.width)), Image.LANCZOS)
                frame.save(out / f"{key}.webp", "WEBP", quality=80, method=6)
                sizes[key] = [frame.width, frame.height]
    json.dump(sizes, sys.stdout)


if __name__ == "__main__":
    main()
