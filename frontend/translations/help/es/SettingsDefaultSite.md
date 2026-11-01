## Sitio Predeterminado

El sitio predeterminado es lo que nginx responde cuando un visitante llega a NPMpro con un nombre de host que ningún host usa, o con la dirección IP del servidor. Elige aquí la respuesta. Se aplica a todos los nombres desconocidos.

Al guardar, primero se prueba la nueva elección con nginx. Si la prueba falla, no se guarda nada, se mantiene el sitio predeterminado anterior y el error de nginx queda en el registro del contenedor.

- **Página de Felicitaciones** (por defecto): muestra la página de bienvenida de NPMpro.
- **Página 404**: responde con una página 404 Not Found.
- **Sin Respuesta (444)**: cierra la conexión sin ninguna respuesta. Úsalo para no mostrar nada a los escáneres. Las peticiones HTTPS a nombres desconocidos se rechazan durante el handshake TLS.
- **Redirigir**: envía a los visitantes a otra dirección con una redirección temporal (302). Introduce una URL completa `http://` o `https://` sin espacios, comillas ni `; { } #`, de hasta 255 caracteres.
- **HTML Personalizado**: muestra tu propia página HTML. El **Código de estado HTTP** de debajo es opcional, de 400 a 599. Déjalo vacío para 200 (OK).

Con cualquier opción salvo Sin Respuesta, las peticiones a nombres desconocidos por HTTP simple se redirigen primero a HTTPS, y las peticiones HTTPS usan el certificado elegido como **Certificado predeterminado** en Configuración, Certificados y TLS.

Esta sección no tiene variables de entorno, así que el cambio se aplica al guardar.
