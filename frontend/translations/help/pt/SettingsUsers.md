## Utilizadores

As pessoas que podem iniciar sessão neste NPMpro. Apenas os administradores veem esta lista. Também é possível iniciar sessão com um fornecedor OIDC, configurado em Definições, Autenticação.

A lista mostra o nome, o email, as funções e o estado de cada utilizador. Pesquise por nome ou email e ordene por uma coluna.

### Adicionar ou editar um utilizador

**Adicionar Utilizador** pede o **Nome Completo** e o **Endereço de Email**. Editar abre a mesma janela, onde também pode carregar ou remover o avatar do utilizador. Em **Opções**:

- **Administrador**: acesso total, incluindo Definições, Utilizadores e Registos de Auditoria. Sem esta opção, o utilizador é um Utilizador Comum, limitado pelas permissões abaixo.
- **Desativado**: o utilizador deixa de poder iniciar sessão e as suas sessões abertas terminam.

Não pode alterar as suas próprias funções, desativar-se nem eliminar-se, e a sua própria linha oferece apenas Editar.

### Menu da linha

Para as restantes contas:

- **Permissões**: ver abaixo.
- **Definir Palavra-passe**: define uma nova palavra-passe. Todos os outros dispositivos desse utilizador terminam a sessão.
- **Repor MFA**: apenas para utilizadores com MFA. Desativa-a sem código de recuperação e o utilizador pode configurá-la de novo.
- **Revogar sessões**: termina a sessão do utilizador em todos os dispositivos.
- **Desativar** ou **Ativar**: o mesmo que a opção **Desativado**.
- **Eliminar**: remove a conta. As suas entradas nos Registos de Auditoria mantêm-se.

### Permissões

Para um Utilizador Comum, escolha por secção (Proxy Hosts, Hosts de Redirecionamento, Hosts 404, Streams, Listas de Controlo de Acesso (ACL), Certificados): **Gerir**, **Apenas Visualização** ou **Oculto**. **Visibilidade do Item** decide se o utilizador vê **Todos os Itens** ou **Apenas Itens Criados**.

Uma escolha também ativa o que a secção necessita: os Proxy Hosts precisam das Listas de Controlo de Acesso (ACL) e dos Certificados, e Oculto fica indisponível enquanto outra secção precisar dessa. Os administradores têm acesso a tudo, por isso só lhes é oferecida a visibilidade dos itens.

Mais na wiki: Usage (Users and permissions) e Authentication.
