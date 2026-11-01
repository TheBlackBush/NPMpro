## Environment

A read-only list of the variables that NPMpro reads when the container starts. You cannot change them here. To change one, edit your compose file or container template and recreate the container.

Values of passwords, email addresses and keys are never shown. You only see whether they are set or not.

- **Settings set by environment variables**: the settings that a variable currently locks in Settings, with the variable and the section. Remove the variable to manage that setting in the UI again.
- **Variable groups**: startup variables such as ports, bindings, users, TLS and nginx switches, modules and PHP, the database and first start, and the certificate account. Each row shows the variable, its value or default, a status (set, or not set) and a description. Some variables are also settings; their row says "setting".

More in the wiki: Configuration.
