"""Render page 1 of each corpus PDF and simulate phone photos.

Conditions:
  clean   - 300 dpi render (a flatbed scan stand-in)
  mild    - phone photo: small tilt, soft shadow, slight blur, noise, JPEG
  harsh   - phone photo: strong perspective, hard shadow, more blur/noise, low JPEG
Phone images are then rectified with a simple page-contour detector
(what a real capture UI would do) and saved as *-rect.png.
"""

import pathlib
import sys

import cv2
import fitz
import numpy as np

ROOT = pathlib.Path(__file__).parent
CORPUS = ROOT / "corpus"
OUT = ROOT / "images"
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(7)

PRESETS = {
    "mild": dict(tilt=0.04, shadow=0.25, blur=1.2, noise=4, jpeg=85, scale=0.55),
    "harsh": dict(tilt=0.10, shadow=0.55, blur=2.2, noise=9, jpeg=60, scale=0.40),
}


def render(pdf: pathlib.Path) -> np.ndarray:
    page = fitz.open(pdf)[0]
    pix = page.get_pixmap(dpi=300, colorspace=fitz.csGRAY)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)


def photo(page: np.ndarray, p: dict) -> np.ndarray:
    h, w = page.shape
    page = cv2.resize(page, (int(w * p["scale"]), int(h * p["scale"])), interpolation=cv2.INTER_AREA)
    h, w = page.shape
    # Paper is slightly off-white; table background is darker and textured.
    paper = cv2.cvtColor((page.astype(np.float32) * 0.93 + 8).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    paper[..., 0] = np.clip(paper[..., 0].astype(int) - 10, 0, 255)  # warm light
    W, H = int(w * 1.35), int(h * 1.3)
    bg = np.full((H, W, 3), (70, 85, 100), np.uint8)
    bg = cv2.add(bg, rng.integers(0, 25, (H, W, 3), dtype=np.uint8))
    t = p["tilt"]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    ox, oy = (W - w) / 2, (H - h) / 2
    jitter = lambda: rng.uniform(-t, t)
    dst = np.float32(
        [
            [ox + jitter() * w, oy + jitter() * h],
            [ox + w + jitter() * w, oy + jitter() * h],
            [ox + w + jitter() * w, oy + h + jitter() * h],
            [ox + jitter() * w, oy + h + jitter() * h],
        ]
    )
    M = cv2.getPerspectiveTransform(src, dst)
    img = cv2.warpPerspective(paper, M, (W, H), dst=bg.copy(), borderMode=cv2.BORDER_TRANSPARENT)
    # Lighting: a linear gradient plus a soft blob shadow (hand / phone).
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    grad = 1 - p["shadow"] * 0.5 * (xx / W)
    cx, cy = rng.uniform(0.2, 0.8) * W, rng.uniform(0.5, 0.9) * H
    blob = np.exp(-(((xx - cx) / (0.25 * W)) ** 2 + ((yy - cy) / (0.2 * H)) ** 2))
    light = grad * (1 - p["shadow"] * blob)
    img = (img.astype(np.float32) * light[..., None]).clip(0, 255)
    img = cv2.GaussianBlur(img, (0, 0), p["blur"])
    img += rng.normal(0, p["noise"], img.shape)
    img = img.clip(0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, p["jpeg"]])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def rectify(img: np.ndarray) -> tuple[np.ndarray, bool]:
    """Find the largest 4-point contour (the page) and warp it flat."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(g, (5, 5), 0)
    _, th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return img, False
    c = max(cnts, key=cv2.contourArea)
    approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
    if len(approx) != 4 or cv2.contourArea(c) < 0.3 * g.size:
        return img, False
    pts = approx.reshape(4, 2).astype(np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    tl, br, tr, bl = pts[s.argmin()], pts[s.argmax()], pts[d.argmin()], pts[d.argmax()]
    wid = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    hei = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    M = cv2.getPerspectiveTransform(
        np.float32([tl, tr, br, bl]), np.float32([[0, 0], [wid, 0], [wid, hei], [0, hei]])
    )
    return cv2.warpPerspective(img, M, (wid, hei)), True


for pdf in sorted(CORPUS.glob("*.pdf")):
    name = pdf.stem
    page = render(pdf)
    cv2.imwrite(str(OUT / f"{name}-clean.png"), page)
    for cond, p in PRESETS.items():
        ph = photo(page, p)
        cv2.imwrite(str(OUT / f"{name}-{cond}-raw.jpg"), ph)
        rect, ok = rectify(ph)
        cv2.imwrite(str(OUT / f"{name}-{cond}.png"), rect)
        print(f"{name} {cond} rectified={ok} size={rect.shape[1]}x{rect.shape[0]}", file=sys.stderr)
