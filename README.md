# 🎲 Tiradas W&G 3D — overlay de dados para Wrath & Glory

Overlay transparente de dados 3D con física real, pensado para mesas de **Warhammer 40.000: Wrath & Glory** que usan **Arkenforge** (o cualquier herramienta) en una segunda pantalla: el DM lanza desde su pantalla principal y los jugadores ven los dados caer **sobre el mapa**, con efectos de fuego en las Pifias y llama dorada en las Glorias.

![efectos](https://img.shields.io/badge/efectos-fuego_%2B_gloria-orange) ![motor](https://img.shields.io/badge/f%C3%ADsica-cannon--es-blue) ![render](https://img.shields.io/badge/3D-three.js-green)

## Cómo funciona

Una app Electron con dos ventanas:

| Ventana | Pantalla | Qué hace |
|---|---|---|
| **Control** | Principal del DM | Lanzar tiradas, presets, historial, ajustes |
| **Overlay** | Secundaria (jugadores) | Transparente, siempre encima y *click-through*: los dados caen sobre Arkenforge y los clics atraviesan hasta el mapa |

La física decide el resultado: los dados se lanzan de verdad, rebotan, se posan y la cara superior se lee del quaternion. Nada está predeterminado.

## Reglas W&G integradas

- **Test** — pool de d6 (1-20). El último dado es el **dado de Ira** (dorado, brilla).
  - 4-5 = 1 icono · 6 = 2 iconos · éxito si iconos ≥ DN · cada 2 iconos extra = 1 shift
  - **Ira 1 → ¡COMPLICACIÓN!** 🔥 llamarada roja + viñeta en pantalla
  - **Ira 6 → ¡GLORIA!** ✨ fuente dorada + destello
- **Daño / ED** — base + N dados de ED (4-5 = +1, 6 = +2)
- **Libre** — tirada suelta con suma total

## Efectos y sonido

- Conteo animado: cada dado se ilumina en secuencia con su beep, contador de iconos en grande
- Sonido 100% procedural (Web Audio): clacks de dados por colisión con la fuerza del impacto, stingers de veredicto — sin archivos de audio
- Banner de veredicto estilo Wrath & Glory con el detalle ("12 iconos vs DN 4 · +4 shifts")

## Uso

1. Abre la app → ventana de Control.
2. En **Pantallas**, elige el monitor donde está Arkenforge → el overlay aparece ahí.
3. Configura dados y DN (o usa un preset) → **LANZAR** (o Espacio).
4. Consejo: pon Arkenforge en **ventana sin bordes** (borderless), no fullscreen exclusivo, para que el overlay siempre quede por encima.

### Atajos (con la ventana de control enfocada)

| Tecla | Acción |
|---|---|
| `Espacio` | Lanzar |
| `R` | Repetir última tirada |
| `1`-`9` | Pool rápido en modo Test |
| `T` / `D` / `L` | Cambiar a Test / Daño / Libre |
| `Esc` | Limpiar el overlay |

### Presets

Los presets precargados salen de una mesa real ("Azul — BS", "Ztrambotico — Smite"…). Guarda los tuyos con los valores que tengas puestos y lánzalos con un clic. Se guardan en `config.json` junto con monitor, volumen y duración del veredicto.

### Modo ventana

Si la transparencia no funciona en tu equipo (algunos Linux/Wayland), activa **"Modo ventana"** en Pantallas: el overlay se convierte en una ventana normal para proyectarla/compartirla como prefieras.

## Instalación

### Binarios (recomendado)

Descarga de [Releases](../../releases):
- **Windows**: `WG-Dice-Overlay-*-portable.exe` — portable, sin instalación. Si Windows SmartScreen avisa: *Más información → Ejecutar igualmente* (el exe no está firmado).
- **Linux**: `WG-Dice-Overlay-*-x86_64.AppImage` (`chmod +x` y ejecuta; necesita FUSE, `sudo pacman -S fuse2` en Arch).

### Desde código

```bash
git clone https://github.com/boujuan/wg-dice-overlay.git
cd wg-dice-overlay
npm install
npm start
```

Empaquetar: `npm run dist` (genera `.exe` portable y `.AppImage` en `dist/`).

## Solución de problemas

| Problema | Solución |
|---|---|
| El overlay no se ve sobre Arkenforge | Arkenforge en fullscreen exclusivo dibuja por encima: cámbialo a borderless/ventana |
| El overlay tapa y no deja hacer clic | Es *click-through* por diseño; en Windows funciona siempre. En Linux/Wayland puede fallar → usa Modo ventana o sesión X11 |
| No se oye nada | Sube el volumen en el panel; el audio se genera al vuelo (sin archivos) |
| SmartScreen/antivirus avisa del .exe | Firmado no está; "ejecutar igualmente" o añade excepción |
| Los dados salen del borde | No pueden: hay paredes invisibles ajustadas a la pantalla |

## Técnica

Electron + three.js (render alpha) + cannon-es (física rígida) + Web Audio API. Dos `BrowserWindow`: control normal y overlay `transparent + frame:false + alwaysOnTop('screen-saver') + setIgnoreMouseEvents(true)`. Sin servidores, sin red, todo local.

```
main.js          proceso principal: ventanas, displays, IPC, config
preload.js       puente IPC seguro (contextBridge)
control/         UI del DM (vanilla JS)
overlay/         dados 3D, partículas, audio, reglas W&G
  wng.js         lógica pura testeable (iconos, shifts, pifia, gloria)
  dice.js        escena three.js + mundo cannon-es + lectura de caras
  particles.js   fuego/gloria/ascuas (canvas 2D aditivo)
  sound.js       síntesis procedural
scripts/vendor.mjs   copia three/cannon-es de node_modules a overlay/vendor/
```

## Licencia

MIT — haz lo que quieras, invitame a una partida si te pilla cerca.
