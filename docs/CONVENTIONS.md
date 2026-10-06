# Convenciones de trabajo con el asistente

1. Todo bloque de comandos empieza con `cd` al directorio correcto.
2. Toda edición se entrega como comando ejecutable (heredoc, sed, tee).
3. No se asume el `pwd` del usuario.
4. Verificar paquetes/APIs contra fuentes reales antes de proponer código.
5. Un paso por mensaje: comando -> output -> siguiente comando.
6. Sin código inventado. Si algo no está verificado, se marca como PENDIENTE.

## Entorno
- Dispositivo: Android + Termux
- Navegador: Titanium
- Red: DNS inestable, GitHub directo falla a veces -> usar proxy
- Proxy HTTP usado: https://api.allorigins.win/raw?url=<URL_ENCODED>
