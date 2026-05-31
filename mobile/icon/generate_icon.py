"""
Genera el set completo de iconos de launcher Android para LocalTv.

Salida (en mobile/icon/<density>/):
  - ic_launcher.png            (legacy, fondo rounded-square + glyph)
  - ic_launcher_round.png      (legacy round)
  - ic_launcher_foreground.png (adaptive foreground, glyph sobre transparente)

Más un master de 512px para tiendas/referencia.

Diseño: fondo violeta-negro (#14102a) con un "play" en degradé violeta→magenta.
Coincide con el theme-color de la web (#0b0b13) y da identidad propia (no el
icono por defecto de Capacitor).

Se corre una vez y se commitean los PNGs; CI no necesita Pillow.
    py -3 mobile/icon/generate_icon.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))

BG = (20, 16, 42, 255)        # #14102a  fondo
GRAD_TOP = (139, 92, 255)     # #8b5cff  violeta
GRAD_BOT = (255, 61, 127)     # #ff3d7f  magenta
SS = 4                         # supersampling para anti-aliasing

# densidad -> (tamaño legacy 48dp, tamaño adaptive 108dp)
DENSITIES = {
    "mdpi":    (48, 108),
    "hdpi":    (72, 162),
    "xhdpi":   (96, 216),
    "xxhdpi":  (144, 324),
    "xxxhdpi": (192, 432),
}


def _gradient_triangle(S, scale, offx=0.035):
    """Triángulo 'play' relleno con degradé diagonal, sobre lienzo SxS transparente."""
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = grad.load()
    for y in range(S):
        t = y / S
        r = int(GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t)
        g = int(GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t)
        b = int(GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t)
        for x in range(S):
            px[x, y] = (r, g, b, 255)

    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    cx, cy = S / 2, S / 2
    w = S * scale
    h = S * scale * 1.15
    ox = S * offx
    pts = [(cx - w + ox, cy - h), (cx - w + ox, cy + h), (cx + w + ox, cy)]
    md.polygon(pts, fill=255)
    grad.putalpha(mask)
    return grad


def make_icon(size, mode):
    """mode: 'square' | 'round' | 'foreground'"""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if mode == "square":
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)
    elif mode == "round":
        d.ellipse([0, 0, S - 1, S - 1], fill=BG)

    # Glow suave detrás del play (da profundidad).
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gr = S * 0.30
    gd.ellipse([S/2 - gr, S/2 - gr, S/2 + gr, S/2 + gr], fill=(139, 92, 255, 60))
    img = Image.alpha_composite(img, glow)

    # El foreground adaptive debe quedar dentro de la safe-zone (~61% central),
    # así que el glyph va más chico que en el legacy (que llena el lienzo).
    scale = 0.235 if mode == "foreground" else 0.285
    tri = _gradient_triangle(S, scale)
    img = Image.alpha_composite(img, tri)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for dens, (legacy, adaptive) in DENSITIES.items():
        outdir = os.path.join(HERE, dens)
        os.makedirs(outdir, exist_ok=True)
        make_icon(legacy, "square").save(os.path.join(outdir, "ic_launcher.png"))
        make_icon(legacy, "round").save(os.path.join(outdir, "ic_launcher_round.png"))
        make_icon(adaptive, "foreground").save(os.path.join(outdir, "ic_launcher_foreground.png"))
        print(f"[icon] {dens}: ic_launcher {legacy}px, foreground {adaptive}px")

    make_icon(512, "square").save(os.path.join(HERE, "ic_launcher-512.png"))
    print("[icon] master 512px OK")


if __name__ == "__main__":
    main()
