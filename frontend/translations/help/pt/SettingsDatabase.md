## Base de dados

A base de dados onde o NPMpro guarda os seus hosts, certificados, utilizadores, registos e estatísticas. Por predefinição é o SQLite, um único ficheiro, e é a escolha recomendada. Pode mover tudo para MySQL, MariaDB, PostgreSQL ou um novo ficheiro SQLite a partir daqui. A base de dados em uso não é alterada por uma mudança.

### Base de dados em uso

Mostra o motor e a versão, onde está, o seu tamanho e a **Origem** da ligação: **Predefinição** (o ficheiro SQLite `/data/npmpro/database.sqlite`), **Ficheiro de definições da base de dados** (`/data/npmpro/database.json`, escrito por uma mudança) ou **Ambiente** (variáveis `DB_MYSQL_*` ou `DB_POSTGRES_*`). Depois de uma mudança indica quando e de que motor mudou.

### Tabelas

Todas as tabelas com as suas linhas e tamanho. O cartão pode ser recolhido.

### Mover para outra base de dados

Crie primeiro no seu servidor uma base de dados vazia e um utilizador que possa criar tabelas; o NPMpro não cria a base de dados. Requisitos: MySQL 8.0, MariaDB 10.6 ou PostgreSQL 13 ou mais recentes.

1. Escolha o **Motor** e introduza **Host**, **Porta**, **Nome da base de dados**, **Utilizador** e **Palavra-passe**. Ative **Usar TLS** se o servidor o exigir (para MySQL e MariaDB também pode **Verificar o certificado do servidor** e **Verificar o nome do servidor**). Uma mudança para SQLite não precisa de nada: cria um novo ficheiro em `/data/npmpro`.
2. **Testar ligação**. Verifica a versão, se a base de dados está vazia e se o utilizador pode criar tabelas. Não altera nada.
3. **Mover**, depois escreva a palavra que lhe é pedida e clique em **Mover agora**.

O NPMpro pausa as alterações, faz um backup de segurança, cria as tabelas, copia e verifica cada linha e depois reinicia na nova base de dados. Os seus sites continuam a ser servidos. A página recarrega quando o NPMpro voltar a responder e pode ser preciso iniciar sessão de novo.

Se um passo falhar, o NPMpro fica na base de dados que usava e a janela indica o passo que parou. A base de dados antiga nunca é eliminada, por isso pode voltar atrás: remova `/data/npmpro/database.json` e reinicie o contentor.

Se a ligação vier das variáveis `DB_MYSQL_*` ou `DB_POSTGRES_*`, a secção é só de leitura. Para mover, faça um backup, aponte as variáveis para a nova base de dados, reinicie e restaure o backup.

Mais na wiki: Database.
