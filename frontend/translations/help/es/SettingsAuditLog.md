## Registros de Auditoría

Un historial de quién cambió qué. Solo lo ven los administradores.

Cada entrada muestra el usuario, el objeto y la acción. Se registran:

- **Creado**, **Actualizado** y **Eliminado** para hosts proxy, hosts de redirección, hosts 404, streams, listas de acceso, certificados, credenciales DNS, programaciones de copia de seguridad y usuarios. Los ajustes solo registran **Actualizado**.
- **Habilitado** y **Deshabilitado** para hosts proxy, hosts de redirección, hosts 404, streams y programaciones de copia de seguridad.
- Copias de seguridad: **Creado**, **Subido**, **Eliminado**, **Restaurado** y **Fusionado** para una copia, y **Copia de seguridad correcta** y **Copia de seguridad fallida** en las ejecuciones programadas.
- **Descargado** para certificados. **Exportado** e **Importado** para la copia de una sola página (hosts, listas de acceso, certificados, credenciales DNS).
- Traslados de la base de datos: **Movido** y **Error al mover**.

Las entradas más recientes van primero. **Cargar más** muestra las 50 siguientes, y el número bajo la lista indica cuántas están cargadas del total.

### Encontrar una entrada

- **Buscar** examina los detalles de todas las entradas, así que un nombre de dominio o una dirección de correo encuentra sus entradas.
- **Tipo de objeto**, **Acción** y **Usuario** acotan la lista. Se combinan entre sí y con la búsqueda.
- Con un filtro o una búsqueda activos, la lista indica cuántas entradas se muestran. **Borrar filtros** los quita todos.

### Detalles

El botón del ojo de una fila (**Ver Detalles**) abre la entrada: el usuario, lo que ocurrió y los datos guardados con ella. En un cambio, es el objeto tal como se guardó. Los valores largos se ajustan a la línea y la ventana se desplaza.

Un usuario eliminado después aparece como **Usuario eliminado**. NPMpro nunca borra entradas por sí mismo, y el registro de auditoría no forma parte de una copia de seguridad.

Más en la wiki: Usage (Audit Logs).
