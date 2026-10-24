"""Proxy HTTP mínimo para capturar el tráfico del celu (vía proxy global ADB).

- HTTP (GET/POST http://...): registra la URL completa + headers y reenvía.
- HTTPS (CONNECT): registra el host:puerto y hace túnel (no ve la ruta sin cert).

Las peticiones interesantes (player_api, get.php, .m3u8, .ts, xtream) se marcan.
Uso: python tools/capture_proxy.py   → escucha en 0.0.0.0:8888
"""
import socket
import threading
import re
import sys

PORT = 8888
LOG = "tools/capture_hits.txt"
INTEREST = re.compile(r"player_api|get\.php|\.m3u8|\.ts|xtream|/live/|username=|password=", re.I)


def log(line):
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def pipe(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except Exception:
        pass
    finally:
        for s in (a, b):
            try:
                s.close()
            except Exception:
                pass


def handle(client):
    try:
        client.settimeout(10)
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = client.recv(4096)
            if not chunk:
                return
            req += chunk
            if len(req) > 65536:
                break
        head = req.split(b"\r\n\r\n", 1)[0].decode("latin-1", "ignore")
        first = head.split("\r\n", 1)[0]
        method, target = (first.split(" ") + ["", ""])[:2]

        if method == "CONNECT":
            host, _, port = target.partition(":")
            port = int(port or 443)
            log(f"[HTTPS] CONNECT {host}:{port}")
            upstream = socket.create_connection((host, port), timeout=10)
            client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
            pipe(upstream, client)
            return

        # HTTP normal: target = http://host/path
        m = re.match(r"https?://([^/:]+)(?::(\d+))?(/[^ ]*)?", target)
        if not m:
            client.close()
            return
        host, port, path = m.group(1), int(m.group(2) or 80), m.group(3) or "/"
        full = f"http://{host}:{port}{path}"
        tag = "  ★STREAM/API" if INTEREST.search(full) else ""
        log(f"[HTTP] {method} {full}{tag}")

        upstream = socket.create_connection((host, port), timeout=10)
        # reescribir la request-line a path relativo
        newhead = head.replace(target, path, 1)
        body = req.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in req else b""
        upstream.sendall(newhead.encode("latin-1", "ignore") + b"\r\n\r\n" + body)
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        pipe(upstream, client)
    except Exception as e:
        try:
            client.close()
        except Exception:
            pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", PORT))
    srv.listen(200)
    log(f"=== proxy capturador escuchando en 0.0.0.0:{PORT} ===")
    while True:
        client, addr = srv.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
