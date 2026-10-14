#!/usr/bin/env python3
"""Serve this folder over HTTPS so Chrome on a phone can use the microphone.

The recognizer does not need COOP or COEP headers. This process only serves
files. It does not receive audio.
"""

from __future__ import annotations

import http.server
import socket
import ssl
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERT_DIR = ROOT / "certs"
HOST = "0.0.0.0"
PORT = 8443


def local_ips() -> list[str]:
    ips = {"127.0.0.1"}
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("8.8.8.8", 80))
        ips.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for item in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ":" not in item:
                ips.add(item)
    except OSError:
        pass
    return sorted(ips)


def ensure_cert() -> tuple[Path, Path]:
    CERT_DIR.mkdir(exist_ok=True)
    cert = CERT_DIR / "cert.pem"
    key = CERT_DIR / "key.pem"
    if cert.exists() and key.exists():
        return cert, key
    san = ",".join(["DNS:localhost", *[f"IP:{ip}" for ip in local_ips()]])
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "30",
            "-nodes",
            "-subj",
            "/CN=dictation",
            "-addext",
            f"subjectAltName={san}",
        ],
        check=True,
    )
    return cert, key


def main() -> None:
    cert, key = ensure_cert()
    handler = lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(
        *args, directory=str(ROOT), **kwargs
    )
    server = http.server.ThreadingHTTPServer((HOST, PORT), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("Откройте в Chrome на телефоне (та же сеть Wi-Fi):")
    for ip in local_ips():
        print(f"  https://{ip}:{PORT}")
    print("Браузер предупредит о сертификате — подтвердите его, затем разрешите микрофон.")
    server.serve_forever()


if __name__ == "__main__":
    main()
