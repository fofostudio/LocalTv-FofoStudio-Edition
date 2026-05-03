"""
Genera los iconos de LocalTv programaticamente con Pillow.

Salidas (todas en installer/):
- icon.ico  (Windows · multitamaño)
- icon.png  (1024x1024 · usado como iconphoto en Tk Linux/macOS)
- icon.icns (macOS · solo si Pillow soporta ICNS o si iconutil está disponible)

Diseño: gradiente rojo + punto LIVE blanco (matching el branding del header).

Uso:
    pip install pillow
    python installer/make_icon.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).parent
ICO_PATH = OUT_DIR / "icon.ico"
PNG_PATH = OUT_DIR / "icon.png"
ICNS_PATH = OUT_DIR / "icon.icns"

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]
RED = (229, 9, 20)
WHITE = (255, 255, 255)


def make_layer(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    radius = int(size * 0.22)
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base_draw = ImageDraw.Draw(base)
    base_draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=RED)

    # Gradient overlay (top-left brighter, bottom-right darker)
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(grad)
    for i in range(size):
        alpha = int((i / size) * 80)
        grad_draw.line([(0, i), (size, i)], fill=(0, 0, 0, alpha))

    base = Image.alpha_composite(base, grad)
    img = Image.alpha_composite(img, base)
    draw = ImageDraw.Draw(img)

    # Punto blanco "LIVE" en el centro con halo
    dot_radius = max(2, int(size * 0.13))
    cx, cy = size // 2, size // 2
    halo_radius = int(dot_radius * 1.8)
    halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    for r in range(halo_radius, dot_radius, -1):
        alpha = int(30 * (1 - (r - dot_radius) / max(1, halo_radius - dot_radius)))
        halo_draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, alpha))
    img = Image.alpha_composite(img, halo)
    draw = ImageDraw.Draw(img)
    draw.ellipse(
        (cx - dot_radius, cy - dot_radius, cx + dot_radius, cy + dot_radius),
        fill=WHITE,
    )

    return img


def write_ico() -> None:
    layers = [make_layer(s) for s in ICO_SIZES]
    layers[0].save(
        ICO_PATH,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=layers[1:],
    )
    print(f"[OK] {ICO_PATH.name} ({len(ICO_SIZES)} tamaños)")


def write_png() -> None:
    make_layer(1024).save(PNG_PATH, format="PNG")
    print(f"[OK] {PNG_PATH.name} (1024x1024)")


def write_icns_via_iconutil() -> bool:
    """En macOS, usar iconutil (apple) para producir un .icns nativo."""
    if sys.platform != "darwin" or not shutil.which("iconutil"):
        return False
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "LocalTv.iconset"
        iconset.mkdir()
        # Apple iconset naming: icon_{size}x{size}.png + icon_{size}x{size}@2x.png
        pairs = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
            (1024, "icon_512x512@2x.png"),
        ]
        for size, name in pairs:
            make_layer(size).save(iconset / name, format="PNG")
        result = subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(ICNS_PATH)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"[!] iconutil falló: {result.stderr.strip()}")
            return False
    print(f"[OK] {ICNS_PATH.name} (vía iconutil)")
    return True


def write_icns_via_pillow() -> bool:
    """Fallback: pedirle a Pillow que escriba el .icns. Solo funciona en algunas
    versiones — si falla devolvemos False."""
    try:
        layers = [make_layer(s) for s in ICNS_SIZES]
        layers[-1].save(
            ICNS_PATH,
            format="ICNS",
            append_images=layers[:-1],
        )
        print(f"[OK] {ICNS_PATH.name} (vía Pillow)")
        return True
    except Exception as e:
        print(f"[!] Pillow no pudo escribir ICNS: {e}")
        return False


def main() -> None:
    write_ico()
    write_png()
    if not write_icns_via_iconutil():
        write_icns_via_pillow()


if __name__ == "__main__":
    main()
