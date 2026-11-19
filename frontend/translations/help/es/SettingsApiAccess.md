## Acceso a la API

Todos los tokens de API de todos los usuarios. Solo los administradores ven esta página.

Los propietarios crean los tokens en el menú de usuario, en **Tokens de API**. Aquí ves cada token con su propietario, sus permisos, cuándo caduca, cuándo se usó por última vez y cuándo se creó.

- **Revocar** detiene un token al instante. Los scripts y asistentes de IA que lo usan reciben un error de autenticación desde ese momento.
- Un token nunca tiene más permisos que su propietario. El token de un administrador actúa como administrador solo con su interruptor **Administrador**, y ningún token gestiona usuarios.
- La creación, la revocación, la caducidad y el primer uso de un token se registran en el registro de auditoría, con el nombre del token junto al usuario.

**Documentación de la API** abre en una pestaña nueva la referencia de la API de cada endpoint y muestra el encabezado en el que se envía un token. **Servidor MCP** muestra el endpoint, la configuración para Claude Code y para Claude Desktop y otros clientes, y las herramientas que un token puede usar.
