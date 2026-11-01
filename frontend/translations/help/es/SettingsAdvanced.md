## Avanzado

Ajustes que cambian en pequeño el comportamiento de NPMpro.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por TZ»). Usa la interfaz para todo lo que no esté definido en el contenedor.

- **Zona horaria**: la zona horaria del contenedor. Fija las horas en los registros, el informe de GoAccess y las tareas programadas como las copias de seguridad programadas. Usa un nombre como `Europe/Berlin`. Por defecto: `UTC`. Variable: `TZ`. Se aplica tras reiniciar el contenedor: al guardar se almacena, y la sección la lista en «Reinicia el contenedor para aplicar».
- **Formatear las configuraciones de nginx**: da formato a las configuraciones que escribe NPMpro, con nginxbeautifier. Desactívalo si falla con configuraciones personalizadas o avanzadas no estándar. Por defecto: activado. Variable: `DISABLE_NGINX_BEAUTIFIER` (invertida: `true` desactiva el formato). Se aplica de inmediato.
- **Fotos de perfil de Gravatar**: muestra la imagen de Gravatar de los usuarios que no tienen un avatar subido. Para obtener una imagen, NPMpro envía a Gravatar un hash de la dirección de correo del usuario, así que desactívalo si eso te importa. Por defecto: activado. Variable: `DISABLE_GRAVATAR` (invertida: `true` lo desactiva). Se aplica de inmediato; la imagen de un usuario cambia en su próximo guardado de perfil, y las imágenes ya obtenidas permanecen hasta entonces.
