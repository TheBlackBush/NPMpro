## Páginas de destino

Las páginas que ven los visitantes en lugar de un sitio: cuando no hay nada configurado para una dirección, no se encuentra una página, el servidor detrás de un host no responde, una lista de acceso los rechaza, un host está en mantenimiento, falta un certificado o CrowdSec los bloquea o los comprueba. Cada página aparece en el idioma del navegador del visitante, en claro y en oscuro.

### Página predeterminada

Lo que muestra una dirección sin host: **Página de Felicitaciones**, **Página 404**, **Sin Respuesta (444)**, **Redirigir** (a una dirección que indiques) o **HTML Personalizado** (tu propia página).

### Páginas globales

Para cada página: su página de NPMpro (por ejemplo **Página de error 404** o **Página «Acceso denegado»**) o una **Página personalizada**. Una página personalizada es un archivo HTML (de 1 MB como máximo, UTF-8) con sus estilos e imágenes dentro; pégalo o usa **Subir .html**. Puede mostrar la IP del visitante, la hora, el código de estado y el nombre del host con `<!--# echo var="remote_addr" -->`, `date_gmt`, `status` y `host`; las demás inclusiones del lado del servidor se rechazan.

Los hosts proxy, los hosts 404 y las listas de acceso usan estas páginas salvo que elijan las suyas (la pestaña **Páginas** de un host proxy, el campo **Página** de un host 404, **Denegado** de una lista de acceso).

**Vista previa** abre la página guardada en una pestaña nueva con valores de ejemplo.

### CrowdSec

Configuración, CrowdSec decide si un bloqueo muestra una página, redirige o solo responde con un código de estado; esta sección decide cómo se ven las páginas de bloqueo y de captcha.
