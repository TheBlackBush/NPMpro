## Autenticación delegada

La autenticación delegada pone un inicio de sesión o una comprobación de bots delante de un host proxy. Para cada petición, nginx pregunta primero a un servicio de autenticación si el visitante puede pasar. NPMpro lo incluye para Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia y Authentik. El proveedor lo ejecutas tú en su propio contenedor.

Esta página fija la dirección por defecto (upstream) de cada proveedor. Un host proxy activa la comprobación con **Auth Request** en Opciones de su pestaña Detalles (o en una ubicación personalizada).

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por AUTH_REQUEST_AUTHELIA_UPSTREAM»). Usa la interfaz para todo lo que no esté definido en el contenedor. Cada ajuste de aquí se aplica tras la recarga de nginx que ejecuta el guardado. Si la prueba de nginx falla, no se guarda nada.

### Upstreams por defecto

- **Upstream de Anubis**, **Upstream de Tinyauth**, **Upstream de OAuth2 Proxy**, **Upstream de VoidAuth**, **Upstream de Authelia**, **Upstream de Authentik**: los usan los hosts proxy con ese proveedor que no tienen upstream propio. El valor propio de un host tiene prioridad. Por defecto: vacío (ninguno). Variables: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

Formato: `scheme://host:port`, por ejemplo `http://127.0.0.1:9091`, o `scheme://cu_name` para tu propio bloque upstream de nginx cuyo nombre empieza por `cu_`. Usa `http` o `https`; el puerto es obligatorio; una dirección IPv6 va entre corchetes. Sin ruta, sin espacios y sin ninguno de `; { } # " ' $ \`.

No puedes vaciar un valor por defecto mientras haya hosts proxy que usen ese proveedor sin upstream propio. El mensaje lista esos hosts.

Un host que usa un proveedor sin upstream definido en ningún sitio recibe un «Config error».

### Anubis

- **Imágenes personalizadas de Anubis**: muestra tus propios `happy.webp`, `reject.webp` y `pensive.webp` en las páginas de desafío de Anubis. Por defecto: activado cuando existen los tres archivos y no están vacíos, y desactivado en los demás casos. Variable: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. Las imágenes van en `public/anubis` de tu carpeta de datos.

Más en la wiki: Forward-Authentication.
