## nginx

Ajustes del propio nginx que se aplican a todos los hosts: cuántos workers se ejecutan, reglas de TLS y módulos opcionales. Al guardar se prueba la configuración y se recarga nginx. Una configuración que no pasa la prueba no se aplica.

Una variable definida en el contenedor tiene prioridad sobre la interfaz y bloquea el campo (el campo muestra una insignia de candado como «Definido por NGINX_WORKER_PROCESSES»). Usa la interfaz para todo lo que no esté definido en el contenedor. Cada ajuste de aquí se aplica tras la recarga de nginx que ejecuta el guardado.

### Workers

- **Procesos worker**: «Automático (uno por hilo de CPU)» o un número hasta los hilos de CPU que ve el contenedor. Por defecto: uno por hilo, como máximo 4. Variable: `NGINX_WORKER_PROCESSES`.
- **Conexiones por worker**: conexiones abiertas que cada worker atiende a la vez, de 64 a 65535. Por defecto: 512. Variable: `NGINX_WORKER_CONNECTIONS`.
- **Tiempo de apagado de los workers**: cuánto tiempo conservan sus conexiones los workers antiguos tras una recarga. Un valor de tiempo de nginx como `30s`, `10m` o `1h`; `0` significa sin límite. Por defecto: `1h`. Variable: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Registro

- **Registrar errores de archivo no encontrado**: escribe una línea de error por cada petición de un archivo que falta. Por defecto: desactivado. Variable: `NGINX_LOG_NOT_FOUND`.

### TLS para todos los hosts

Desactivar TLS 1.2 o las curvas NIST P deja fuera a los navegadores y clientes más antiguos. TLS 1.3 siempre está activado.

- **Permitir TLS 1.2**: activado por defecto. Variable: `NGINX_DISABLE_TLS12` (invertida: `true` desactiva TLS 1.2).
- **Solo intercambio de claves poscuántico**: permite solo X25519MLKEM768, que necesita un cliente reciente. Desactiva TLS 1.2 y las curvas NIST P y las bloquea mientras está activado. Por defecto: desactivado. Variable: `NGINX_FORCE_X25519MLKEM768`.
- **Permitir las curvas NIST P**: secp521r1, secp384r1 y prime256v1 para el intercambio de claves, junto a X25519. Por defecto: activado. Variable: `NGINX_TRUST_SECPR1`.
- **Permitir firmas RSA PKCS#1**: para clientes antiguos que no pueden usar RSA-PSS. Por defecto: desactivado. Variable: `NGINX_TRUST_RSA_PKCS1`.

### Módulos

Todos están desactivados por defecto. Activa un módulo solo cuando una configuración personalizada tuya lo necesite. Desactivar uno mientras una configuración personalizada aún lo usa hace que falle la prueba de nginx.

- **njs (JavaScript)**: directivas `js_*`. Variable: `NGINX_LOAD_NJS_MODULE`.
- **Autenticación LDAP**: directivas `auth_ldap`. Variable: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreams NTLM**: `ntlm` en bloques upstream. Variable: `NGINX_LOAD_NTLM_MODULE`.
- **Estado del tráfico de hosts virtuales**: directivas `vhost_traffic_status_*`. Variable: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Más en la wiki: Configuration.
