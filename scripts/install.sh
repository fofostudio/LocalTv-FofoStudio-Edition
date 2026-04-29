#!/bin/bash
# Wrapper de compatibilidad: delega a setup.sh --no-start
# El instalador real ahora vive en la raiz del repo (setup.sh).

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

if [ ! -f "setup.sh" ]; then
    echo "Error: no se encontro setup.sh en la raiz del repo."
    exit 1
fi

exec bash setup.sh --no-start "$@"