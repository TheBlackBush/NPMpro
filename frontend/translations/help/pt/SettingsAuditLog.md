## Registos de Auditoria

Um histórico de quem alterou o quê. Apenas os administradores o veem.

Cada entrada mostra o utilizador, o objeto e a ação. São registados:

- **Criado**, **Atualizado**, **Eliminado**, **Ativado** e **Desativado** para proxy hosts, hosts de redirecionamento, hosts 404, streams, listas de acesso, certificados, credenciais DNS, agendamentos de backup, utilizadores e definições.
- Backups: **Backup concluído** e **Backup falhou** nas execuções de backups agendados.
- Mudanças de base de dados: **Movido** e **Falha ao mover**.

As entradas mais recentes aparecem primeiro. **Carregar mais** mostra as 50 seguintes e o número por baixo da lista indica quantas estão carregadas do total.

### Encontrar uma entrada

- **Pesquisar** procura nos detalhes de todas as entradas, por isso um nome de domínio ou um endereço de email encontra as entradas correspondentes.
- **Tipo de objeto**, **Ação** e **Utilizador** restringem a lista. Combinam-se entre si e com a pesquisa.
- Com um filtro ou uma pesquisa ativos, a lista indica quantas entradas são mostradas. **Limpar filtros** remove-os todos.

### Detalhes

O botão do olho de uma linha (**Ver Detalhes**) abre a entrada: o utilizador, o que aconteceu e os dados guardados com ela. Numa alteração, é o objeto tal como foi guardado. Os valores longos quebram linha e a janela desloca-se.

Um utilizador entretanto eliminado aparece como **Utilizador Eliminado**. O NPMpro nunca remove entradas por si e o registo de auditoria não faz parte de um backup.

Mais na wiki: Usage (Audit Logs).
