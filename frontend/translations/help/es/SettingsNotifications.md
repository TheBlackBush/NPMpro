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

### Alertas por correo

Se muestran una vez configurado un servidor de correo. Correos sobre los problemas que NPMpro detecta y sobre cuándo se resuelven; un problema que sigue abierto se repite.

- **Enviar a los administradores**: cada administrador activado con una dirección válida recibe las alertas.
- **Enviar también a**: más direcciones, como máximo 20, por ejemplo una lista de equipo. Una dirección rechazada se marca en su etiqueta. Variable: `ALERT_ADDRESSES` (separadas por comas).
- **Eventos**: marca los problemas sobre los que quieres recibir correo, agrupados por área. Marcar uno también cubre su resolución.
- **Recordar cada (horas)**: cuánto tiempo permanece en silencio un problema antes de enviarlo de nuevo; 0 no lo repite nunca, como máximo 168.

**Enviar un ejemplo** envía al instante una alerta de ejemplo, con los ajustes guardados, a todos los que recibirían alertas. Guarda primero: el botón está desactivado mientras el formulario tenga cambios sin guardar. Si un envío falla, el mensaje indica la dirección.

### Enlaces e idioma

- **URL pública**: la dirección con la que las personas abren NPMpro, usada para los enlaces de los correos, por ejemplo `https://npm.example.com`. Solo HTTPS, sin ruta. **Usar la dirección de este navegador** la rellena con la dirección de esta página cuando se abre por HTTPS. Variable: `PUBLIC_URL`.
- **Idioma del correo por defecto**: el idioma de los correos para las personas que no han elegido uno. El idioma de interfaz de cada usuario se recuerda y se usa para sus correos. Variable: `MAIL_LANGUAGE`.

### Invitaciones y avisos de cuenta

Ambos necesitan un servidor de correo. Las invitaciones necesitan además la **URL pública**.

- **Invitaciones**: al añadir un usuario puedes enviar una invitación en lugar de establecer una contraseña. El usuario recibe un correo con un enlace para elegir una contraseña; el enlace funciona una sola vez y durante 72 horas. **Reenviar invitación** en la lista de usuarios envía un enlace nuevo.
- **Avisos de cuenta**: los usuarios reciben un correo cuando cambia su contraseña o su dirección, cuando se desactiva el inicio de sesión en dos pasos o cuando se generan nuevos códigos de respaldo.

### Webhooks

Un webhook es una dirección tuya a la que NPMpro llama con una petición HTTP firmada cuando ocurre algo, por ejemplo cuando se renovó un certificado. Solo los administradores ven esta tarjeta.

- **URL**: `https://` a cualquier host público, o `http://` a una dirección de tu red local. No se siguen las redirecciones. La dirección se guarda cifrada y no se vuelve a mostrar; deja el campo vacío al editar para conservarla.
- **Eventos**: elige los eventos que enviar, o **Todos los eventos**.
- **Secreto de firma**: se muestra una sola vez al guardar. Guárdalo donde lo lea tu receptor. **Renovar secreto** crea uno nuevo; el anterior sigue firmando durante 24 horas para que tu receptor pueda cambiar.
- **Enviar prueba**: envía al instante un evento de prueba y muestra el estado y el tiempo que tardó. No aparece en Envíos.
- **Envíos**: los últimos eventos del webhook con su estado, intentos y la respuesta del receptor. **Reenviar** vuelve a enviar uno fallido, hasta 7 días después del fallo.
- Una petición fallida se reintenta hasta 8 veces durante unas 41 horas. Un webhook se desactiva cuando el receptor responde 410 Gone, o cuando falla de nuevo tras 3 días de fallos sin ningún éxito. Un webhook desactivado muestra el motivo; actívalo para volver a usarlo.
- Verifica cada petición con cualquier biblioteca de Standard Webhooks, con el cuerpo sin modificar y el `webhook-id` como clave de idempotencia.

Más en la wiki: Configuration.
