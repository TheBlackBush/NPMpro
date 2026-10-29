## Ajuda de Certificados

### Certificado HTTP

Um certificado validado por HTTP significa que os servidores do Certbot irão
tentar aceder aos teus domínios via HTTP (não HTTPS!) e, se a ligação for bem-sucedida,
emitirão o certificado.

Para este método, é necessário ter um *Proxy Host* criado para o(s) teu(s) domínio(s),
acessível via HTTP e a apontar para esta instalação do Nginx. Depois de o certificado ser
emitido, podes modificar o *Proxy Host* para também utilizar esse certificado em ligações HTTPS.
No entanto, o *Proxy Host* deve continuar configurado para acesso HTTP para que a renovação
funcione corretamente.

Este processo **não** suporta domínios wildcard.

### Certificado DNS

Um certificado validado por DNS requer que uses um plugin de fornecedor DNS (*DNS Provider*).
Este fornecedor será usado para criar registos temporários no teu domínio, que serão consultados
pelo Certbot para confirmar que és o proprietário. Se tudo correr bem, o certificado será emitido.

Não é necessário ter um *Proxy Host* criado antes de pedir este tipo de certificado.
Também não é necessário que o *Proxy Host* tenha acesso HTTP configurado.

Este processo **suporta** domínios wildcard.

#### Credenciais DNS guardadas

As credenciais do teu fornecedor DNS (*DNS Provider*) são guardadas separadamente do certificado, no
separador *Credenciais DNS* da página Certificados. Depois, um certificado apenas escolhe uma das
credenciais guardadas, por isso vários certificados podem partilhá-las.

Os segredos são guardados cifrados e nunca voltam a ser mostrados. Ao editar uma credencial, deixa
um segredo vazio para manter o valor guardado. A chave usada na cifragem é o ficheiro
`/data/npmpro/dns-credentials.key`; faz cópia de segurança dele juntamente com a base de dados, caso contrário
as credenciais guardadas não poderão ser lidas após um restauro.

Os fornecedores sem formulário usam a caixa de texto INI, onde colas o conteúdo do
ficheiro de credenciais desse fornecedor.

### Certificado Personalizado

Usa esta opção para carregar o teu próprio Certificado TLS, fornecido pela
tua Autoridade Certificadora.
