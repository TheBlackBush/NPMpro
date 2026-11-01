## Certificados y TLS

Valores por defecto de los certificados que NPMpro solicita a tu servidor ACME (Let's Encrypt, salvo que definas otro con `ACME_SERVER`), de cómo se grapan (stapling) y se renuevan, y de qué certificado responde a los hosts desconocidos. Esta es la sección de Configuración, no la página de lista de Certificados.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por ACME_KEY_TYPE»). Algunos campos siguen a otro: un `ACME_KEY_SIZE` solo que es una curva ECDSA mantiene el tipo de clave en ECDSA, y Must-Staple mantiene activado el OCSP stapling. Usa la interfaz para todo lo que no esté definido en el contenedor.

### Solicitudes de certificado

Se aplican desde la próxima solicitud de certificado.

- **Tipo de clave**: `ECDSA` (por defecto, recomendado: claves más pequeñas, handshakes más rápidos) o `RSA` para clientes que no pueden usar ECDSA. Variable: `ACME_KEY_TYPE`.
- **Tamaño de clave**: la curva para ECDSA (`secp256r1`, `secp384r1`, `secp521r1`; por defecto `secp384r1`) o los bits para RSA (`2048`, `3072`, `4096`; por defecto `4096`). Variable: `ACME_KEY_SIZE`.
- **Perfil ACME**: el perfil solicitado al servidor, comprobado con el servidor al guardar. Vacío usa el valor por defecto del servidor. Con Let's Encrypt el valor por defecto es `shortlived`; los clientes que necesitan un Common Name no funcionan con certificados `shortlived` y `tlsserver`. Variable: `ACME_PROFILE` (`none` para vacío).
- **OCSP Must-Staple**: marca los certificados nuevos como must-staple y mantiene activado el OCSP stapling. Solo para las CA que lo admiten (ZeroSSL); Let's Encrypt rechaza esas solicitudes. Por defecto: activado para Google Trust Services y ZeroSSL, y desactivado en los demás casos. Variable: `ACME_MUST_STAPLE`.
- **Verificar el certificado del servidor ACME**: activado por defecto. Desactívalo solo para un servidor ACME privado con certificado autofirmado. Variable: `ACME_SERVER_TLS_VERIFY`.

### Stapling

Ambos se aplican tras la recarga de nginx que ejecuta el guardado, y ambos desactivan la compresión de certificados TLS.

- **OCSP stapling para certificados ACME**: envía la respuesta OCSP con los certificados del servidor ACME, cuando la CA ofrece OCSP. Por defecto: activado para Google Trust Services y ZeroSSL, y desactivado en los demás casos. Variable: `ACME_OCSP_STAPLING`.
- **OCSP stapling para certificados personalizados**: lo mismo para los certificados subidos. Por defecto: desactivado. Variable: `CUSTOM_OCSP_STAPLING`.

### Certificado predeterminado

- **Certificado para hosts desconocidos y la interfaz web**: se sirve para los nombres de host para los que NPMpro no tiene host y en el puerto de la interfaz web. Por defecto: integrado, un marcador de posición generado. Variable: `DEFAULT_CERT_ID` (un ID de certificado; `0` es el integrado). Se aplica tras la recarga de nginx que ejecuta el guardado.

### Renovación

- **Intervalo de comprobación de renovación**: de 1 a 499 horas entre comprobaciones. Un certificado solo se renueva cuando toca. Por defecto: 3. Variable: `CERTBOT_RUN_INTERVAL`. Se aplica de inmediato.

### ECH

- **Intervalo de rotación de claves ECH**: de 1 a 24 horas entre ejecuciones de tu script ECH (`/data/tls/ech/cron.sh`). Solo se usa si el script no está vacío. Por defecto: 1. Variable: `ECH_ROTATION_INTERVAL`. Se aplica de inmediato.

Más en la wiki: Security.
