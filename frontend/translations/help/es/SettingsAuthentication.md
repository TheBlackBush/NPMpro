## Autenticación

Inicio de sesión en la interfaz web de NPMpro con un proveedor OIDC (por ejemplo Authentik, Keycloak o Google), junto a las contraseñas o en lugar de ellas. Esto no es autenticación delegada: no protege tus hosts proxy. Para eso consulta Configuración, Autenticación delegada.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra «Definido por el entorno»). Si las cuatro variables de conexión están definidas, OIDC está activo sin habilitarlo en la interfaz. Usa la interfaz para todo lo que no esté definido en el contenedor. Todo lo de aquí se aplica al guardar.

### Proveedor

- **Habilitar inicio de sesión con OIDC**: muestra el botón de inicio de sesión en la página de acceso.
- **URL del emisor**: la dirección base de descubrimiento del proveedor, por ejemplo `https://accounts.example.com`. Variable: `OIDC_ISSUER_URL`.
- **ID de cliente** y **Secreto del cliente**: de tu proveedor. El secreto se guarda cifrado y no se vuelve a mostrar; déjalo vacío para conservarlo. Si cambias la URL del emisor o el ID de cliente, introduce el secreto de nuevo. Variables: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.
- **Dominio de redirección**: el dominio que usa la gente para abrir NPMpro, con el puerto si no es 443. Obligatorio, porque con él se construye la URL de callback. Variable: `OIDC_REDIRECT_DOMAIN`.
- **URL de callback**: solo lectura. Regístrala como URI de redirección en tu proveedor.
- **Ámbitos**: por defecto `openid email profile`. Cámbialos si tu proveedor solo permite algunos, por ejemplo `openid email`.
- **Probar conexión**: comprueba que NPMpro puede llegar al emisor.

### Botón de inicio de sesión

El botón de la página de acceso: **Nombre visible** (el texto después de «Iniciar sesión con»), **Color** (un valor predefinido o tu propio `#rrggbb`) e **Icono** (integrado, subido como PNG, JPEG, WebP o SVG de hasta 256 KB, o descargado de una URL). Se muestra una vista previa.

### Reglas de inicio de sesión

- **Exigir un correo verificado**: rechaza a los usuarios cuyo proveedor no ha verificado su correo. Por defecto: activado. Variable: `OIDC_REQUIRE_VERIFIED_EMAIL`.
- **Omitir el segundo factor tras OIDC**: confía en la comprobación multifactor del propio proveedor. Por defecto: desactivado. Variable: `OIDC_SKIP_MFA`.
- **Desactivar inicio de sesión con contraseña**: solo OIDC puede iniciar sesión. Solo puedes activarlo desde una sesión iniciada con OIDC. Variable: `OIDC_DISABLE_PASSWORD`; para restaurar el inicio de sesión con contraseña, ponla en `false` y recrea el contenedor.

### Usuarios nuevos

- **Crear usuarios en su primer inicio de sesión** (por defecto: desactivado): una persona sin cuenta recibe una con los permisos de abajo.
- **Dominios de correo permitidos**: separados por comas; vacío permite cualquier dominio. Con la lista vacía y sin exigir correo verificado, cualquiera que acepte tu proveedor obtiene una cuenta.
- **Permisos predeterminados para usuarios nuevos**: se definen por sección. Los usuarios nuevos nunca son administradores.

Más en la wiki: Authentication.
