"""
Descarga logos desde tv-logo/tv-logos (GitHub raw — sin rate limit).

1. Lista el repo via GitHub API tree
2. Hace match por nombre normalizado contra los slugs locales
3. Descarga las imágenes a frontend/public/logos/{slug}.png
"""
from __future__ import annotations

import re
import sys
import time
import unicodedata
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.services.logos import LOGO_URLS  # noqa: E402  (solo para tomar la lista de slugs)
from scripts.seed import _channels_for  # noqa: E402

OUTPUT_DIR = ROOT / "frontend" / "public" / "logos"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

REPO = "tv-logo/tv-logos"
TREE_API = f"https://api.github.com/repos/{REPO}/git/trees/main?recursive=1"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/main/"

UA = "LocalTv/1.0 (FofoStudio Edition; https://github.com/FofoStudio)"
HEADERS = {"User-Agent": UA, "Accept": "image/*"}


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"\b(hd|sd|4k|fhd|uhd)\b", "", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def list_repo_files() -> list[str]:
    print("Listando repo tv-logo/tv-logos...")
    r = httpx.get(TREE_API, headers={"User-Agent": UA}, timeout=30.0)
    r.raise_for_status()
    data = r.json()
    files = [
        f["path"]
        for f in data["tree"]
        if f["type"] == "blob" and f["path"].lower().endswith(".png")
        and f["path"].startswith("countries/")
    ]
    print(f"  {len(files)} archivos PNG encontrados")
    return files


def find_best_match(slug: str, name: str, files: list[str]) -> str | None:
    """
    Match heurístico:
    - Normalize slug y name
    - Buscar archivos cuyo basename normalizado contenga el slug normalizado
    - Preferir matches más cortos / más específicos
    """
    target_slug = normalize(slug)
    target_name = normalize(name)
    targets = [t for t in (target_slug, target_name) if t]

    best = None
    best_score = 0
    for path in files:
        # path: "countries/argentina/espn-ar.png"
        basename = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        bn = normalize(basename)
        for t in targets:
            if not t:
                continue
            if bn == t:
                return path  # match exacto, ganamos
            if bn.startswith(t + "ar") or bn.startswith(t + "us") or bn.startswith(t + "mx") or bn.startswith(t + "br") or bn.startswith(t + "es") or bn.startswith(t + "uy") or bn.startswith(t + "co") or bn.startswith(t + "pe") or bn.startswith(t + "cl"):
                # match con sufijo de país (ej. espn-ar = espn + ar)
                score = 100 - len(bn)
                if score > best_score:
                    best_score = score
                    best = path
            elif bn == t + "tv" or bn.startswith(t):
                score = 50 - len(bn)
                if score > best_score:
                    best_score = score
                    best = path
    return best


def download(url: str) -> bytes | None:
    try:
        r = httpx.get(url, headers=HEADERS, timeout=15.0, follow_redirects=True)
        if r.status_code == 200 and r.content:
            return r.content
    except httpx.HTTPError:
        pass
    return None


def main():
    # Slugs únicos que tenemos en el seed o en LOGO_URLS
    slugs = set(LOGO_URLS.keys())
    # Also pull from seed for completeness
    fake_channels = _channels_for(category_id=1)
    slug_to_name = {ch.slug: ch.name for ch in fake_channels}
    for s in slug_to_name:
        slugs.add(s)

    files = list_repo_files()

    matched: dict[str, str] = {}
    unmatched: list[str] = []
    for slug in sorted(slugs):
        name = slug_to_name.get(slug, slug.replace("-", " "))
        path = find_best_match(slug, name, files)
        if path:
            matched[slug] = path
        else:
            unmatched.append(slug)

    print(f"\nMatched: {len(matched)} | Unmatched: {len(unmatched)}\n")

    ok = 0
    fail = []
    for i, (slug, path) in enumerate(matched.items(), 1):
        out = OUTPUT_DIR / f"{slug}.png"
        if out.exists() and out.stat().st_size > 100:
            print(f"[{i:3}/{len(matched)}] {slug:30} (cached)")
            ok += 1
            continue
        url = RAW_BASE + path
        data = download(url)
        if data:
            out.write_bytes(data)
            print(f"[{i:3}/{len(matched)}] {slug:30} OK  ({len(data):>6}b) <- {path}")
            ok += 1
        else:
            print(f"[{i:3}/{len(matched)}] {slug:30} FAIL <- {url}")
            fail.append(slug)
        time.sleep(0.05)  # rate-limit suave (raw.githubusercontent permite mucho)

    print()
    print(f"Total slugs: {len(slugs)}")
    print(f"Matched:     {len(matched)}")
    print(f"Downloaded:  {ok}")
    print(f"Failed:      {len(fail)}")
    print(f"Unmatched:   {len(unmatched)}")
    if unmatched[:30]:
        print(f"\nSlugs sin match en el repo:\n  {', '.join(unmatched[:30])}")


if __name__ == "__main__":
    main()
