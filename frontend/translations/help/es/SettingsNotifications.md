## Notificaciones

NPMpro envía el correo a través de un servidor SMTP que tú eliges. De momento el correo se usa para el correo de prueba y más adelante para restablecer contraseñas y para alertas. Los ajustes de aquí también pueden venir de variables del contenedor: una variable definida en el contenedor prevalece sobre la interfaz y bloquea su campo (el campo muestra "Definido por el entorno"). Usa la interfaz para todo lo que no esté definido en el contenedor.

### Servidor de correo

Cada conexión se comprueba como las demás solicitudes salientes: el nombre del servidor debe resolverse y se rechazan las direcciones locales y link-local. El correo se considera configurado cuando el host y la dirección del remitente están rellenos.

- **Host** y **Puerto**: el servidor SMTP. Variables: `SMTP_HOST`, `SMTP_PORT` (587 por defecto).
- **Seguridad**: **STARTTLS** convierte una conexión sin cifrar en cifrada (normalmente el puerto 587), **TLS** va cifrado desde el principio (normalmente el puerto 465), **Ninguna** envía sin cifrado. Variable: `SMTP_SECURITY` (`starttls`, `tls` o `none`).
- **Verificar certificado**: rechaza un servidor cuyo certificado no es válido. Variable: `SMTP_VERIFY_TLS` (`false` lo desactiva).
- **Usuario** y **Contraseña**: el inicio de sesión. La contraseña se guarda cifrada y no se vuelve a mostrar; **Quitar** la elimina, y si la guardada no se puede descifrar, escríbela de nuevo. Variables: `SMTP_USERNAME`, `SMTP_PASSWORD`.
- **Nombre del remitente** y **Dirección del remitente**: cómo aparece el correo de NPMpro. Variables: `SMTP_FROM_NAME`, `SMTP_FROM`.
- **Responder a**: adónde van las respuestas; vacío usa la dirección del remitente. Variable: `SMTP_REPLY_TO`.

Con la seguridad **Ninguna** y un usuario, la contraseña viajaría sin cifrar, así que solo se permite con un servidor de tu red local.

**Enviar correo de prueba** envía un correo con los ajustes guardados a la dirección que escribas (la tuya por defecto) y muestra la respuesta del servidor si falla. Guarda primero: el botón está desactivado mientras el formulario tenga cambios sin guardar, y oculto hasta que el correo esté configurado.

### Enlaces e idioma

- **URL pública**: la dirección con la que las personas abren NPMpro, usada para los enlaces de los correos, por ejemplo `https://npm.example.com`. Solo HTTPS, sin ruta. **Usar la dirección de este navegador** la rellena con la dirección de esta página cuando se abre por HTTPS. Variable: `PUBLIC_URL`.
- **Idioma del correo por defecto**: el idioma de los correos para las personas que no han elegido uno. El idioma de interfaz de cada usuario se recuerda y se usa para sus correos. Variable: `MAIL_LANGUAGE`.

Más en la wiki: Configuration.
