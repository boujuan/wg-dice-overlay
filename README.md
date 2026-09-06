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

### Windows (para el DM)
Descarga `WG-Dice-Overlay-Setup-*.exe` de [Releases](../../releases) — instalador de un clic (sin permisos de admin). **A partir de ahí la app se auto-actualiza**: cuando sale una versión nueva aparece un botón «🔄 Actualizar» que descarga, instala y relanza solo.

Si prefieres no instalar nada, sigue habiendo `WG-Dice-Overlay-*-portable.exe` (doble clic, sin instalación; actualización manual descargando la siguiente). En ambos casos, si SmartScreen avisa: *Más información → Ejecutar igualmente* (no está firmado).

### Linux

Tres vías, por orden de recomendación:

1. **Desde el repo (recomendado en tu propia máquina)** — sin AppImages de por medio:
   ```bash
   git clone https://github.com/boujuan/wg-dice-overlay.git
   cd wg-dice-overlay && ./start.sh
   ```
   (`start.sh` instala dependencias la primera vez y arranca el modo dev.)

2. **tar.gz portable** — `WG-Dice-Overlay-*-linux-x64.tar.gz`: descomprime y ejecuta
   `./linux-unpacked/wg-dice-overlay` (si no arranca, añade `--no-sandbox`).

3. **AppImage** — funciona con doble clic, pero ojo:
   - Con **AppImageLauncher** instalado (CachyOS y otras), lanzar por terminal puede abrir un diálogo de "¿integrar?" en vez de ejecutar; desde el gestor de archivos elige *Ejecutar*.
   - En sesiones **Wayland**, la propia app fuerza X11/XWayland automáticamente (donde la transparencia y el click-through sí funcionan) desde v1.0.1.
   - Si el proceso GPU de tu máquina crashea, la app se **relanza sola sin aceleración hardware** (SwiftShader tira los dados de sobra) y lo recuerda.

### Empaquetar desde código

`npm run dist` genera en `dist/` el `.exe` portable, el `.AppImage` y puedes comprimir `linux-unpacked/` a mano para el tar.gz.

## Solución de problemas

| Problema | Solución |
|---|---|
| El overlay no se ve sobre Arkenforge | Arkenforge en fullscreen exclusivo dibuja por encima: cámbialo a borderless/ventana |
| En Linux el proceso GPU crashea (segfault en `libGLESv2 / EGL_CreateWindowSurface`) | Bug de **Mesa/ANGLE** con ciertos drivers (AMD incluido). La app lo detecta y **relanza sola con ANGLE Vulkan** (verificado con Radeon RDNA3); si Vulkan también falla, pasa a software. Puedes forzar el modo en *Pantallas → Gráficos* |
| En Linux el overlay sale negro y bloquea | Ya resuelto: la app fuerza X11/XWayland en Linux. Si tu sesión no tiene XWayland (rarísimo), usa **Modo ventana** |
| El modo *Software* no pinta nada (XWayland) | Limitación conocida de Electron+X11 por software; usa *ANGLE Vulkan* o reinicia la sesión |
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
