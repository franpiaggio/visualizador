# Archipiélago

Segunda interpretación de la misma composición en Strudel (Mi menor, `setcpm(38)`), libre y distinta de [Sonar](../sonar/README.md). Del original se conserva una sola idea: **el código vive dentro de la imagen**.

La música dibuja un mapa grabado. Cada nota levanta una isla, los ecos sondean el agua y los subgraves mueven la marea. Las curvas de nivel están rotuladas con las líneas del código que levantaron esa tierra, y lo que está sonando se marca en bermellón con un recuadro, como el resaltado de strudel.cc.

## Cómo correrlo

```sh
cd archipielago
python3 build.py                 # genera index.html a partir de template.html + compo.strudel
python3 -m http.server 47222
```

Abrir `http://127.0.0.1:47222/`. Necesita internet (Strudel y los samples de piano se cargan de unpkg y GitHub).

## Controles

| Acción | Qué hace |
| --- | --- |
| Primer click | Arranca la música |
| Click en el mapa | Toca una nota y levanta una isla ahí. Graves a la izquierda, agudos a la derecha; la nota se ajusta al acorde que suena y entra en la próxima corchea |
| Click en la rosa de los vientos | Frena / arranca |
| Teclado (Z…/, A…;, Q…P) | Notas de Mi menor en tres octavas |
| `Espacio` | Tocar / detener |
| `Shift+C` | Muestra el editor de Strudel |
| `Shift+F` | Pantalla completa |

## Qué hace cada capa

| Capa | En el mapa |
| --- | --- |
| MOTIVO PRINCIPAL | Islas. La misma nota siempre levanta la misma isla (x por altura, y por ángulo áureo). La cima lleva un triángulo de cota y la nota tal como está escrita en el código. Sus ecos de delay abren ondas en el agua |
| ARPEGIO INFERIOR | Colinas más bajas y anchas, del lado grave |
| GRAN COLCHÓN | Bajíos amplios que suben despacio (ataque de 2,5 s) |
| DRONE PROFUNDO | El fondo entero se eleva lento |
| NUBE AGUDA | Islotes en la franja norte, según el paneo |
| ECOS CASI COMO SONAR | Sondeos: anillos punteados que se abren desde un punto; cada eco del delay es otro anillo |
| CHISPAS / REFLEJOS | Pozos chicos y fugaces |
| MASA DE RUIDO RESPIRANDO | Rugosidad del fondo marino |
| RUIDO AGUDO | Temblor fino de todas las curvas |
| PULSOS SUBGRAVES | Marea: el mar sube y una onda ancha sale del centro |

## Cómo funciona

```
Strudel (onDraw) ──► main.js: capa de cada hap, ecos del delay, armonía viva
                         │
                         ▼
                      map.js
   campo de alturas h(u,v) ── fondo fbm + islas + anillos, saturación suave (tanh)
          │
          ├─ relieve: tintas hipsométricas + sombreado del noroeste, a resolución de grilla
          ├─ curvas: marching squares → polilíneas encadenadas → Chaikin
          │     · costa (h = 0) gruesa, líneas de agua repetidas hacia afuera
          │     · curvas de tierra cada 0,12; una de cada cuatro, maestra
          └─ rótulos: texto del código escrito sobre las curvas
```

- **Rótulos estables.** Hay semillas fijas repartidas en el marco. Cada cuadro, cada semilla busca la curva más cercana y escribe ahí una línea del código, centrada en ese punto. Como las semillas no se mueven, los rótulos se deslizan con la curva en vez de saltar.
- **Qué línea se escribe.** La del evento que más pesa en ese punto (la línea de notación mini que generó la isla). Si no hay ninguno, una línea fija de la semilla.
- **Legibilidad.** Si el tramo va hacia la izquierda, el texto se escribe al revés para que no quede cabeza abajo. Se descartan curvas muy cerradas y rótulos que se pisan. Un halo del color del papel corta la curva debajo del texto, como en los mapas impresos.
- **Resaltado.** Los rangos de código activos (`hap.context.locations`) se pintan en bermellón con un recuadro que sigue la curva.
- **Papel.** Grano, fibras y bordes gastados en una textura que se genera una vez por tamaño y se aplica en `multiply`.

## Archivos

```
archipielago/
├── README.md
├── compo.strudel    la composición (igual a la de sonar)
├── template.html    esqueleto, con {{CODE}}
├── build.py         genera index.html
├── index.html       generado
├── style.css
├── main.js          puente Strudel → mapa, teclado y mouse
└── map.js           campo, relieve, curvas, rótulos (atlas de glyphs), marco y rosa de los vientos
```

No tiene dependencias propias: solo `@strudel/repl@1.3.0` desde unpkg.

## Rendimiento

Todo es Canvas 2D. Medido en Chrome con la música sonando: ~117 fps (~7 ms de JavaScript por cuadro).
- **Rótulos con atlas de glyphs.** Cada carácter del código se pre-dibuja una vez (halo de papel más tres tintas), y escribir sobre las curvas pasa a ser un `drawImage` por letra. Con `strokeText`/`fillText` rotados por letra, el mapa iba a 12 fps.
- **Capas compuestas por el navegador.** El relieve es un canvas chico, una celda por punto de la grilla, escalado suave por CSS. El papel es otro canvas con `mix-blend-mode: multiply`. Ninguno de los dos se redibuja en el canvas principal.
- **Relieve en CPU.** El canvas del relieve usa `willReadFrequently`, así `putImageData` por cuadro no sincroniza con la GPU.
- **Anillos acotados.** Solo recorren su banda, no el disco entero. Hay tope de 48 anillos y 160 islas vivas.
- **Loop protegido.** El loop pide el próximo cuadro antes de dibujar, así un error en un cuadro no congela la animación. El último error queda en `window.__mapError`.

Para inspeccionar desde la consola: `MAP.debug()`, `MAP.prof` (ms por etapa) y `MAP.opts` (apagar `labels`, `lines` o `paper` para comparar).
