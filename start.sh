#!/usr/bin/env bash
# Tiradas W&G 3D — lanzador en modo desarrollo (sin AppImage).
# Es la vía más fiable en Linux: mismo motor que el paquete, sin montajes.
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[W&G] Primera vez: instalando dependencias…"
  npm install --no-audit --no-fund
fi

exec npx electron . "$@"
