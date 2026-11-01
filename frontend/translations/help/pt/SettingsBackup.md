## Backup e restauro

Guarde os seus hosts, certificados, utilizadores e definições num ficheiro `.npmpro` e restaure-o nesta ou noutra instância do NPMpro. As estatísticas de tráfego e os registos nunca fazem parte de um backup.

### Criar backup

- **O que incluir**: partes como hosts, listas de acesso, certificados, credenciais DNS, utilizadores, definições e ficheiros personalizados. No início estão todas marcadas.
- **Incluir segredos**: acrescenta chaves privadas, palavras-passe, segredos de dois fatores, valores das credenciais DNS, o client secret OIDC e a chave de licença GeoIP. O ficheiro é cifrado com uma **Frase-passe** de pelo menos 12 carateres, que introduz duas vezes. O NPMpro não a guarda, por isso sem ela o backup não pode ser restaurado.
- Sem segredos o ficheiro não é cifrado e deixa os segredos de fora. Mesmo assim contém nomes de hosts, utilizadores e definições, por isso mantenha-o privado.
- **Descarregar** guarda o ficheiro no seu computador. **Manter no servidor** guarda-o em `/data/backups`.

### Backups agendados

Adicione agendamentos que fazem backups sozinhos e os guardam no servidor.

- **Quando**: de N em N horas, diariamente, semanalmente ou mensalmente, no fuso horário do contentor.
- **Proteção**: **Frase-passe** (restaura em qualquer lado), **Chave da instância** (nada para memorizar, restaura só nesta instância) ou **Sem segredos**.
- **Manter**: quantos ficheiros deste agendamento manter. Os mais antigos são eliminados após cada execução bem-sucedida.
- Um agendamento pode ser executado de imediato, pausado, editado ou eliminado. Uma execução falhada é mostrada no agendamento e no painel.

Os backups agendados protegem-no de alterações erradas, não da perda do disco. Para isso copie os ficheiros para outra máquina.

### Backups guardados

Lista os ficheiros no servidor. Descarregue, restaure ou elimine-os, ou use **Carregar backup**. O NPMpro faz um backup **Automático** antes de cada restauro, intercalação e mudança de base de dados; não precisa de frase-passe e restaura só nesta instância.

### Restauro

- **Substituir** troca as partes que escolher nesta instância pelas do backup. A sua própria conta nunca é substituída.
- **Intercalar** acrescenta os itens do backup e não elimina nada. Mostra uma pré-visualização e deixa escolher para cada conflito: saltar, usar o item existente, acrescentar como novo ou substituir.

Um restauro é revertido se o nginx rejeitar o resultado. Um backup de uma versão mais recente do NPMpro não pode ser restaurado. Algumas definições restauradas precisam de reiniciar o contentor.

Esta secção não tem variáveis de ambiente.

Mais na wiki: Backup-and-restore.
