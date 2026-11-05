## Usuarios

Las personas que pueden iniciar sesión en este NPMpro. Solo los administradores ven esta lista. También se puede iniciar sesión con un proveedor OIDC, que se configura en Configuración, Autenticación.

La lista muestra el nombre, el correo, los roles y el estado de cada usuario. Busca por nombre o correo y ordena por una columna.

### Añadir o editar un usuario

**Añadir Usuario** pide el **Nombre Completo** y la **Dirección de correo electrónico**. Editar abre la misma ventana, donde también puedes subir o quitar el avatar del usuario. En **Opciones**:

- **Administrador**: acceso completo, incluidos Configuración, Usuarios y Registros de Auditoría. Sin esta opción el usuario es un Usuario Estándar, limitado por los permisos de abajo.
- **Deshabilitado**: el usuario ya no puede iniciar sesión y sus sesiones abiertas terminan.

No puedes cambiar tus propios roles, deshabilitarte ni eliminarte, y tu propia fila solo ofrece Editar.

### Menú de la fila

Para las demás cuentas:

- **Permisos**: ver abajo.
- **Establecer Contraseña**: fija una contraseña nueva. Se cierra la sesión del usuario en todos los demás dispositivos.
- **Restablecer MFA**: solo para usuarios que tienen MFA. La desactiva sin código de recuperación y el usuario puede volver a configurarla.
- **Revocar sesiones**: cierra la sesión del usuario en todos sus dispositivos.
- **Deshabilitar** o **Habilitar**: lo mismo que la opción **Deshabilitado**.
- **Eliminar**: borra la cuenta. Sus entradas en los Registros de Auditoría permanecen.

### Permisos

Para un Usuario Estándar, elige por sección (Hosts Proxy, Hosts de Redirección, Hosts 404, Streams, Listas de Acceso, Certificados): **Gestionar**, **Solo Ver** u **Oculto**. **Visibilidad de Elementos** decide si el usuario ve **Todos los Elementos** o **Solo Elementos Creados**.

Una elección también activa lo que la sección necesita: los Hosts Proxy necesitan Listas de Acceso y Certificados, y Oculto no está disponible mientras otra sección necesite esa. Los administradores tienen acceso a todo, así que para ellos solo se ofrece la visibilidad de elementos.

Más en la wiki: Usage (Users and permissions) y Authentication.
