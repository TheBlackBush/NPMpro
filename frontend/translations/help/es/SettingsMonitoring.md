## Registros y monitorización

Los archivos de registro, el informe de registros de GoAccess y las estadísticas de tráfico que hay detrás de la página Monitorización.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por LOGROTATE», o «Definido por el entorno» en las estadísticas). Usa la interfaz para todo lo que no esté definido en el contenedor. Los ajustes marcados con «Reinicio necesario» se guardan de inmediato pero se leen al arrancar el contenedor; la sección los lista entonces en «Reinicia el contenedor para aplicar».

### Archivos de registro

- **Escribir archivos de registro**: escribe los registros de errores, de stream y de acceso de nginx en `/data/nginx/logs` y los rota a diario. Por defecto: desactivado. Variable: `LOGROTATE`. Se aplica tras la recarga de nginx que ejecuta el guardado. Se mantiene activado mientras GoAccess está en marcha.
- **Rotaciones de registros conservadas**: cuántos archivos de registro rotados se conservan antes de borrar el más antiguo, de 1 a 1000. Por defecto: 3. Variable: `LOGROTATIONS`. Se aplica de inmediato.

### GoAccess

- **Informe de GoAccess**: ejecuta GoAccess, un informe de registros web para administradores, en `/goaccess` de la interfaz web. Por defecto: desactivado. Variable: `GOA`. Se aplica tras reiniciar el contenedor. No activa las estadísticas de tráfico.

Con el informe activado aparecen estas opciones. Todas se aplican tras reiniciar el contenedor. Una sola variable, `GOACLA`, las sustituye todas por tus propias opciones de GoAccess y las bloquea.

- **Conservar los datos del informe**: de 1 a 366 días. Por defecto: 30.
- **Anonimizar las IP de los visitantes**: Desactivado, Nivel 1 (por defecto), Nivel 2 (fuerte) o Nivel 3 (estricto). El nivel 1 oculta el último byte de IPv4 (los últimos 64 bits de IPv6), el nivel 2 dos bytes (80 bits), el nivel 3 tres bytes (96 bits).
- **Eliminar las cadenas de consulta**: quita las cadenas de consulta de las URL del informe, de modo que los tokens en las URL no se guardan. Por defecto: activado.
- **Versiones completas del sistema operativo**: muestra la versión completa, no solo la familia. Por defecto: activado.
- **Resolver nombres de host**: busca los nombres de host de las IP de los visitantes. Esto envía consultas DNS. Por defecto: activado.

### Monitorización

Estas controlan la pestaña Tráfico de la página Monitorización. Todas se aplican de inmediato al guardar. Variables: `TRAFFIC_STATS`, `TRAFFIC_RETENTION_DAYS`, `TRAFFIC_SHOW_IPS`, `TRAFFIC_UNIQUE_VISITORS`, `TRAFFIC_VISITORS_CAP`.

- **Estadísticas de tráfico**: lee el registro de acceso de nginx y cuenta las peticiones por host, estado, país y red. Por defecto: desactivado. Desactivarlas detiene el nuevo recuento; las estadísticas guardadas permanecen hasta que caducan, salvo que marques «Eliminar también las estadísticas almacenadas» en el cuadro de diálogo.
- **Conservar las estadísticas durante**: de 7 a 365 días. Por defecto: 30. Los datos por minuto se conservan 24 horas, los datos por hora esa cantidad de días.
- **Mostrar las IP de los visitantes**: guarda las IP de los visitantes por hora para listar las IP más frecuentes. Por defecto: desactivado, por privacidad. Desactivarlo elimina las IP guardadas.
- **Contar visitantes únicos**: guarda por host y día un hash con clave de cada IP de visitante para contar visitantes únicos. Por defecto: desactivado. Desactivarlo elimina los hashes.
- **Límite de visitantes por host y día**: de 1000 a 1000000. Por defecto: 100000. Un host que lo alcanza deja de contar nuevos visitantes ese día y muestra un signo más.

Los países y las redes necesitan las bases de datos GeoIP (Configuración, GeoIP).

Más en la wiki: Monitoring.
