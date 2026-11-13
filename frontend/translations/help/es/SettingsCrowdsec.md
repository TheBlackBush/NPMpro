## CrowdSec

Conecta el bouncer de CrowdSec integrado en NPMpro con su contenedor de CrowdSec. Cada solicitud a sus hosts se comprueba con las decisiones de la API local de CrowdSec (LAPI) y, con una URL de AppSec, con las reglas de AppSec. Al guardar, los ajustes se aplican de inmediato con una recarga de nginx; el contenedor no se reinicia.

NPMpro escribe `/data/crowdsec/crowdsec.conf` a partir de estos ajustes. Los cambios manuales en ese archivo se sobrescriben. `ban.html` y `captcha.html` de la misma carpeta puede editarlos usted.

Una variable definida en el contenedor prevalece sobre la interfaz y bloquea el campo: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Estado y Probar conexión

Muestra si nginx carga el bouncer y cuándo llegó NPMpro por última vez a la LAPI. **Probar conexión** comprueba los valores del formulario: una solicitud de decisiones a la LAPI con la clave (o el certificado de cliente TLS) y, con una URL de AppSec, una solicitud a AppSec. Un campo de clave vacío usa la clave guardada.

Al guardar con el bouncer activado se ejecuta primero la misma prueba. Si falla, se muestran los motivos y **Guardar de todos modos** guarda igualmente, por ejemplo cuando CrowdSec aún no está en marcha.

### Conexión

- **Activar el bouncer**: comprueba cada solicitud.
- **URL de la LAPI**: por ejemplo `http://127.0.0.1:8080`.
- **Clave de API**: de `docker exec crowdsec cscli bouncers add npmpro`. Se guarda cifrada y no se vuelve a mostrar. **Eliminar la clave guardada** la borra.
- **Certificado de cliente TLS**: en lugar de la clave, un archivo de certificado y uno de clave en `/data/crowdsec/`; requiere una URL de LAPI con `https://`.
- **Verificar certificados TLS**: comprueba el certificado de una URL https de la LAPI o de AppSec.

### Bloqueo

- **Modo**: live consulta a la LAPI por cada IP de cliente y guarda la respuesta en caché durante los segundos indicados; stream descarga todas las decisiones en el intervalo indicado.
- **Respuesta a un bloqueo**: la página de bloqueo (con un código de estado opcional, 403 por defecto), una redirección o un código de estado sin página.
- **Medida alternativa** y **Tipos de decisión**: cómo se tratan las decisiones que el bouncer no puede aplicar y qué tipos se aplican.
- **Excluir la interfaz de administración de CrowdSec**: las solicitudes a la interfaz de administración omiten el bouncer y AppSec. Actívelo antes de usar AppSec con denegar, para que una caída de CrowdSec no pueda dejarle fuera.

### Captcha

El proveedor (reCAPTCHA, hCaptcha, Cloudflare Turnstile), su clave del sitio y su clave secreta, y cuánto tiempo sigue siendo válido un captcha resuelto. Se usa para decisiones de tipo captcha.

### AppSec

- **URL de AppSec**: por ejemplo `http://127.0.0.1:7422`; vacío desactiva AppSec.
- **Cuando no se puede acceder a AppSec**: denegar bloquea todas las solicitudes comprobadas mientras AppSec no esté disponible; dejar pasar las deja sin comprobar.

### Avanzado

El tiempo de espera de las solicitudes a la LAPI, los filtros de escenarios, las rutas excluidas, las solicitudes internas, los tiempos de espera y opciones de AppSec, y los archivos de las páginas de bloqueo y de captcha con una **Vista previa**.

### ¿Se ha quedado fuera?

Inicie CrowdSec de nuevo, o defina `CROWDSEC_ENABLED=false` en el contenedor y vuelva a crearlo; después corrija los ajustes aquí.

Más en la wiki: CrowdSec.
