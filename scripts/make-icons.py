#!/usr/bin/env python3
"""Рисует иконку приложения: микрофон на терракотовом поле."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "icons"
BG = (157, 44, 34, 255)
FG = (255, 253, 248, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, scale: float) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size, scale))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def pixel(x: int, y: int, size: int, scale: float) -> tuple[int, int, int, int]:
    acc = [0, 0, 0, 0]
    steps = 4
    for oy in range(steps):
        for ox in range(steps):
            color = sample((x + (ox + 0.5) / steps) / size, (y + (oy + 0.5) / steps) / size, scale)
            for index, channel in enumerate(color):
                acc[index] += channel
    count = steps * steps
    return tuple(channel // count for channel in acc)


def sample(x: float, y: float, scale: float) -> tuple[int, int, int, int]:
    u = 0.5 + (x - 0.5) / scale
    v = 0.5 + (y - 0.5) / scale
    if mic(u, v):
        return FG
    return BG


def mic(u: float, v: float) -> bool:
    if rounded(u, v, 0.406, 0.16, 0.594, 0.50, 0.094):
        return True
    dx = u - 0.50
    dy = v - 0.47
    dist = dx * dx + dy * dy
    if dy >= -0.02 and 0.175 ** 2 <= dist <= 0.24 ** 2 and abs(dx) <= 0.26:
        return True
    if 0.47 <= u <= 0.53 and 0.69 <= v <= 0.80:
        return True
    if rounded(u, v, 0.36, 0.78, 0.64, 0.86, 0.03):
        return True
    return False


def rounded(x: float, y: float, left: float, top: float, right: float, bottom: float, radius: float) -> bool:
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= radius * radius


def main() -> None:
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "icon-192.png", 192, 1)
    write_png(OUT / "icon-512.png", 512, 1)
    write_png(OUT / "icon-maskable-192.png", 192, 0.8)
    write_png(OUT / "icon-maskable-512.png", 512, 0.8)
    write_png(OUT / "apple-touch-icon.png", 180, 1)
    print(OUT)


if __name__ == "__main__":
    main()
