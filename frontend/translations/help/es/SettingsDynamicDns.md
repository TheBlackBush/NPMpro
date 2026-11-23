## DNS dinámico

Cómo NPMpro mantiene los registros de la pestaña DNS dinámico (Certificados) apuntando a su dirección pública. No se comprueba nada hasta que se activa un registro.

Una variable definida en el contenedor prevalece sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como "Definido por DDNS_PERIOD"). Usa la interfaz para todo lo que no esté definido en el contenedor.

- **Comprobar cada**: con qué frecuencia se comprueban los registros, de `1m` a `24h` (por ejemplo `5m` o `1h30m`). Por defecto: `5m`. Variable: `DDNS_PERIOD`. Un cambio reinicia el temporizador.
- **Tiempo de espera**: el tiempo mínimo entre dos escrituras de un registro, en el mismo formato. Por defecto: `5m`. Variable: `DDNS_COOLDOWN`.
- **Servicios de dirección IPv4** y **Servicios de dirección IPv6**: URL `https://` que responden con la dirección pública. Una dirección nueva solo se escribe cuando dos servicios coinciden. Los servicios IPv6 solo se consultan mientras un registro activado necesite IPv6. Variables: `DDNS_IPV4_SERVICES`, `DDNS_IPV6_SERVICES` (separadas por espacios). Se rechaza un servicio cuya dirección el servidor no puede llamar (una dirección privada o local).
- **Servidores DNS**: los servidores usados para resolver los servicios de dirección y los proveedores. Vacío usa los resolutores del contenedor. Una dirección IPv4, o una dirección IPv6 entre corchetes, con un puerto opcional. Variable: `DDNS_RESOLVER` (separados por espacios).

Los registros se añaden en la pestaña DNS dinámico con una credencial DNS de un proveedor que pueda actualizar registros.
