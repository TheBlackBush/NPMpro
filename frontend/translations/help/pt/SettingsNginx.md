## nginx

Definições do próprio nginx que se aplicam a todos os hosts: quantos workers executa, regras TLS e módulos opcionais. Ao guardar, a configuração é testada e o nginx é recarregado. Uma configuração que falhe o teste não é aplicada.

Uma variável definida no contentor tem prioridade sobre a interface e bloqueia o campo (o campo mostra um selo com cadeado, como "Definido por NGINX_WORKER_PROCESSES"). Use a interface para tudo o que não esteja definido no contentor. Todas as definições aqui se aplicam após o reload do nginx que o guardar executa.

### Workers

- **Processos worker**: "Automático (um por thread de CPU)" ou um número até aos threads de CPU que o contentor vê. Predefinição: um por thread, no máximo 4. Variável: `NGINX_WORKER_PROCESSES`.
- **Ligações por worker**: ligações abertas que cada worker trata ao mesmo tempo, de 64 a 65535. Predefinição: 512. Variável: `NGINX_WORKER_CONNECTIONS`.
- **Tempo limite de encerramento dos workers**: durante quanto tempo os workers antigos mantêm as suas ligações após um reload. Um valor de tempo do nginx como `30s`, `10m` ou `1h`; `0` significa sem limite. Predefinição: `1h`. Variável: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### Registo

- **Registar erros de ficheiro não encontrado**: escreve uma linha no registo de erros por cada pedido de um ficheiro em falta. Predefinição: desativado. Variável: `NGINX_LOG_NOT_FOUND`.

### TLS para todos os hosts

Desativar o TLS 1.2 ou as curvas NIST P deixa de fora browsers e clientes mais antigos. O TLS 1.3 está sempre ativado.

- **Permitir TLS 1.2**: predefinição ativado. Variável: `NGINX_DISABLE_TLS12` (invertida: `true` desativa o TLS 1.2).
- **Apenas troca de chaves pós-quântica**: permite apenas X25519MLKEM768, que precisa de um cliente recente. Desativa o TLS 1.2 e as curvas NIST P e bloqueia-os enquanto estiver ativada. Predefinição: desativado. Variável: `NGINX_FORCE_X25519MLKEM768`.
- **Permitir as curvas NIST P**: secp521r1, secp384r1 e prime256v1 para a troca de chaves, a par do X25519. Predefinição: ativado. Variável: `NGINX_TRUST_SECPR1`.
- **Permitir assinaturas RSA PKCS#1**: para clientes antigos que não conseguem usar RSA-PSS. Predefinição: desativado. Variável: `NGINX_TRUST_RSA_PKCS1`.

### Módulos

Todos desativados por predefinição. Ative um módulo só quando uma configuração personalizada sua precisar dele. Desativar um enquanto uma configuração personalizada ainda o usa faz o teste do nginx falhar.

- **njs (JavaScript)**: diretivas `js_*`. Variável: `NGINX_LOAD_NJS_MODULE`.
- **Autenticação LDAP**: diretivas `auth_ldap`. Variável: `NGINX_LOAD_LDAP_MODULE`.
- **Upstreams NTLM**: `ntlm` em blocos upstream. Variável: `NGINX_LOAD_NTLM_MODULE`.
- **Estado de tráfego dos hosts virtuais**: diretivas `vhost_traffic_status_*`. Variável: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

Mais na wiki: Configuration.
