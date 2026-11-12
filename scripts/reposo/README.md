# Fondos de la vista de reposo (pantalla externa)

La pantalla externa (ESP32) muestra un fondo en su vista de reposo. El servidor lo compone a
480x320: la imagen, ampliada, desenfocada y oscurecida, cubre toda la pantalla, y encima va la
imagen entera a la derecha, fundida en óvalo, para que la hora y las barras queden a la izquierda.

De dónde salen las imágenes, por orden:

1. `~/.pixel-agents/oficina/reposo/*.png`: las tuyas. Si hay alguna, solo se usan estas.
2. `scripts/reposo/<tema>/*.png`: las que acompañan al tema de personajes activo
   (por ejemplo `scripts/reposo/yugioh/`).

Sin imágenes en ninguna de las dos, el reposo sale con su diseño de siempre (centrado, sin fondo).

- Formato: PNG, de cualquier tamaño; mejor con la figura centrada. Verticales o cuadradas.
- Cada 10 minutos toca otra, en vueltas barajadas (todas salen una vez antes de repetir).
- Un toque en la vista de reposo, fuera de la franja de arriba, pasa a la siguiente.
- No hace falta reiniciar nada al añadir o quitar imágenes.
