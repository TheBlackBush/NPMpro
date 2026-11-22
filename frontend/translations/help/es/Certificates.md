## Ayuda de Certificados

### Certificado HTTP

Un certificado validado por HTTP significa que los servidores de Certbot
intentarán acceder a tus dominios a través de HTTP (¡no HTTPS!) y, si tienen éxito,
emitirán tu certificado.

Para este método, deberás tener un _Host Proxy_ creado para tu(s) dominio(s) que
sea accesible por HTTP y que apunte a esta instalación de Nginx. Después de que se
haya emitido un certificado, puedes modificar el _Host Proxy_ para que también use
este certificado para conexiones HTTPS. Sin embargo, el _Host Proxy_ seguirá
necesitando estar configurado para acceso HTTP para que el certificado se renueve.

Este proceso _no_ admite dominios comodín.

### Certificado DNS

Un certificado validado por DNS requiere que uses un complemento de Proveedor de DNS.
Este Proveedor de DNS se usará para crear registros temporales en tu dominio y luego
Certbot consultará esos registros para asegurarse de que eres el propietario y,
si tiene éxito, emitirá tu certificado.

No necesitas tener un _Host Proxy_ creado antes de solicitar este tipo de certificado.
Tampoco necesitas tener tu _Host Proxy_ configurado para acceso HTTP.

Este proceso _sí_ admite dominios comodín.

#### Credenciales DNS guardadas

Las credenciales de tu Proveedor de DNS se guardan por separado del certificado, en la
pestaña _Credenciales DNS_ de la página de Certificados. Un certificado solo elige una de las
credenciales guardadas, por lo que varios certificados pueden compartirlas.

Los secretos se almacenan cifrados y nunca se vuelven a mostrar. Al editar una credencial, deja
un secreto vacío para conservar el valor guardado. La clave usada para el cifrado es el archivo
`/data/npmpro/dns-credentials.key`; haz una copia de seguridad junto con la base de datos, de lo contrario
las credenciales guardadas no se podrán leer después de una restauración.

Los proveedores sin formulario usan el cuadro de texto INI, donde pegas el contenido del
archivo de credenciales de ese proveedor.

#### Dominios

Una credencial lista los dominios (zonas DNS) que gestiona, como `example.com`. La pestaña **Dominios** de la página Certificados lista los dominios de todas tus credenciales.

El campo **Nombres de Dominio** sugiere los dominios de tus credenciales DNS y los nombres que ya usan hosts y certificados (los nombres de un stream proceden de su certificado). Se puede escribir cualquier otro nombre: `Añadir <nombre>` aparece primero e Intro añade lo que escribiste.

Con el desafío DNS, la ventana sugiere la credencial DNS cuyos dominios cubren todos los nombres e indica el motivo. Puedes cambiarla en cualquier momento, y una credencial elegida por ti se conserva.

### Certificado Personalizado

Usa esta opción para cargar tu propio Certificado TLS, proporcionado por tu propia
Autoridad de Certificación.

### Autoridad de certificación

Un certificado solicitado a un servidor ACME lo emite la CA elegida en su ventana: la CA de la instancia (marcada como «predeterminada») u otra CA que un administrador añadió en Ajustes, Certificados y TLS, en **Otras CA**. La lista muestra la CA de cada certificado en la columna **CA**. **Reemitir**, en el menú del certificado, lo solicita de nuevo a otra CA con el mismo nombre; si falla, se conserva el certificado actual. **Editar** en un certificado ACME cambia sus nombres de dominio: el certificado se solicita de nuevo con la misma entrada, la ventana avisa de los nombres que aún usan hosts y un fallo no cambia nada.
