# Caja de música

Otra interpretación de la misma composición, con otro concepto: la partitura es **el mecanismo de una caja de música**. Está fotografiada en macro sobre una mesa de nogal, con una lámpara cálida. No hay texto: el código está en las púas.

## Cómo se lee

- **Cada capa es un cilindro.** Cada línea de su mini-notación es un ciclo, así que un cilindro con 16 líneas da una vuelta cada 16 ciclos.
- **Cada nota es una púa:**
  - su **ángulo** sale de en qué momento del ciclo suena. La mini-notación se subdivide como en Strudel: en `[e5 f#5 b4 e5]` cada nota ocupa un cuarto; en `~ [b5 e6] ~ ~`, b5 cae en ¼ y e6 en ⅜;
  - su **lugar a lo largo del cilindro** sale de qué nota es: las notas distintas de la capa se reparten de grave a agudo.
  - Los silencios (`~`) no tienen púa.
- **Frente a cada cilindro hay un peine** con un diente por nota distinta, más largo cuanto más grave.
- **Los cilindros giran con el reloj de Strudel** (`scheduler.now()`): una púa pasa por su diente justo cuando suena. Sin música, giran muy despacio.
- **Lo que suena** (los rangos activos de Strudel) enciende la púa con el color de su capa y hace vibrar y brillar el diente. Cada evento suelta unas chispas desde la punta del diente.
- **Material por capa:**

| Capa | Cilindro |
| --- | --- |
| MOTIVO PRINCIPAL | Bronce |
| ARPEGIO INFERIOR | Cobre |
| GRAN COLCHÓN | Plata |
| DRONE PROFUNDO | Hierro |
| NUBE AGUDA | Vidrio |
| ECOS CASI COMO SONAR | Acero |
| CHISPAS / REFLEJOS | Oro |
| MASA DE RUIDO RESPIRANDO | Madera |
| RUIDO AGUDO | Cristal |
| PULSOS SUBGRAVES | Laca negra |

El tamaño del cilindro sigue a su cantidad de ciclos, y su largo, a la cantidad de notas distintas.

## Cómo correrlo

```sh
cd caja-de-musica
python3 build.py
python3 -m http.server 47233
```

Abrir `http://127.0.0.1:47233/`. Click para arrancar, `Espacio` para tocar o detener, arrastrar para girar alrededor de la caja, rueda para acercar, `Shift+C` para ver el código, `Shift+F` para pantalla completa.

## Cómo está hecho (`caja.js`)

- **Ink Studio**, render suave. Todo se escribe directo en splats reservados:
  - lo fijo: mesa de tablones con veta, panel del fondo con filete de bronce, bases y soportes de cada cilindro, bloque del peine;
  - lo que gira: duelas, ranuras, engranajes de las tapas, púas y dientes, que se reescriben cada cuadro;
  - las partículas: polvo en el haz de la lámpara y chispas.
- **El cilindro está hecho de duelas,** splats largos a lo largo del eje, angostos alrededor y finos en la normal. Así se lee como metal torneado y no como escamas. Al girar, cada duela recalcula su covarianza y su luz: difusa más un brillo especular según el ángulo.
- **Las púas y los dientes** son splats alargados en la dirección radial.
- **Tiempos de la mini-notación:** `barTimes()` arma el árbol de secuencias y grupos `[...]` de cada línea y le asigna a cada token su comienzo dentro del ciclo.
- **Del código al mecanismo:** cada púa guarda el rango de offsets de su token; los rangos activos de Strudel y los eventos encuentran la púa por offset.
- **Rendimiento:** ~54.000 splats, de los cuales ~12.000 se reescriben cada cuadro. Corre a ~120 fps en Chrome, en esta máquina.

Para inspeccionar desde la consola: `CAJA.counts()` (ciclos, púas y notas distintas por cilindro) y `CAJA.st.clock` (el ciclo actual de Strudel).
