# Bosque maqueta

Una variante de [Bosque](../bosque/README.md) fotografiada como una **maqueta de tren a escala**. Acá el código ya no está escrito: la partitura es una **instalación de objetos que suenan**.

## La partitura como jardín de objetos

Cada token musical del código es un objeto, puesto en el mismo lugar que ocupa en el texto (línea → hilera, posición → columna). Los tokens son lo que está dentro de la mini-notación o de un patrón entre comillas. El resto del código (funciones, paréntesis, comentarios) no se dibuja; se puede ver con `Shift+C`. El claro del bosque se abre solo donde hay objetos.

| Token | Objeto |
| --- | --- |
| Nota del MOTIVO PRINCIPAL | Campanilla: tallo con hoja y flor |
| Nota del ARPEGIO INFERIOR | Hongo de sombrero de color; los graves son más anchos |
| Nota del GRAN COLCHÓN | Farol en un poste |
| Nota del DRONE PROFUNDO | Piedra parada, más grande cuanto más grave |
| Nota de la NUBE AGUDA | Farolito de papel colgado de un hilo, alto |
| Nota de ECOS | Campana de bronce en un poste |
| Nota de CHISPAS | Frasco de luciérnagas |
| Nota de PULSOS SUBGRAVES | Tambor rojo con parche |
| `~` (silencio) | Piedrita |
| `noise` | Molinete de cuatro aspas de colores |
| Número en un patrón (`lpf("<500 800>")`, `pan(...)`) | Poste de madera; su altura sigue al valor |
| `"piano"`, `"sine"`, `"sawtooth"`… | Pabellón con techo del color de la capa |
| `[ ... ]` | Cantero con borde de madera y tierra |

En las notas, la **altura del objeto sigue a la altura de la nota** y el **color sigue a la clase de nota**, con una rueda de doce tonos de juguete. Así, mirando un cantero, se ve la melodía.

**Cuando suena:** el objeto se enciende en el color de su capa y se mueve. Las campanillas, hongos y faroles rebotan como un resorte (más arriba, más se mueven), el molinete gira y el parche del tambor vibra. Al dejar de sonar vuelven despacio a su color y a su lugar. Del motivo y el arpegio salen luciérnagas.

## Sin círculos grandes

- **Agua:** el render dibuja cada splat como un disco de borde duro, y si dos vecinos tienen colores distintos se ven los círculos. Por eso el agua tiene un color casi parejo dentro de cada cuerpo (el arroyo, uno solo; los lagos, una rampa muy suave con la profundidad), y su movimiento es un cambio de brillo lento y amplio, igual para splats vecinos. La orilla se dibuja con una grilla fina de puntos diminutos que sigue el contorno real, y cerca del agua el pasto también va en discos chicos que no la pisan: así el borde es una línea limpia y no una fila de bolas azules. No hay brillos, espumas ni anillos.
- **Sin recuadros ni resplandores ovalados** alrededor de lo que suena: ahora se encienden los objetos mismos.
- **La vía no domina:** es una franja angosta de balasto color tierra, con durmientes cortos y oscuros y dos rieles finos. La orilla y la vía se dibujan con discos chicos (con discos grandes aparecían medias lunas y manchas), y el puente es de tablones.
- **Sin nubes:** una maqueta de mesa no las tiene, y de cerca eran manchones blancos.

## Qué cambia respecto de Bosque

- **El camino es una vía férrea:** balasto gris, durmientes de madera y dos rieles que brillan. Cruza el arroyo por su puente y corre justo debajo de los prados del código.
- **Un tren de juguete:** una locomotora de vapor verde y cuatro vagones (rojo, crema, azul y amarillo), con los techos en un tono más claro del vagón. Cruza el cuadro cada ~40 s, siguiendo las curvas de la vía, con su sombra y su humo. Los `PULSOS SUBGRAVES` le arrancan un pitazo de vapor, y con el `GRAN COLCHÓN` se encienden las ventanas.
- **Figuritas:** diez personitas con camisas de colores caminan al costado de la vía, con su sombra.
- **Fotografía de miniatura:**
  - la cámara está más cerca y más oblicua (lente macro) y el encuadre baja para que la vía caiga en la zona nítida;
  - el desenfoque tilt-shift es fuerte (6 px) y deja una banda nítida angosta, un poco por debajo del centro;
  - los colores son de juguete: más saturación y contraste.

Las escenas entre prados, los árboles, el arroyo y el ambiente del video son los de Bosque, documentados en su [README](../bosque/README.md).

## Cómo correrlo

```sh
cd bosque-maqueta
python3 build.py
python3 -m http.server 47232
```

Abrir `http://127.0.0.1:47232/`.

Para inspeccionar desde la consola, además de lo de Bosque: `FOREST.tune.trainAt = FOREST.view().x` fija el tren en cuadro y `FOREST.tune.trainAt = undefined` lo devuelve a su recorrido.

## Rendimiento

Corre a ~108 fps con todo sonando en Chrome, en esta máquina. El tren y las figuritas son partículas que se reescriben cada cuadro (unos 600 splats).
