"""Colector UDP para PCAPdroid (udp_exporter). Recibe la captura, la guarda cruda
y extrae en vivo hosts/URLs (HTTP Host, request-line, y SNI de TLS)."""
import socket
import re
import sys

PORT = 5123
RAW = "tools/magma_capture.bin"

host_re = re.compile(rb"Host:\s*([a-zA-Z0-9._-]+)")
get_re = re.compile(rb"(GET|POST|HEAD)\s+(\S+)\s+HTTP")
m3u8_re = re.compile(rb"[a-zA-Z0-9._-]+\.[a-z]{2,}[^\s\x00-\x1f\"']*\.m3u8[^\s\x00-\x1f\"']*")
url_re = re.compile(rb"https?://[a-zA-Z0-9._:/?=&%@~+-]+")

seen = set()


def sni_from_tls(data):
    # Busca extensión SNI (type 0x00) en ClientHello — heurística simple.
    out = []
    i = 0
    while True:
        j = data.find(b"\x00\x00", i)
        if j < 0:
            break
        # server_name extension: 00 00 <len2> <list_len2> 00 <name_len2> <name>
        try:
            if data[j+4] == 0x00:
                nlen = int.from_bytes(data[j+5:j+7], "big")
                if 3 < nlen < 100:
                    name = data[j+7:j+7+nlen]
                    if re.fullmatch(rb"[a-zA-Z0-9._-]+", name) and b"." in name:
                        out.append(name.decode())
        except Exception:
            pass
        i = j + 2
    return out


def main():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
    s.bind(("0.0.0.0", PORT))
    print(f"=== colector UDP escuchando en 0.0.0.0:{PORT} ===", flush=True)
    f = open(RAW, "wb")
    pkts = 0
    while True:
        data, _ = s.recvfrom(65535)
        f.write(data)
        f.flush()
        pkts += 1
        for m in host_re.findall(data):
            h = m.decode(errors="ignore")
            if h not in seen:
                seen.add(h); print(f"[HOST] {h}", flush=True)
        for meth, path in get_re.findall(data):
            line = f"{meth.decode()} {path.decode(errors='ignore')}"
            if line not in seen:
                seen.add(line); print(f"[REQ ] {line}", flush=True)
        for m in url_re.findall(data):
            u = m.decode(errors="ignore")
            if u not in seen and len(u) > 12:
                seen.add(u); print(f"[URL ] {u}", flush=True)
        for m in m3u8_re.findall(data):
            u = m.decode(errors="ignore")
            if u not in seen:
                seen.add(u); print(f"[M3U8] {u}", flush=True)
        for sni in sni_from_tls(data):
            k = "sni:" + sni
            if k not in seen:
                seen.add(k); print(f"[SNI ] {sni}", flush=True)


if __name__ == "__main__":
    main()
