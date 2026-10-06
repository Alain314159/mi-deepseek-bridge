# Extensión Mi DeepSeek Bridge

## Cómo instalarla (Titanium Browser en Android)

1. Descargá el ZIP del repo (`https://github.com/Alain314159/mi-deepseek-bridge/archive/refs/heads/main.zip`).
2. Extraélo en tu teléfono.
3. Abrí Titanium → menú → "Extensiones" → "Modo desarrollador".
4. "Cargar extensión sin empaquetar" → elegí la carpeta `extension/`.
5. Abrí `https://chat.deepseek.com` y deberías ver el botón flotante ▶ abajo a la derecha.

## Cómo funciona

- Detecta bloques de código en las respuestas de DeepSeek.
- Inyecta un botón "▶ Ejecutar" al lado del bloque.
- Al tocarlo, el comando se envía por postMessage al iframe de la PWA.
- La PWA lo ejecuta en Nodepod (git, node, npm, shell).
- El resultado vuelve y se inyecta en el textarea del chat.
