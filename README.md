# Mi DeepSeek Bridge

Puente entre el chat de DeepSeek web y un entorno Linux que corre dentro del navegador (Shiro + WebAssembly).

## Arquitectura

- **Extensión de navegador**: lee las respuestas de DeepSeek y detecta comandos
- **PWA con Shiro**: ejecuta los comandos en un Linux virtual (WASM)
- **Comunicación**: BroadcastChannel entre las dos pestañas

## Sin Termux, sin tokens de API.

## Estado

🚧 En desarrollo
