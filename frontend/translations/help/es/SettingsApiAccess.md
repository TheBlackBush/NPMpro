## Acceso a la API

Todos los tokens de API de todos los usuarios. Solo los administradores ven esta página.

Los propietarios crean los tokens en el menú de usuario, en **Tokens de API**. Aquí ves cada token con su propietario, sus permisos, cuándo caduca, cuándo se usó por última vez y cuándo se creó.

- **Revocar** detiene un token al instante. Los scripts y asistentes de IA que lo usan reciben un error de autenticación desde ese momento.
- Un token nunca tiene más permisos que su propietario. El token de un administrador actúa como administrador solo con su interruptor **Administrador**, y ningún token gestiona usuarios.
- La creación, la revocación, la caducidad y el primer uso de un token se registran en el registro de auditoría, con el nombre del token junto al usuario.

La documentación de la API se abre en una pestaña nueva.
