"""Packs the rendered PNGs into a multi-resolution Windows .ico.

Windows needs an .ico for the installer and the taskbar. The ICO format is a
small header followed by PNG-encoded images (Vista and later accept PNG data
directly), so this needs no image library.

    python tools/make-ico.py
"""

import struct
import sys
from pathlib import Path

SIZES = [32, 128, 256]
BUILD = Path("build")
OUT = Path("icon.ico")


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    return struct.unpack(">II", data[16:24])


def main() -> int:
    images = []
    for size in SIZES:
        path = BUILD / f"icon-{size}.png"
        if not path.is_file():
            raise SystemExit(f"missing {path} - run: node tools/app-icon.mjs")
        w, h = png_size(path)
        if (w, h) != (size, size):
            raise SystemExit(f"{path} is {w}x{h}, expected {size}x{size}")
        images.append(path.read_bytes())

    # ICONDIR: reserved(2) type(2)=1 icon count(2)
    header = struct.pack("<HHH", 0, 1, len(images))

    # ICONDIRENTRY per image: width/height(1, 0 means 256), colour count(2)=0,
    # reserved(2)=0, planes(2)=1, bit count(2)=32, bytes in resource(4),
    # offset into file(4).
    offset = len(header) + 16 * len(images)
    entries = []
    for size, blob in zip(SIZES, images):
        entries.append(
            struct.pack(
                "<BBBBHHII",
                size if size < 256 else 0,
                size if size < 256 else 0,
                0,
                0,
                1,
                32,
                len(blob),
                offset,
            )
        )
        offset += len(blob)

    OUT.write_bytes(header + b"".join(entries) + b"".join(images))
    print(f"{OUT} -> {OUT.stat().st_size} bytes, {len(images)} sizes: {SIZES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())