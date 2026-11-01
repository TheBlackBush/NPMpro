## ¿Qué es un Host Proxy?

Un Host Proxy es la puerta de entrada de un servicio web. Los visitantes abren tu dominio en NPMpro, y NPMpro reenvía la petición al servicio que hay detrás. También puede añadir TLS (HTTPS) para servicios que no lo tienen. Los Hosts Proxy son el uso más común de NPMpro.

Usa **Clonar** en el menú del host para copiar un host en una nueva ventana de alta. La copia empieza sin los nombres de dominio, porque un dominio solo puede pertenecer a un host habilitado.

### Detalles

- **Nombres de Dominio**: los nombres que usan los visitantes. Obligatorio. Para un certificado nuevo, los comodines (`*.example.com`) necesitan el desafío DNS.
- **Esquema**: cómo habla NPMpro con el servicio: `http://`, `https://`, `grpc://`, `grpcs://`, `path` (servir archivos o PHP desde una carpeta) o `empty` (sin upstream). Por defecto `http://`. Un cambio de esquema desactiva las opciones que no le corresponden.
- **Nombre de host / IP / ruta de reenvío**: la dirección del servicio. Puedes añadir una subruta, por ejemplo `127.0.0.1/path`. Con `path`, introduce en su lugar una carpeta. Monta tus archivos bajo `/var/www`; solo los administradores pueden usar una carpeta fuera de ella. Un nombre que empieza por `cu_` apunta a tu propio bloque upstream de nginx (consulta Load balancing en la wiki).
- **Puerto**: opcional. Con `path` es la versión de PHP.
- **Grupo**: una etiqueta libre que mantiene ordenadas las listas largas.
- **Opciones** (todas desactivadas por defecto):
  - **Enviar la cabecera noindex y bloquear algunos user agents de bots**: pide a los buscadores que no indexen el sitio y bloquea algunos rastreadores.
  - **Desactivar CrowdSec AppSec**: desactiva CrowdSec AppSec solo para este host. Solo tiene efecto si AppSec está configurado.
  - **Desactivar el búfer de solicitudes** y **Desactivar el búfer de respuestas**: para upstreams http y https. Deja el búfer activado salvo que transmitas en streaming o subas archivos grandes por un enlace rápido y estable. Desactivar el búfer de solicitudes también desactiva AppSec.
  - **Activar la compresión en el upstream**: deja que el servicio comprima sus propias respuestas. Déjalo desactivado salvo que el servicio lo necesite. No para `path` ni `empty`.
  - **Activar fancyindex**: muestra un listado de archivos cuando una carpeta no tiene archivo de índice. Solo para `path`.
- **X-Frame-Options**: `SAMEORIGIN` (por defecto), `DENY`, `none` (quita la cabecera) o `upstream` (conserva lo que envía el servicio).
- **Auth Request**: pone un inicio de sesión o una comprobación de bots delante del host (Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik). Por defecto `none`. **Upstream de Auth Request** es opcional; vacío usa el valor por defecto de Configuración, Autenticación delegada.
- **Listas de acceso globales**: **Accesible Públicamente** (por defecto, sin inicio de sesión) o **Personalizada**, una o varias listas de acceso.

Los websockets siempre están activados.

### Ubicaciones Personalizadas

Una ubicación envía una ruta del host (por ejemplo `/api/`) a otro servicio. Cada una tiene **Habilitado**, una ruta con un tipo de coincidencia opcional (`=`, `~`, `~*`, `^~` o `@`), su propio esquema, host, puerto, opciones, Auth Request y listas de acceso. Su lista de acceso puede ser **Global**, que usa las listas del host. No hereda el Auth Request del host. Añade una barra final a una ruta salvo que quieras coincidencia por prefijo. Los administradores pueden añadir configuración de nginx propia por ubicación con el botón del engranaje.

### TLS

- **Certificado TLS**: Ninguno, Solicitar un certificado nuevo, o uno existente. Las opciones de abajo necesitan un certificado.
- **Certificado mTLS**: una autoridad de certificación de clientes. **Hacer mTLS opcional** deja entrar a los visitantes sin certificado. **mTLS omite Auth Request** deja que los visitantes con un certificado válido se salten el Auth Request.
- **Forzar HTTPS** redirige HTTP a HTTPS. **Soporte de HTTP/3** permite HTTP/3 (QUIC).
- **HSTS habilitado (2 años)**: necesita Forzar HTTPS. **HSTS subdominios + preload** necesita HSTS.
- Para un certificado nuevo: **Reutilizar clave (no recomendado)** y **Usar Desafío DNS**, con proveedor, credencial y segundos de propagación.

### Avanzado

Configuración de nginx propia para todo el host (bloque server) y para la ubicación principal `location /`. Solo los administradores pueden cambiarla.

Más en la wiki: Host options.
