## Copia de seguridad y restauración

Guarda tus hosts, certificados, usuarios y ajustes en un archivo `.npmpro`, y restáuralo en esta instancia de NPMpro o en otra. Las estadísticas de tráfico y los registros nunca forman parte de una copia de seguridad.

### Crear copia de seguridad

- **Qué incluir**: partes como hosts, listas de acceso, certificados, credenciales DNS, usuarios, ajustes y archivos personalizados. Al principio están todas marcadas.
- **Incluir secretos**: añade claves privadas, contraseñas, secretos de segundo factor, los valores de las credenciales DNS, el secreto de cliente de OIDC y la clave de licencia de GeoIP. El archivo se cifra con una **Frase de contraseña** de al menos 12 caracteres, que introduces dos veces. NPMpro no la guarda, así que sin ella la copia no se puede restaurar.
- Sin secretos el archivo no se cifra y deja fuera los secretos. Aun así contiene nombres de host, usuarios y ajustes, así que mantenlo privado.
- **Descargar** guarda el archivo en tu equipo. **Conservar en el servidor** lo guarda en `/data/backups`.

### Copias de seguridad programadas

Añade programaciones que hacen copias por sí solas y las guardan en el servidor.

- **Cuándo**: cada N horas, a diario, cada semana o cada mes, en la zona horaria del contenedor.
- **Protección**: **Frase de contraseña** (se restaura en cualquier sitio), **Clave de la instancia** (nada que recordar, solo se restaura en esta instancia) o **Sin secretos**.
- **Conservar**: cuántos archivos de esta programación se conservan. Los más antiguos se borran tras cada ejecución correcta.
- Una programación se puede ejecutar ahora, pausar, editar o eliminar. Una ejecución fallida se muestra en la programación y en el panel.

Las copias programadas te protegen de cambios erróneos, no de perder el disco. Para eso copia los archivos a otra máquina.

### Copias de seguridad guardadas

Lista los archivos del servidor. Descárgalos, restáuralos o elimínalos, o usa **Subir copia de seguridad**. NPMpro hace una copia **Automática** antes de cada restauración, fusión y traslado de base de datos; no necesita frase de contraseña y solo se restaura en esta instancia.

### Restauración

- **Reemplazar** cambia las partes que elijas en esta instancia por las de la copia. Tu propia cuenta nunca se reemplaza.
- **Fusionar** añade los elementos de la copia y no elimina nada. Muestra una vista previa y te deja elegir en cada conflicto: omitir, usar el elemento existente, añadir como nuevo o reemplazar.

Una restauración se deshace si nginx rechaza el resultado. Una copia de una versión más reciente de NPMpro no se puede restaurar. Algunos ajustes restaurados necesitan reiniciar el contenedor.

Esta sección no tiene variables de entorno.

Más en la wiki: Backup-and-restore.
