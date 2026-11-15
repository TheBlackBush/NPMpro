## CrowdSec

Conecta el bouncer de CrowdSec integrado en NPMpro con su contenedor de CrowdSec. Cada solicitud a sus hosts se comprueba con las decisiones de la API local de CrowdSec (LAPI) y, con una URL de AppSec, con las reglas de AppSec. Al guardar, los ajustes se aplican de inmediato con una recarga de nginx; el contenedor no se reinicia.

NPMpro escribe `/data/crowdsec/crowdsec.conf` a partir de estos ajustes. Los cambios manuales en ese archivo se sobrescriben. Las páginas de bloqueo y de captcha se eligen en **Configuración**, **Páginas de destino**, donde también se puede pegar o subir una página personalizada.

Una variable definida en el contenedor prevalece sobre la interfaz y bloquea el campo: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### Estado y Probar conexión

Muestra si nginx carga el bouncer y cuándo llegó NPMpro por última vez a la LAPI. **Probar conexión** comprueba los valores del formulario: una solicitud de decisiones a la LAPI con la clave (o el certificado de cliente TLS) y, con una URL de AppSec, una solicitud a AppSec. Un campo de clave vacío usa la clave guardada.

Al guardar con el bouncer activado se ejecuta primero la misma prueba. Si falla, se muestran los motivos y **Guardar de todos modos** guarda igualmente, por ejemplo cuando CrowdSec aún no está en marcha.

**Guardar de todos modos** no se ofrece cuando AppSec falla, **Cuando no se puede acceder a AppSec** está en **Denegar la solicitud** y **Interfaz de administración y CrowdSec** está en **Comprobada como todos los hosts**, porque ese guardado le dejaría fuera de la interfaz de administración: corrija la **Clave de API** o la **URL de AppSec**, cambie la acción en caso de fallo a **Dejar pasar la solicitud**, o elija **Solo bloqueos** o **Excluida** en **Interfaz de administración y CrowdSec**.

### Conexión

- **Activar el bouncer**: comprueba cada solicitud.
- **URL de la LAPI**: por ejemplo `http://127.0.0.1:8080`.
- **Clave de API**: de `docker exec crowdsec cscli bouncers add npmpro`. Se guarda cifrada y no se vuelve a mostrar. **Eliminar la clave guardada** la borra.
- **Certificado de cliente TLS**: en lugar de la clave, un archivo de certificado y uno de clave en `/data/crowdsec/`; requiere una URL de LAPI con `https://`. Cuando se define una URL de AppSec, el campo **Clave de API** se muestra y es obligatorio también con un certificado de cliente TLS, porque AppSec se autentica con la clave de API; sin ella AppSec rechaza todas las solicitudes.
- **Verificar certificados TLS**: comprueba el certificado de una URL https de la LAPI o de AppSec.

### Bloqueo

- **Modo**: live consulta a la LAPI por cada IP de cliente y guarda la respuesta en caché durante los segundos indicados; stream descarga todas las decisiones en el intervalo indicado.
- **Respuesta a un bloqueo**: la página de bloqueo (con un código de estado opcional, 403 por defecto), una redirección o un código de estado sin página.
- **Medida alternativa** y **Tipos de decisión**: cómo se tratan las decisiones que el bouncer no puede aplicar y qué tipos se aplican.
- **Interfaz de administración y CrowdSec**: **Comprobada como todos los hosts** aplica bloqueos y AppSec a la interfaz de administración. **Solo bloqueos** aplica bloqueos y captchas pero no AppSec, y una caída de CrowdSec no le deja fuera. **Excluida** no comprueba nada. ¿Se ha quedado fuera por una decisión de bloqueo o de captcha? Vea **¿Se ha quedado fuera?** más abajo.

### Captcha

El proveedor (reCAPTCHA, hCaptcha, Cloudflare Turnstile), su clave del sitio y su clave secreta, y cuánto tiempo sigue siendo válido un captcha resuelto. Se usa para decisiones de tipo captcha.

### AppSec

- **URL de AppSec**: por ejemplo `http://127.0.0.1:7422`; vacío desactiva AppSec.
- **Cuando no se puede acceder a AppSec**: denegar bloquea todas las solicitudes comprobadas mientras AppSec no esté disponible; dejar pasar las deja sin comprobar.

### Avanzado

El tiempo de espera de las solicitudes a la LAPI, los filtros de escenarios, las rutas excluidas, las solicitudes internas y los tiempos de espera y opciones de AppSec.

### ¿Se ha quedado fuera?

Una decisión de bloqueo o de captcha para su IP: ejecute `cscli decisions delete --ip <su IP>` en el contenedor de CrowdSec. Una decisión de una lista de bloqueo (la lista de la comunidad o una lista de la consola de CrowdSec) vuelve con la siguiente descarga, así que añada también su IP a una allowlist (CrowdSec 1.6.6 o posterior): `cscli allowlists create npmpro-admins -d "admin IPs"` y después `cscli allowlists add npmpro-admins <su IP>`.

CrowdSec no está disponible: vuelva a iniciarlo. Sin acceso a CrowdSec: defina `CROWDSEC_ENABLED=false` en el contenedor y vuelva a crearlo, elija aquí **Excluida** para **Interfaz de administración y CrowdSec** (o elimine la decisión), corrija los ajustes y después quite la variable y vuelva a crear el contenedor.

Más en la wiki: CrowdSec.
