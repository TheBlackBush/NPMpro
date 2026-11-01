## GeoIP

NPMpro descarga por sí mismo las bases de datos gratuitas MaxMind GeoLite2 y busca países y redes en tu servidor, de modo que las IP de los visitantes nunca se envían a ningún sitio. No necesitas un contenedor geoipupdate aparte. Las bases de datos alimentan el mapa y las listas de Monitorización, GoAccess y las reglas de país de nginx.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra «Definido por el entorno»). Usa la interfaz para todo lo que no esté definido en el contenedor. Al guardar se inicia la descarga en segundo plano, y el estado de abajo se actualiza cuando termina.

### Cuenta de MaxMind

Necesitas una cuenta gratuita de MaxMind y una clave de licencia (en MaxMind: Account, Manage license keys). En la página hay un enlace para registrarte.

- **ID de cuenta**: variable `GEOIP_ACCOUNT_ID`.
- **Clave de licencia**: se guarda cifrada y no se vuelve a mostrar. Si la clave guardada no se puede descifrar, introdúcela de nuevo. Variable: `GEOIP_LICENSE_KEY`.

### Bases de datos

- **GeoLite2 Country**: países para el mapa, las listas de países y las reglas de país de nginx. Activada por defecto.
- **GeoLite2 ASN**: redes (número y nombre de AS) para las listas de redes. Activada por defecto.
- **GeoLite2 City**: opcional, ciudades para GoAccess. Una descarga mucho mayor. Desactivada por defecto.

Variable: `GEOIP_EDITIONS`, separadas por espacios, por ejemplo `GeoLite2-Country GeoLite2-ASN`. Si no hay ninguna base de datos seleccionada, no se descarga ni se actualiza nada, y las bases de datos ya descargadas se conservan.

### Estado

Muestra la última actualización y el último error. NPMpro actualiza las bases de datos cuando cambias la cuenta o las bases de datos, cuando haces clic en **Actualizar ahora**, y automáticamente cada 3 días. Una actualización automática fallida se reintenta tras 24 horas. **Actualizar ahora** necesita un ID de cuenta y una clave de licencia guardados.

Sin bases de datos, el mapa y las listas de países y redes quedan ocultos; el resto funciona.

Más en la wiki: Monitoring.
