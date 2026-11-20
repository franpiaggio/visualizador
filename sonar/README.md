# Sonar

Visualizador 3D para una composición ambient en Strudel (Mi menor, 38 ciclos por minuto, 10 capas).

Una marina nocturna en pixel art: un anillo de siete monolitos en el agua, uno por nota de Mi menor. Cada nota que suena se lee directamente del motor de Strudel y se convierte en luz, ondas, bruma o polvo. El código se dibuja dentro de la escena: una columna que sigue lo que está sonando con los recuadros de Strudel, y etiquetas que flotan en 3D junto a cada luz.

![estado](https://img.shields.io/badge/estado-funcionando-2a7a7f?style=flat-square)

---

## Cómo correrlo

No hay build de dependencias. Es una página estática.

```sh
cd sonar
python3 build.py                 # genera index.html a partir de template.html + compo.strudel
python3 -m http.server 47219     # cualquier servidor estático sirve
```

Abrir `http://127.0.0.1:47219/`.

- Necesita **internet**: Strudel se carga desde unpkg (`@strudel/repl@1.3.0`) y los samples de piano desde GitHub.
- Necesita **WebGL 2** (Chrome, Edge, Firefox y Safari recientes).
- Tiene que servirse por HTTP: los módulos ES no cargan desde `file://`.

## Controles

| Acción | Efecto |
| --- | --- |
| Click en el blob central | Frena / arranca la música. Flota subiendo y bajando; detenido se contrae y late lento |
| Click en el agua | Empieza a tocar (el navegador exige un gesto para habilitar el audio) |
| Click en un pilar | Toca la nota de ese pilar con el piano del motivo. Más arriba = octava más aguda (4, 5 o 6). También responde el reflejo |
| Letras del teclado | Cada tecla es un pilar: `a s d f g h j` = E F# G A B C D (los 7 pilares en orden, recorriendo el anillo), `k l ñ` siguen una octava arriba. Fila `z…` grave (desde E3), `a…` media (desde E4), `q…` aguda (desde E5) |
| Arrastrar | Girar e inclinar la cámara. La deriva automática vuelve a los pocos segundos |
| Rueda | Acercar / alejar |
| `espacio` | Tocar / detener |
| `Shift+C` | Mostrar el editor real de Strudel para editar el código (`Ctrl+Enter` re-evalúa, `Ctrl+.` detiene) |
| `Shift+H` | Ocultar la columna de código y las barras de capas |
| `Shift+F` | Pantalla completa |

### Todo lo que toca el usuario está en la tonalidad

- **Siete pilares, siete notas:** el anillo tiene un pilar por nota de Mi menor natural (E F# G A B C D), en orden de escala y repartidos en todo el círculo. Mi queda al fondo. Antes eran doce sobre el círculo de quintas, pero así las notas de la pieza se amontonaban en un solo arco y los cinco tocones cromáticos nunca sonaban.
- **Teclado y pilares:** cada tecla y cada pilar tocan su propia nota de la escala, así que nada sale de la tonalidad y siempre se enciende el pilar que corresponde.
- **Armonía viva:** el acorde actual son las clases de altura que tocaron `GRAN COLCHÓN` y `ARPEGIO INFERIOR` en el último ciclo. Sus pilares quedan levemente encendidos como guía de qué notas "suenan" ahora.
- **Ritmo:** con la música andando, cada toque se cuantiza a la próxima corchea del ciclo (8 por ciclo).

Está implementado en `main.js` (`consonant`, `quantizeDelay`, `playNote`; `snap` queda disponible para ajustar al acorde si se quiere) y en `scene3d.js` (`SCALE`, `stoneOf`).

Fuera del código de Strudel la página no tiene texto. Es una decisión de diseño.

---

## La idea visual

Referencias: las marinas de Hiroshi Sugimoto (horizonte, agua y cielo como campo de color), los anillos de piedra, la visual music de Oskar Fischinger (cada sonido es un gesto) y la estética de datos de Ryoji Ikeda para la parte técnica (el código y sus recuadros como material visual).

Decisiones principales:

- **La escala como lugar.** Siete pilares, uno por nota de Mi menor, en orden de escala alrededor del anillo. Mi, la tónica, es el más alto y queda al fondo; Si, la quinta, el segundo. Cada nota que suena enciende su pilar, así que la melodía recorre el anillo y se ve su contorno.
- **Mundo espejo.** Todo lo que está sobre el agua tiene un gemelo invertido debajo: las piedras se esculpen dos veces y las partículas se escriben dos veces. El mar es semitransparente, así que ese gemelo se ve como reflejo, y el gemelo de cada partícula se desplaza con las ondas.
- **Los ecos son literales.** Cada capa tiene `delay`, `delaytime` y `delayfeedback`. Cada nota se vuelve a disparar visualmente en `t + k·delaytime` con intensidad `delay · feedback^(k-1)`. Por eso el sonar deja anillos sucesivos y las chispas caen repitiéndose.
- **El código es parte de la imagen.** Se dibuja en un canvas a resolución de arte, pixelado igual que el 3D, con tipografía de terminal (VT323).

### Qué hace cada capa

La capa se detecta por el comentario `// NOMBRE` que precede al bloque en el código. Si se edita el código y se cambian los comentarios, hay un respaldo que deduce la capa por el sonido (ver `classify` en `main.js`).

| Capa (comentario) | Gesto visual | Dónde está |
| --- | --- | --- |
| `MOTIVO PRINCIPAL` | Orbe cálido sobre el pilar de su nota (más alto si la octava es más aguda), hilo de luz entre notas consecutivas, onda en la base del pilar, cara del pilar iluminada | `spawn` → `melody` |
| `ARPEGIO INFERIOR` | Ondas en el agua dentro del anillo, cerca del pilar de su nota | `arp` |
| `GRAN COLCHÓN` | Tono y luz del cielo y del mar. El tono sale de la nota en el círculo de quintas y la luz del `lpf` | `pad` |
| `DRONE PROFUNDO` | Resplandor cálido del horizonte detrás del anillo | `drone` |
| `NUBE AGUDA` | Nubes hechas de puntos que titilan, ubicadas según el `pan` | `cloud` |
| `ECOS CASI COMO SONAR` | Ping: haz vertical cian y un anillo rápido que barre el mar, uno por cada eco | `sonar` |
| `CHISPAS / REFLEJOS` | Destellos en el aire que se repiten y caen | `sparks` |
| `MASA DE RUIDO RESPIRANDO` | Bruma baja sobre el agua. El color depende del `lpf` | `breath` |
| `RUIDO AGUDO` | Polvo eléctrico que parpadea | `dust` |
| `PULSOS SUBGRAVES` | Oleada que sube desde el centro y se expande, más un leve empuje de cámara | `sub` |

### La orbe central

Reacciona a cada capa con envolventes propias (sube rápido, se va de a poco), así cambia de a poco pero se nota:

| Capa | Qué le hace a la orbe |
| --- | --- |
| Colchón | Color de base (sigue al cielo) y respiración del tamaño |
| Drone | Núcleo más cálido y brillante |
| Melodía | Cada nota la estira hacia el pilar que suena (bulto cálido) y la inclina un poco hacia ese lado |
| Arpegio (estiramiento) | Lo mismo, más suave |
| Arpegio | Vibración fina de la superficie |
| Subgraves | Se infla, se aplasta y sube |
| Sonar | Anillo cian que la recorre de arriba abajo |
| Chispas / polvo | Destellos en puntos sueltos |
| Nube | Tinte violeta |
| Bruma | Halo difuso, superficie más blanda |

Además flota con dos ondas lentas que no coinciden, así nunca repite el mismo recorrido. Con música oscila más amplio. Código: bloque `blob central` en `scene3d.js` (`lv`, `bl`, `bumps`, `bands`).

Cada luz se refleja en el agua como una estela estirada hacia la cámara, como la luna sobre el mar.

---

## Arquitectura

```
sonar/
├── compo.strudel     la composición (fuente de verdad del código musical)
├── template.html     esqueleto de la página; {{CODE}} se reemplaza por la compo
├── build.py          genera index.html (template + compo)
├── index.html        GENERADO, no editar a mano
├── style.css         layout, editor oculto, encuadre cinematográfico, viñeta
├── main.js           puente Strudel → escena, clasificación de capas, ecos, interacción
├── scene3d.js        escena Ink Studio: piedras, mar, cielo, partículas, cámara, picking
├── codeview.js       el código dibujado en la escena (columna + etiquetas 3D)
└── vendor/ink/       Ink Studio (copia mínima para el navegador)
```

### Flujo de datos

```
Strudel (scheduler) ──► Drawer de StrudelMirror (cada frame)
                          │  haps con onset ≤ tiempo actual
                          ▼
                    main.js · onDraw
                          │  classify(hap) → capa
                          │  noteLoc(hap)  → rango del código
                          │  ecos programados (delay)
                          ▼
            scene.spawn(ev) ──► devuelve la posición 3D del gesto
                          │
                          ├──► codeView.event(rango, capa, posición)
                          ▼
         requestAnimationFrame:  scene.frame()  →  renderer Ink Studio (WebGL2)
                                 codeView.draw() → canvas 2D pixelado encima
```

### Strudel (`main.js`)

- La página usa el web component `<strudel-editor>` de `@strudel/repl`. El código va como comentario HTML dentro del elemento: `build.py` lo inserta desde `compo.strudel`.
- El componente crea un `StrudelMirror` (`el.editor`). Reemplazo su `onDraw` por uno propio que primero llama al original (así se mantiene el resaltado del editor) y después detecta los haps nuevos.
  - Un hap se dispara una sola vez (`WeakSet`) cuando `whole.begin <= time`.
  - Se ignoran los haps con más de 0,25 ciclos de atraso, por ejemplo después de re-evaluar.
  - En cada frame se arma también la lista de haps activos (`isActive`) con sus `context.locations`: son los rangos que la columna de código enmarca.
- **Capa de cada hap:** `hap.context.locations` da rangos de caracteres del código fuente. Se toma el menor `start`, que corresponde a la notación mini de `note()` o `s()`, y se busca el último comentario `//` anterior a esa posición. Los comentarios en líneas consecutivas se agrupan, como en el caso de `PULSOS SUBGRAVES`.
- **Ganancias normalizadas:** las capas van de `gain .018` a `.38`. `REF` en `onHap` normaliza cada una contra su ganancia de referencia, para que todas tengan presencia visual.
- **`s("noise")`:** ese sonido no existe en Strudel (los ruidos son `white`, `pink`, `brown` y `crackle`), así que en strudel.cc esas dos capas no suenan. Al iniciar, sin tocar el código, se registra `noise` como alias de `white` con `soundAlias('white', 'noise')`.
- **Pilares tocables:** `playStone` llama a `superdough()` (global después del prebake de Strudel) con los mismos parámetros que el motivo principal, y dispara el gesto visual de melodía con sus ecos.

### Escena 3D (`scene3d.js`)

Usa **[Ink Studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio)**: SDF esculpido → splats gaussianos → render pixel-art en WebGL2, con paleta limitada y dither.

**Construcción, una sola vez:**

1. Paleta propia de 37 colores (`PAL`): azules nocturnos, violetas, verde agua, cálidos, hueso y piedra. El renderer cuantiza y difumina contra esta paleta.
2. Piedras esculpidas con `S.box` (y sus gemelos invertidos), horneadas con `S.bake()`. Son estáticas.
3. Splats reservados, creados con `B.disc` y reescritos en cada frame:
   - **Mar:** malla polar, densa en el centro y abierta hacia el horizonte (radio 62).
   - **Cielo:** cilindro de radio 78, también espejado bajo el horizonte. La covarianza se reescribe para que sean bandas horizontales anchas.
   - **Partículas:** pool de 3600 slots para orbes, hilos, chispas, nubes, bruma y polvo.

**Formato de un splat** en `world.data`, 16 `float` por splat:

```
[x, y, z, densidad]  [c00, c01, c02, rgbEmpaquetado]  [c11, c12, c22, flags]  [fase, vel, rango, extra]
```

- La covarianza son varianzas en unidades de mundo (σ²).
- El color va empaquetado como `r + g·256 + b·65536`.
- `flags & 32` = emisivo.
- La densidad 3 es opaca. Para ocultar un slot se usa densidad 0 y y = −500.

**Cada frame:**

- Se recalculan las alturas y colores del mar: oleaje base, ondas (`ripples`), oleadas (`swells`), estelas de las luces y Fresnel aproximado (lejos refleja el horizonte).
- Se recalcula el color del cielo (colchón + drone).
- Se escriben las partículas.
- Se renderiza con `changedRows` = filas de textura de los splats dinámicos (512 splats por fila).
- Se captura la pose de cámara con `captureStreamingCamera` para proyectar posiciones del mundo a pantalla (`scene.project`) y para el picking.

**Picking:** un rayo desde el cursor (eye, right, up, back, tangent y aspect de la pose de Ink Studio) contra un cilindro por pilar. Se queda con el impacto más cercano, así que respeta las oclusiones.

**Ajustes en vivo:** la escena queda expuesta como `window.SCENE`. Ejemplos desde la consola:

```js
SCENE.tune.dist = 12          // distancia de cámara
SCENE.tune.pitch = 0.25       // inclinación
SCENE.tune.yawSpeed = 0       // detener la deriva
SCENE.tune.opts = { raw: true } // cualquier opción de frame del renderer de Ink Studio
```

### Código en escena (`codeview.js`)

- El canvas va a 2× la resolución de arte del 3D y se agranda con `image-rendering: pixelated`.
- **Columna:** el código completo con coloreado mínimo (comentarios, métodos, números, notas, silencios). Se desplaza con suavidad hacia la línea del último evento. Prioriza la melodía y tiene un tiempo mínimo de permanencia en cada línea. Los tokens activos llevan un recuadro del color de su capa y los bordes se desvanecen.
- **Etiquetas:** cada evento nuevo (no los ecos) muestra su línea de código junto a la posición 3D que devolvió `scene.spawn`, con el token enmarcado y una línea guía. Debajo aparece su reflejo invertido y ondulante.

---

## Editar la composición

1. Editar `compo.strudel`. Para que el mapeo visual funcione, mantener un comentario `// NOMBRE` encima de cada capa del `stack`.
2. `python3 build.py`.
3. Recargar.

Para probar cambios sin rebuild, apretar `c`, editar en el editor y `Ctrl+Enter`. Esos cambios no se guardan en `compo.strudel`.

Palabras clave reconocidas en los comentarios (regex en `KINDS`, `main.js`): `MOTIVO|MELOD`, `ARPEG`, `COLCH|PAD`, `DRONE`, `NUBE`, `ECO|SONAR`, `CHISP|REFLEJ`, `MASA|RESPIR`, `AGUD|POLVO|ELECTR`, `SUBGRAV|PULSO`.

## Limitaciones conocidas

- El cielo conserva una textura leve de "dientes" donde se superponen las bandas de splats.
- La resolución de arte se adapta al ancho de la ventana (420–720 px). En pantallas muy chicas el código de la columna se lee poco.
- Las dos franjas negras (encuadre cinematográfico) están vacías. Pendiente: usar la de abajo para un pianoroll de los 16 ciclos con cabezal y la de arriba para la forma de onda real (analizador del audio).
- Strudel se carga desde CDN con versión fija (1.3.0). Si unpkg no está disponible, no hay audio.

## Dependencias y licencias

| Pieza | Origen | Licencia |
| --- | --- | --- |
| Strudel (`@strudel/repl@1.3.0`) | unpkg, en runtime | AGPL-3.0-or-later |
| Ink Studio | `vendor/ink/`, commit en `vendor/ink/COMMIT` | MIT (`vendor/ink/LICENSE`) |
| VT323, JetBrains Mono | Google Fonts | OFL |

`vendor/ink/` contiene `ink-studio.browser.js` (generado con `require('.').bundle()` desde el repo), `webgl.mjs`, `src/webgl/` y los dos módulos de cámara de los que depende. Para actualizarlo:

```sh
git clone --depth 1 https://github.com/siliconjungle/shapeshift-labs-ink-studio ink && cd ink
node -e 'require("fs").mkdirSync("dist",{recursive:true});require("fs").writeFileSync("dist/ink-studio.browser.js",require(".").bundle())'
cp dist/ink-studio.browser.js webgl.mjs LICENSE <destino>/vendor/ink/
cp -R src/webgl <destino>/vendor/ink/src/
cp src/camera-impulses.js src/camera-lens.js <destino>/vendor/ink/src/
git rev-parse HEAD > <destino>/vendor/ink/COMMIT
```
