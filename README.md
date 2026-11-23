# Visualizador

Colección de visualizadores para composiciones de [Strudel](https://strudel.cc). Cada uno es una carpeta autocontenida con su música, su escena y su documentación.

| Visualizador | Temática | Técnica |
| --- | --- | --- |
| [`sonar/`](sonar/README.md) | Marina nocturna: anillo de siete monolitos, uno por nota de Mi menor, más un blob central que frena la música. Ambient en Mi menor | Ink Studio (splats gaussianos pixel-art, WebGL2) + código dibujado en la escena |
| [`sonar-v2/`](sonar-v2/README.md) | Sonar + ballena voladora en voxels que danza con los subgraves, faro lejano con haz giratorio, luna, vía láctea y fotografía cinematográfica | Igual que sonar + modelo en voxels animado por splats (vuelo, rolido, cola y aletas) |
| [`sonar-v3/`](sonar-v3/README.md) | Sonar v2 con una yubarta de escamas finas, sombreado suave y batida vertical de cola; sin barras de capas | Igual que v2, con voxels de 0,038 y normales suavizadas |
| [`archipielago/`](archipielago/README.md) | Segunda interpretación: un mapa grabado donde las notas levantan islas, los ecos sondean el agua y los subgraves mueven la marea. Las curvas de nivel están rotuladas con el código que suena | Canvas 2D: campo de alturas, marching squares, texto sobre curvas |
| [`bosque/`](bosque/README.md) | Campiña de tarde estilo dibujo animado vista desde un dron, basada en el video "bosque horizontal final". El código está plantado con flores en prados del bosque (color por sintaxis) y lo que suena florece; entre prado y prado, una escena distinta: arroyo, campos, lago, aldea, estanque, árbol grande, lavanda, bahía, pinar. Con el ambiente del video | Ink Studio con terreno por tramos + tipografía propia de 3×5 hecha de splats |
| [`bosque-maqueta/`](bosque-maqueta/README.md) | Bosque como maqueta de tren a escala. La partitura no está escrita: cada token es un objeto que suena (campanillas, hongos, faroles, piedras, tambores, molinetes) cuya altura sigue a la nota y que se enciende y se mueve al sonar. Tren de vapor, figuritas, tilt-shift fuerte | Igual que bosque + objetos por token, tren y figuras como partículas |
| [`caja-de-musica/`](caja-de-musica/README.md) | La partitura como mecanismo de caja de música: un cilindro con púas por capa (el ángulo de cada púa es su momento del ciclo, su lugar es su nota), girando con el reloj de Strudel frente a un peine que vibra al sonar. Foto macro con luz de lámpara | Ink Studio: cilindros de duelas que giran, mini-notación → tiempos de púa |

## En vivo

- Índice: https://franpiaggio.github.io/visualizador/
- Sonar: https://franpiaggio.github.io/visualizador/sonar/
- Sonar v2: https://franpiaggio.github.io/visualizador/sonar-v2/
- Sonar v3: https://franpiaggio.github.io/visualizador/sonar-v3/
- Archipiélago: https://franpiaggio.github.io/visualizador/archipielago/
- Bosque: https://franpiaggio.github.io/visualizador/bosque/
- Bosque maqueta: https://franpiaggio.github.io/visualizador/bosque-maqueta/
- Caja de música: https://franpiaggio.github.io/visualizador/caja-de-musica/

Se publica con GitHub Pages desde la rama `main` (raíz). Un click en la escena arranca la música.

## Correr uno

```sh
cd <visualizador>
python3 build.py
python3 -m http.server 47219
```

Abrir `http://127.0.0.1:47219/`.

## Convenciones para sumar uno nuevo

Cada visualizador vive en su propia carpeta y no depende de las otras: copiar una carpeta tiene que alcanzar para que funcione.

```
<nombre>/
├── README.md        concepto, controles, mapeo capa → visual, arquitectura, limitaciones
├── compo.strudel    la composición
├── template.html    esqueleto, con {{CODE}} donde va la compo
├── build.py         genera index.html
├── index.html       generado
├── main.js          puente Strudel → visual
└── vendor/          dependencias copiadas (con su LICENSE y versión/commit)
```

Patrón para engancharse a Strudel (ver `sonar/main.js`):

1. Usar `<strudel-editor>` de `@strudel/repl` con el código como comentario HTML dentro.
2. Tomar `el.editor` (StrudelMirror) y envolver su `onDraw`. Llamar primero al original para conservar el resaltado y después leer los haps nuevos (`hasOnset`, `whole.begin <= time`).
3. Usar `hap.context.locations` para saber qué parte del código generó cada evento.
