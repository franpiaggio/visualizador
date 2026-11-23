# Bosque

Una segunda interpretación de la misma composición, separada de Sonar. De Sonar conserva una sola idea: el código forma parte de la imagen. Acá eso es literal: el código está plantado en la tierra.

Es una campiña de tarde de verano, con un aire de dibujo animado pero de tonos naturales, vista desde un dron que avanza de costado. Se inspira en las tomas aéreas tilt-shift del video `bosque horizontal final con sonido.mp4`. Cada capa de la composición es un prado abierto en el bosque, y su código está escrito con flores: cada punto de una tipografía de 3×5 es una flor. El color de cada flor sigue la sintaxis:

- notas y mini-notación en crema;
- funciones en amarillo;
- textos en rosa;
- números en naranja;
- comentarios en lavanda.

Donde el código cae sobre el agua, las letras son camalotes. Lo que suena florece en el color de su capa, con un recuadro de lucecitas alrededor, como en strudel.cc.

Entre prado y prado, el paisaje cambia. En una vuelta pasan, en orden: un arroyo con puente, campos de cultivo en parches con cercos de árboles, un lago con un islote y su cabaña, una aldea a lo largo de un sendero (humo en las chimeneas y cerezos en flor), un estanque con muelle, un árbol enorme en su loma, campos de lavanda, un caserío, una bahía y un pinar. Abajo corre un camino de tierra, y cúmulos bajos pasan entre el dron y el suelo con su sombra.

## Cómo correrlo

```sh
cd bosque
python3 build.py                 # genera index.html a partir de template.html + compo.strudel
python3 -m http.server 47231
```

Abrir `http://127.0.0.1:47231/`. Necesita internet (Strudel y sus samples) y WebGL 2.

## Controles

| Acción | Qué hace |
| --- | --- |
| Click en una nota del prado | La toca con el sonido de su capa y la hace florecer |
| Click en otro lado | Arranca la música |
| `Espacio` | Toca / detiene |
| Arrastrar | Desplazarse por el paisaje (el dron vuelve solo a su recorrido) |
| Rueda | Acercar / alejar |
| `Shift+C` | Abre el editor de Strudel |
| `Shift+F` | Pantalla completa |

## Qué hace cada capa

| Capa | En el paisaje |
| --- | --- |
| Todas | El token que suena florece en el color de su capa (ámbar, celeste, violeta…), con un recuadro de lucecitas y un resplandor en el pasto |
| MOTIVO PRINCIPAL | Luciérnagas que salen de la nota y suben titilando |
| ARPEGIO INFERIOR | Luciérnagas verdes y una onda en el agua si la nota está sobre un camalote |
| GRAN COLCHÓN | Destellos de sol sobre las copas |
| DRONE PROFUNDO | Los cúmulos se ponen más grises y su sombra más densa |
| NUBE AGUDA | Destellos de sol en el agua |
| ECOS CASI COMO SONAR | Ondas en el agua más cercana; cada eco del delay es otra onda |
| CHISPAS / REFLEJOS | Una bandada levanta vuelo desde el token, con su sombra; los ecos sueltan pétalos |
| MASA DE RUIDO RESPIRANDO | Una ráfaga: hojas que cruzan el cuadro |
| RUIDO AGUDO | Polen que titila |
| PULSOS SUBGRAVES | Oleaje en el agua y un leve descenso del dron |

## Arquitectura

```
bosque/
├── compo.strudel   la composición (la misma que Sonar)
├── template.html   esqueleto; el código va dos veces: en <strudel-editor> y en <script id="compo">
├── build.py        genera index.html
├── main.js         puente Strudel → escena, controles, notas clickeables
├── font3x5.js      la tipografía de flores (3×5 puntos, mayúsculas, minúsculas, dígitos y signos)
├── codemap.js      layout del código en prados, tipo de cada carácter, rectángulos de tokens
├── forest.js       la campiña en Ink Studio
├── ambience.js     ambiente del video en loop con fundido cruzado
├── audio/ambiente.m4a
└── vendor/ink/     Ink Studio (igual que en Sonar)
```

### El código plantado (`font3x5.js`, `codemap.js`, `forest.js`)

- **Tipografía:** es propia, de 3×5 puntos. Rasterizar tipografías pixeladas a ese tamaño (VT323, Silkscreen, Pixelify) daba letras ilegibles o solo mayúsculas. Un carácter mide 4 puntos y una línea 7; un punto son 0,075 unidades.
- **Layout:**
  - cada bloque `// CAPA` es una columna, y las columnas cortas se centran en z;
  - entre columnas quedan 8,5 unidades, donde va una escena del paisaje;
  - el ancho total, redondeado a tramos de 8, es el largo de una vuelta del dron.
- **Sintaxis:** un clasificador simple, con estado entre líneas (la mini-notación vive entre backticks), marca cada carácter como signo, comentario, nota, función, texto o número.
- **Flores:** cada punto es un disco chico apoyado en el prado, cada uno apenas corrido, de tamaño y tono un poco distintos, para que se lea como algo plantado y no impreso. En el prado, el suelo debajo del texto está un poco más bajo: si no, al ordenar los splats por profundidad, sus discos grandes tapan las flores.
- **Prados:** no son rectángulos. Cada línea abre el claro que ocupa, suavizado con las líneas vecinas, con un margen mínimo para que las copas no tapen letras y un borde roto por ruido. Alrededor, el bosque se ralea en árboles sueltos y arbustos. El pasto del prado es más claro y cálido al centro y queda en sombra contra el bosque.
- **Florecer:** cada tramo guarda qué splats forman cada carácter (offset del código → rango de splats) y su color original. Los rangos activos de Strudel tiñen esos splats con el color de su capa, encendidos, y al dejar de sonar vuelven despacio a su color. Solo se suben a la GPU las filas tocadas.
- **Recuadros:** son lucecitas sobre el prado alrededor del rectángulo del token, con un resplandor en el pasto.

### La campiña (`forest.js`)

- **Tramos que se generan al avanzar:** hay 7 tramos vivos de 8 unidades, centrados en la cámara, de hasta 16.000 splats cada uno. Al avanzar, el tramo que queda atrás se reescribe con el que viene, en este orden de prioridad: el código, el suelo y el agua, las casas, el árbol grande y los árboles. Los árboles se plantan desde el centro de la toma hacia afuera: si el tramo se llena, faltan en los bordes desenfocados, no en el medio.
- **Árboles con forma, no bolas:**
  - **robles y abedules:** un tronco que se abre en 3 a 5 ramas (splats alargados), y en la punta de cada rama un racimo de hojas chicas. La copa queda lobulada, con huecos donde se ven las ramas. La sombra en el suelo es una mancha por racimo, así repite los lóbulos;
  - **pinos:** cinco pisos de ramas como agujas largas, caídas hacia afuera desde el tronco. Desde arriba se leen como estrellas, como un pino real visto desde un dron;
  - **árbol grande:** nueve ramas largas con racimos secundarios;
  - **cada árbol tiene su tono y su tamaño:** hay algún árbol emergente, y los cerezos en flor están cerca de las aldeas;
  - la luz va en escalones suaves, y las hojas de abajo de cada racimo quedan en sombra;
  - el pinar se agrupa en manchas con claros entre medio;
  - todo se mece en la GPU (tipo de splat 14 de Ink).
- **Casas:**
  - paredes claras con ventanas y techo a dos aguas en cinco colores;
  - humo que sube solo en la GPU (tipo 3);
  - el muelle tiene un bote.
- **Agua:**
  - pool compartido entre tramos;
  - cada splat de agua es una pincelada alargada: con la corriente en el arroyo, con el viento en lagos y estanques;
  - el arroyo es ancho y serpenteante, con reflejos que bajan con la corriente; en las orillas hay piedritas y juncos que se mecen;
  - turquesa en la orilla y azul en el centro, con franjas de reflejo que corren;
  - algunos splats titilan solos (tipo 4) y además se recolorea con las ondas de la música.
- **Campos:** los surcos son pinceladas finas a lo largo de la hilera (trigo, brotes, arado, lavanda), no manchas.
- **Pasto abierto:** manchas de sol y de sombra a dos escalas, flores silvestres, arbustos y algún árbol solitario.
- **Nubes:** deshilachadas, a unos 5 de altura. Tienen un núcleo chato de bultos chicos y jirones largos y finos que se estiran con el viento, translúcidos en los bordes. La panza va en una sombra muy suave para que no se lean bolas grises, y la sombra en el suelo también se estira. La mitad pasa por arriba del cuadro y la otra mitad por abajo, rara vez por el centro, para no tapar el código.
- **Render:** suave por defecto (`look.pixel: false`). El modo pixelado de Ink cuantiza a paleta y posterizaba el pasto en manchas planas; se puede volver a él con `?pixel` en la URL.
- **Revelado (CSS):**
  - luz cálida de tarde desde arriba a la izquierda, de donde viene el sol de la escena;
  - desenfoque tilt-shift en las bandas de arriba y de abajo;
  - bruma de distancia arriba del cuadro;
  - viñeta.

## Rendimiento

Son ~144.000 splats reservados: 7 tramos de 18.500, 9.000 de agua y 5.200 de partículas. En Chrome, en esta máquina, corre a ~100 fps con todo sonando en el render suave. Hay menos árboles que antes, pero cada uno tiene más forma. Rearmar un tramo cuesta unos pocos ms y pasa cada ~22 s.

Lo que más costó fue el texto. Una versión anterior dibujaba el código en un canvas encima de la escena con perspectiva por línea, y bajaba a 13 fps. Plantado como splats no cuesta casi nada extra.

Para inspeccionar desde la consola:
- `FOREST.counts()`: splats usados por tramo;
- `FOREST.cam.speed = 0`: frena el dron;
- `FOREST.cam.x = …`: lo lleva a otro lugar;
- `LAYOUT`: columnas del código.

## Audio y créditos

- **Música:** la composición, tocada por Strudel (`@strudel/repl@1.3.0`).
- **Ambiente:** el ambiente del video de referencia (`bosque_horizontal_final_ambiente.wav`), pasado a AAC 128 kb/s. Se reproduce en loop con 3 s de fundido cruzado. Mezcla tres grabaciones de campo, todas CC0 1.0:
  - "Water waves lapping, lake, gentle, close", de TRP (freesound 568819);
  - "Wind(leaves).WAV", de o_ciz (freesound 475448);
  - "Small stream in the woods, Few birds", de fran_marenco (freesound 796191).
- **Aves:** "Forest quiet atmosphere with some birds", de felix.blume (freesound 414098), CC0.
- **Ink Studio:** MIT, vendorizado en `vendor/ink` (ver `vendor/ink/COMMIT` y `LICENSE`).

## Limitaciones conocidas

- La tipografía de 3×5 se lee bien a la distancia normal del dron. Muy alejado (rueda), las letras se vuelven textura.
- Las tildes se plantan sin tilde (COLCHÓN se lee COLCHON).
- Un mismo token puede aparecer en dos copias si el dron está justo en el cruce de vuelta; solo florece la copia que está en un tramo vivo.
