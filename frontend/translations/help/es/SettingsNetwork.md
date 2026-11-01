## Red

Indica a NPMpro de qué proxies situados delante puede fiarse respecto a la dirección real del cliente. Sin esto, los registros, las listas de acceso y CrowdSec ven la dirección del proxy, no la del visitante.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por TRUST_IP»). Usa la interfaz para todo lo que no esté definido en el contenedor.

- **IP de proxy de confianza**: una dirección IPv4 o IPv6 o un rango CIDR por línea, por ejemplo `10.0.0.0/8`, `192.168.1.5` o `fd00::/8`. Las peticiones de estas direcciones pueden pasar la IP real del cliente en `X-Forwarded-For`. Úsalo para un balanceador de carga o un túnel justo delante de NPMpro. Por defecto: vacío (no se confía en nadie). Variable: `TRUST_IP` (separadas por espacios). Se aplica tras la recarga de nginx que ejecuta el guardado.
- **Confiar en Cloudflare**: obtiene los rangos de IP de Cloudflare, los actualiza con regularidad y confía en ellos, de modo que nginx ve las IP reales de los clientes detrás de Cloudflare. Por defecto: desactivado. Variable: `TRUST_CLOUDFLARE`. Se aplica tras la recarga de nginx que ejecuta el guardado. Lee antes las notas sobre Cloudflare en la wiki (Security): poner Cloudflare delante de NPMpro tiene costes de privacidad y seguridad.

Confía solo en direcciones que controles o en las que confíes plenamente. Una dirección de confianza puede hacerse pasar por cualquier visitante.

Si al guardar falla la prueba de nginx, no se guarda nada y se muestra el mensaje de nginx.

Más en la wiki: Security.
