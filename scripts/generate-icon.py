#!/usr/bin/env python3
"""Generate the Idenstr brand icon set from a single vector source.

Part of the *str suite (cohesive with Feedstr): a dark purple squircle tile with
a glowing crescent orbit and a lowercase monogram. Idenstr's own accent is a
small glowing key, for the sovereign nsec / single primary identity.

Renders: icon-512, icon-192, apple-touch-icon (180), header-logo (80),
favicon-32 PNGs, plus a multi-size favicon.ico.
"""
import io
import os
import math
import cairosvg
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
FAVICON_ICO = os.path.join(os.path.dirname(__file__), "..", "public", "favicon.ico")


def arc_path(cx, cy, r, a0_deg, a1_deg, sweep=1, large=1):
    a0 = math.radians(a0_deg)
    a1 = math.radians(a1_deg)
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    return f"M {x0:.2f} {y0:.2f} A {r} {r} 0 {large} {sweep} {x1:.2f} {y1:.2f}"


CRESCENT = arc_path(262, 268, 180, -80, 150, sweep=1, large=1)

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="32%" cy="24%" r="92%">
      <stop offset="0%" stop-color="#2e1d50"/>
      <stop offset="48%" stop-color="#140c26"/>
      <stop offset="100%" stop-color="#08050f"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7d5cc0" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="#3a2a5c" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
    <radialGradient id="topglow" cx="34%" cy="18%" r="48%">
      <stop offset="0%" stop-color="#9d7bff" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#9d7bff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cres" x1="0" y1="118" x2="0" y2="452" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#4a2f7e"/>
      <stop offset="55%" stop-color="#8a5cf0"/>
      <stop offset="100%" stop-color="#c8acff"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8f4ff"/>
      <stop offset="100%" stop-color="#e2d6fb"/>
    </linearGradient>
    <linearGradient id="key" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c9b0ff"/>
      <stop offset="100%" stop-color="#8a5cf0"/>
    </linearGradient>
    <filter id="glowS" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    <filter id="glowM" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="13"/>
    </filter>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>

  <!-- opaque backdrop: iOS apple-touch-icon must not be transparent (iOS adds its
       own rounded mask and fills any alpha with black). Matches the Feedstr suite. -->
  <rect width="512" height="512" fill="#000000"/>

  <!-- drop shadow -->
  <rect x="40" y="46" width="432" height="432" rx="108" fill="#05030d" opacity="0.7" filter="url(#shadow)"/>

  <!-- tile body -->
  <rect x="36" y="28" width="440" height="440" rx="110" fill="url(#bg)"/>
  <rect x="36" y="28" width="440" height="440" rx="110" fill="url(#topglow)"/>
  <rect x="37.5" y="29.5" width="437" height="437" rx="108.5" fill="none" stroke="url(#rim)" stroke-width="3"/>

  <!-- crescent orbit: glow then core -->
  <path d="{CRESCENT}" fill="none" stroke="#7c3cff" stroke-width="24" stroke-linecap="round" opacity="0.45" filter="url(#glowM)"/>
  <path d="{CRESCENT}" fill="none" stroke="url(#cres)" stroke-width="13" stroke-linecap="round"/>

  <!-- monogram "id" glow -->
  <g fill="#b89cff" opacity="0.35" filter="url(#glowS)">
    <rect x="134" y="215" width="34" height="145" rx="17"/>
    <circle cx="151" cy="176" r="19"/>
    <path d="M210 288 a74 74 0 1 0 148 0 a74 74 0 1 0 -148 0 z M242 288 a42 42 0 1 1 84 0 a42 42 0 1 1 -84 0 z" fill-rule="evenodd"/>
    <rect x="334" y="150" width="34" height="210" rx="17"/>
  </g>

  <!-- monogram "id" -->
  <g fill="url(#ink)">
    <rect x="134" y="215" width="34" height="145" rx="17"/>
    <circle cx="151" cy="176" r="19"/>
    <path d="M210 288 a74 74 0 1 0 148 0 a74 74 0 1 0 -148 0 z M242 288 a42 42 0 1 1 84 0 a42 42 0 1 1 -84 0 z" fill-rule="evenodd"/>
    <rect x="334" y="150" width="34" height="210" rx="17"/>
  </g>

  <!-- key accent (lower-left), glow then core -->
  <g transform="translate(46,330) rotate(-30) scale(1.1)">
    <g filter="url(#glowS)" opacity="0.6" fill="#7c3cff">
      <path d="M2 22 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 z M11 22 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 z" fill-rule="evenodd"/>
      <rect x="30" y="17" width="60" height="10" rx="5"/>
      <rect x="80" y="27" width="9" height="15" rx="3.5"/>
      <rect x="62" y="27" width="8" height="11" rx="3.5"/>
    </g>
    <g fill="url(#key)">
      <path d="M2 22 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 z M11 22 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 z" fill-rule="evenodd"/>
      <rect x="30" y="17" width="60" height="10" rx="5"/>
      <rect x="80" y="27" width="9" height="15" rx="3.5"/>
      <rect x="62" y="27" width="8" height="11" rx="3.5"/>
    </g>
  </g>
</svg>"""


def render(png_path, size):
    cairosvg.svg2png(bytestring=SVG.encode(), write_to=png_path,
                     output_width=size, output_height=size)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = {
        "icon-512.png": 512,
        "icon-192.png": 192,
        "apple-touch-icon.png": 180,
        "header-logo.png": 80,
        "favicon-32.png": 32,
    }
    for name, size in targets.items():
        render(os.path.join(OUT, name), size)
        print(f"wrote {name} ({size}px)")

    # favicon.ico: render the largest frame and let Pillow embed each size
    ico_sizes = [16, 32, 48]
    buf = io.BytesIO()
    cairosvg.svg2png(bytestring=SVG.encode(), write_to=buf,
                     output_width=max(ico_sizes), output_height=max(ico_sizes))
    buf.seek(0)
    base = Image.open(buf).convert("RGBA")
    base.save(FAVICON_ICO, format="ICO", sizes=[(s, s) for s in ico_sizes])
    print(f"wrote favicon.ico ({ico_sizes})")


if __name__ == "__main__":
    # preview mode: PREVIEW=/path renders a single 512 png and exits
    preview = os.environ.get("PREVIEW")
    if preview:
        render(preview, 512)
        print(f"preview -> {preview}")
    else:
        main()
