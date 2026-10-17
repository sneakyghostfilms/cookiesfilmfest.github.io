"""Extract item cards from a Canva-built prop rental catalog PDF.

Each card is a pink photo frame holding the vendor's printed item number,
with a cream caption pill directly below it. Section divider pages carry one
large title. The PDF is only read; results are printed to stdout as JSON.

Usage: python3 -I extract_catalog.py CATALOG.pdf [--pages 5,20] [--sheets-dir DIR]
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[2]
FRAME_COLOR = (1.0, 0.4, 0.7686)
PILL_COLOR = (0.9725, 0.9686, 0.949)
ID_PATTERN = re.compile(r"^\[?(\d{3})\]?$")
MIN_FRAME_SIDE = 60
MIN_PILL_WIDTH = 40
PILL_HEIGHTS = (12, 90)
PILL_GAPS = (-30, 45)
MAX_PILL_OFFSET = 45
MAX_LINE_OFFSET_RATIO = 0.25
SECTION_TITLE_SIZE = 60
ROW_TOLERANCE = 30
BARE_ID_DEPTH = 30
SHEET_RESOLUTION = 100


def color_matches(color, target, tolerance=0.02):
    return (isinstance(color, (tuple, list)) and len(color) == 3
            and all(abs(a - b) <= tolerance for a, b in zip(color, target)))


def center_x(box):
    return (box["x0"] + box["x1"]) / 2


def center_y(box):
    return (box["top"] + box["bottom"]) / 2


def holds(outer, inner, pad=0.0):
    return (outer["x0"] - pad <= center_x(inner) <= outer["x1"] + pad
            and outer["top"] - pad <= center_y(inner) <= outer["bottom"] + pad)


def area(box):
    return (box["x1"] - box["x0"]) * (box["bottom"] - box["top"])


def overlap(a, b):
    width = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    height = min(a["bottom"], b["bottom"]) - max(a["top"], b["top"])
    return max(width, 0) * max(height, 0)


def find_shapes(page, color, accept):
    boxes = []
    for shape in list(page.curves) + list(page.rects):
        width = shape["x1"] - shape["x0"]
        height = shape["bottom"] - shape["top"]
        if not (color_matches(shape.get("non_stroking_color"), color) and accept(width, height)):
            continue
        box = {key: shape[key] for key in ("x0", "top", "x1", "bottom")}
        if not any(all(abs(box[key] - other[key]) < 2 for key in box) for other in boxes):
            boxes.append(box)
    return boxes


def group_lines(words):
    lines = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0]["top"] - word["top"]) <= 3:
            lines[-1].append(word)
        else:
            lines.append([word])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def attach_pills(frames, pills):
    used = set()
    for frame in frames:
        frame["pill"] = None
        candidates = []
        for index, pill in enumerate(pills):
            gap = pill["top"] - frame["bottom"]
            offset = abs(center_x(pill) - center_x(frame))
            if index not in used and PILL_GAPS[0] <= gap <= PILL_GAPS[1] and offset <= MAX_PILL_OFFSET:
                candidates.append((abs(gap) + offset, index))
        if candidates:
            chosen = min(candidates)[1]
            used.add(chosen)
            frame["pill"] = pills[chosen]
    return used


def read_caption(pill, words):
    kept, dropped = [], []
    width = pill["x1"] - pill["x0"]
    for line in group_lines([w for w in words if holds(pill, w, 1)]):
        text = " ".join(w["text"] for w in line)
        line_center = (line[0]["x0"] + line[-1]["x1"]) / 2
        if abs(line_center - center_x(pill)) > MAX_LINE_OFFSET_RATIO * width:
            dropped.append(text)
        else:
            kept.append(text)
    return kept, dropped


def reading_order(frames):
    rows = []
    for frame in sorted(frames, key=lambda f: f["top"]):
        if rows and frame["top"] - rows[-1][0]["top"] <= ROW_TOLERANCE:
            rows[-1].append(frame)
        else:
            rows.append([frame])
    return [frame for row in rows for frame in sorted(row, key=lambda f: f["x0"])]


def read_page(page):
    words = page.extract_words(extra_attrs=["size"])
    frames = find_shapes(page, FRAME_COLOR, lambda w, h: w >= MIN_FRAME_SIDE and h >= MIN_FRAME_SIDE)
    pills = find_shapes(page, PILL_COLOR, lambda w, h: w >= MIN_PILL_WIDTH and PILL_HEIGHTS[0] <= h <= PILL_HEIGHTS[1])
    for frame in frames:
        frame["ids"] = []
        frame["images"] = sum(1 for image in page.images if overlap(frame, image) >= 0.5 * area(frame))
    claimed = set()
    for word in words:
        holders = [frame for frame in frames if holds(frame, word, 4)]
        if not (ID_PATTERN.match(word["text"]) and holders):
            continue
        frame = min(holders, key=area)
        if "[" in word["text"] or "]" in word["text"] or center_y(word) - frame["top"] <= BARE_ID_DEPTH:
            frame["ids"].append(word)
            claimed.add(id(word))
    used = attach_pills(frames, pills)
    caption_words = [w for w in words if id(w) not in claimed]
    bracketed = [w for w in words if ID_PATTERN.match(w["text"]) and ("[" in w["text"] or "]" in w["text"])]
    cards = []
    for frame in reading_order(frames):
        lines, dropped = read_caption(frame["pill"], caption_words) if frame["pill"] else ([], [])
        frame["lines"] = lines
        if not frame["ids"] and not lines:
            continue
        cards.append({
            "printedIds": [w["text"] for w in sorted(frame["ids"], key=lambda w: w["x0"])],
            "captionLines": lines,
            "droppedLines": dropped,
            "imageCount": frame["images"],
            "hasPill": frame["pill"] is not None,
        })
    big_words = [w for w in words if w["size"] >= SECTION_TITLE_SIZE]
    title = " ".join(" ".join(w["text"] for w in line) for line in group_lines(big_words))
    return {
        "frames": frames,
        "cards": cards,
        "section": title if title and not frames else None,
        "idTokens": len(bracketed),
        "framedIdTokens": sum(1 for w in bracketed if id(w) in claimed),
        "bareFramedIds": [w["text"] for frame in frames for w in frame["ids"] if w["text"].isdigit()],
        "orphanPills": sum(1 for index, pill in enumerate(pills)
                           if index not in used and any(holds(pill, w, 1) for w in caption_words)),
    }


def draw_sheet(page, number, frames, directory):
    image = page.to_image(resolution=SHEET_RESOLUTION)
    labelled = [frame for frame in reading_order(frames) if frame["ids"] or frame["lines"]]
    for index, frame in enumerate(labelled, start=1):
        image.draw_rect(frame, stroke=(0, 140, 255), stroke_width=3, fill=None)
        if frame["pill"]:
            image.draw_rect(frame["pill"], stroke=(0, 170, 0), stroke_width=2, fill=None)
        ids = " ".join(w["text"] for w in sorted(frame["ids"], key=lambda w: w["x0"])) or "(no id)"
        label = f"{index}: {ids} {' / '.join(frame['lines'])}"
        x = frame["x0"] * image.scale
        y = max(frame["top"] * image.scale - 14, 0)
        image.draw.rectangle((x, y, x + 6.5 * len(label), y + 13), fill=(255, 255, 255))
        image.draw.text((x + 2, y), label, fill=(0, 0, 0))
    image.save(directory / f"page-{number:02d}.png")


def main():
    parser = argparse.ArgumentParser(description="Extract item cards from a prop catalog PDF.")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--pages", help="comma-separated page numbers to extract")
    parser.add_argument("--sheets-dir", type=Path, help="directory outside the repo for verification overlays")
    args = parser.parse_args()
    if args.sheets_dir and args.sheets_dir.resolve().is_relative_to(REPO_ROOT):
        sys.exit("--sheets-dir must be outside the repository: the overlays contain vendor photos")
    wanted = {int(page) for page in args.pages.split(",")} if args.pages else None
    checks = dict.fromkeys(["idTokens", "framedIdTokens", "orphanPills", "cardsWithoutPill",
                            "cardsWithoutImage", "droppedLines"], 0)
    checks["bareFramedIds"] = []
    output = {"pageCount": 0, "sections": [], "cards": [], "checks": checks}
    with pdfplumber.open(args.pdf) as pdf:
        output["pageCount"] = len(pdf.pages)
        for number, page in enumerate(pdf.pages, start=1):
            result = read_page(page)
            if result["section"]:
                output["sections"].append({"page": number, "title": result["section"]})
            if wanted and number not in wanted:
                continue
            for key in ("idTokens", "framedIdTokens", "orphanPills"):
                checks[key] += result[key]
            checks["bareFramedIds"] += [f"p{number} {text}" for text in result["bareFramedIds"]]
            for card in result["cards"]:
                checks["cardsWithoutPill"] += not card.pop("hasPill")
                checks["cardsWithoutImage"] += card["imageCount"] == 0
                checks["droppedLines"] += len(card["droppedLines"])
                output["cards"].append({"page": number, **card})
            if args.sheets_dir and result["cards"]:
                args.sheets_dir.mkdir(parents=True, exist_ok=True)
                draw_sheet(page, number, result["frames"], args.sheets_dir)
    json.dump(output, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
