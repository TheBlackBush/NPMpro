## ¿Qué es una lista de acceso?

Una lista de acceso protege hosts proxy. Puede pedir a los visitantes un nombre de usuario y una contraseña (autenticación Basic), permitir o denegar visitantes por dirección IP, o ambas cosas. Sirve para servicios que no tienen inicio de sesión propio, o cuando quieres mantener fuera a los clientes desconocidos.

Una misma lista puede usarse en muchos hosts proxy y ubicaciones.

### Detalles

- **Nombre**: obligatorio.
- **Satisfacer Cualquiera** (desactivado por defecto): un visitante entra cuando cumple una sola comprobación, una regla o un usuario válido. Desactivado significa que debe pasar ambas. También omite un Auth Request en ese host.
- **Pasar Autenticación al Upstream** (desactivado por defecto): envía la cabecera `Authorization` del visitante al servicio. Desactivado mantiene el inicio de sesión privado dentro de NPMpro.

### Autorizaciones

Añade nombres de usuario y contraseñas. Los nombres de usuario deben ser únicos dentro de la lista y no pueden contener `:`. Al editar una lista, deja vacía una contraseña guardada para conservarla.

### Reglas

Las reglas permiten o deniegan una dirección IP, un rango CIDR (`192.168.1.0/24`, `2001:db8::/32`) o `unix:`. Se aplican en el orden en que las listas, y gana la primera coincidencia. Pon primero las reglas específicas. Una regla final `all` cierra la lista, en permitir o denegar; solo se añade si hay al menos otra regla. Una lista necesita al menos un usuario o una regla.

### Uso en hosts proxy

En un host proxy, elige la lista en **Listas de acceso globales** de la pestaña Detalles: **Accesible Públicamente** (sin lista) o **Personalizada**. Una ubicación personalizada puede usar **Global** (las listas del host), **Accesible Públicamente** o sus propias listas **Personalizada**.

Puedes asociar varias listas a un host o ubicación. Se comprueban de arriba abajo, en el orden mostrado, y puedes moverlas hacia arriba y hacia abajo. **Satisfacer Cualquiera** y **Pasar Autenticación al Upstream** solo cuentan en la primera lista. Con CrowdSec, las IP bloqueadas ven la página de bloqueo antes de la petición de contraseña.

Más en la wiki: Host options.
