## ¿Qué es un Host de Redirección?

Un Host de Redirección envía a los visitantes de un dominio a otra dirección. Úsalo cuando un sitio cambia de dominio y los enlaces antiguos deben seguir funcionando, o para enviar `www` al nombre principal.

Usa **Clonar** en el menú del host para copiar un host en una nueva ventana de alta. La copia empieza sin los nombres de dominio, porque un dominio solo puede pertenecer a un host habilitado.

### Detalles

- **Nombres de Dominio**: los nombres que se redirigen. Obligatorio. Los comodines solo se permiten para un certificado nuevo con el desafío DNS.
- **Esquema**: el esquema del destino. «mantener (igual que la solicitud)» es el valor por defecto y conserva `http` o `https` de la visita. O elige `http` o `https`.
- **Dominio de Reenvío**: el dominio al que se envía a los visitantes, por ejemplo `example.com`. Obligatorio.
- **Código HTTP**: el código de respuesta. Por defecto 301 Moved permanently. Otras opciones: 302 Moved temporarily, 303 See other, 307 Temporary redirect y 308 Permanent redirect. Usa 301 o 308 cuando el cambio es definitivo; los navegadores y los buscadores lo recuerdan.
- **Grupo**: una etiqueta libre que mantiene ordenadas las listas largas. Elige una en uso o escribe un nombre nuevo.
- **Preservar Ruta** (desactivado por defecto): añade la ruta y la consulta originales al destino. Con ella, `old.example/a?b=1` va a `new.example/a?b=1`. Sin ella, cada visitante llega al inicio del destino.

### TLS

- **Certificado TLS**: Ninguno, Solicitar un certificado nuevo, o uno existente. Las opciones de abajo necesitan un certificado.
- **Certificado mTLS**: una autoridad de certificación de clientes. **Hacer mTLS opcional** deja entrar a los visitantes sin certificado de cliente.
- **Forzar HTTPS**: redirige primero HTTP a HTTPS.
- **Soporte de HTTP/3**: permite HTTP/3 (QUIC).
- **HSTS habilitado (2 años)**: necesita Forzar HTTPS. **HSTS subdominios + preload** necesita HSTS.
- Para un certificado nuevo: **Reutilizar clave (no recomendado)** y **Usar Desafío DNS**, con proveedor, credencial y segundos de propagación.

Todas las opciones TLS están desactivadas por defecto.

### Avanzado

Configuración de nginx propia añadida dentro del bloque server del host. Solo los administradores pueden cambiarla; los demás usuarios la ven en solo lectura.

Más en la wiki: Host options.
