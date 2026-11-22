# DNS

Certificates & DNS holds the DNS credentials, the domains each credential manages and, from later updates, the dynamic DNS records. Everything here uses the Certificates permission: view to read, manage to change.

## Domains

A domain is a DNS zone a credential manages, such as `example.com`. It covers itself and every name below it (`www.example.com`, `*.example.com`). Add domains in the Domains tab (Add domains) or in the DNS credential window (the Domains line). Names are stored in lower case; an internationalized name is stored as punycode (`bücher.de` becomes `xn--bcher-kva.de`). A domain cannot be a wildcard or a single label. One owner keeps a domain on one credential only: a second credential of the same owner refuses it. Two users may each list the same domain on their own credentials. Domains are input help: hosts and certificates keep plain names, and deleting a domain changes neither.

## Suggestions while you type

Every Domain Names field (hosts, certificates, the certificate of a stream) suggests names as you type. Text without a dot is offered in front of each of your domains (`app` becomes `app.example.com`); text with a dot is completed against your domains and against the names your hosts and certificates already use. Wildcards such as `*.example.com` are offered only where the field takes them (the DNS challenge). You can always type any other name; Enter adds what you typed.

## DNS challenge

When you request a certificate with the DNS challenge, NPMpro picks the provider and credential whose domain covers all the names and says so under the credential field. Choose another one at any time; if it does not cover every name, a note says which names it has no domain for. Names that need different credentials, or a domain two users both listed, are shown instead of being guessed. The suggestion only fills the form: the request uses the credential you see.

## Who sees what

A user limited to their own items sees only the domains of their own credentials.
