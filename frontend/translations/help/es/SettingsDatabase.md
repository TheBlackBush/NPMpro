## Base de datos

La base de datos en la que NPMpro guarda sus hosts, certificados, usuarios, registros y estadísticas. Por defecto es SQLite, un solo archivo, y es la opción recomendada. Desde aquí puedes trasladarlo todo a MySQL, MariaDB, PostgreSQL o un archivo SQLite nuevo. La base de datos en uso no se modifica con un traslado.

### Base de datos en uso

Muestra el motor y la versión, dónde está, su tamaño y el **Origen** de la conexión: **Predeterminado** (el archivo SQLite `/data/npmpro/database.sqlite`), **Archivo de configuración de la base de datos** (`/data/npmpro/database.json`, escrito por un traslado) o **Entorno** (variables `DB_MYSQL_*` o `DB_POSTGRES_*`). Tras un traslado indica cuándo y desde qué motor te trasladaste.

### Tablas

Cada tabla con sus filas y su tamaño. La tarjeta se puede contraer.

### Trasladar a otra base de datos

Crea antes en tu servidor una base de datos vacía y un usuario que pueda crear tablas; NPMpro no crea la base de datos. Requisitos: MySQL 8.0, MariaDB 10.6 o PostgreSQL 13 o posterior.

1. Elige el **Motor** e introduce **Host**, **Puerto**, **Nombre de la base de datos**, **Usuario** y **Contraseña**. Activa **Usar TLS** si el servidor lo requiere (con MySQL y MariaDB también puedes **Comprobar el certificado del servidor** y **Comprobar el nombre del servidor**). Un traslado a SQLite no necesita nada: crea un archivo nuevo en `/data/npmpro`.
2. **Probar conexión**. Comprueba la versión, que la base de datos esté vacía y que el usuario pueda crear tablas. No cambia nada.
3. **Mover**, escribe la palabra que se te pide y haz clic en **Mover ahora**.

NPMpro pausa los cambios, hace una copia de seguridad de seguridad, crea las tablas, copia y comprueba cada fila y luego se reinicia sobre la base de datos nueva. Tus sitios siguen sirviéndose. La página se recarga cuando NPMpro vuelve a responder, y puede que tengas que iniciar sesión de nuevo.

Si un paso falla, NPMpro se queda en la base de datos que usaba y la ventana indica el paso que se detuvo. La base de datos antigua nunca se elimina, así que puedes volver atrás: quita `/data/npmpro/database.json` y reinicia el contenedor.

Si la conexión viene de variables `DB_MYSQL_*` o `DB_POSTGRES_*`, la sección es de solo lectura. Para trasladar, haz una copia de seguridad, apunta las variables a la base de datos nueva, reinicia y restaura la copia.

Más en la wiki: Database.
