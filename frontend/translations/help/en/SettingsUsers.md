## Users

The people who can sign in to this NPMpro. Only administrators see this list. People can also sign in with an OIDC provider, set up under Settings, Authentication.

The list shows each user's name, email, roles and status. Search by name or email, and sort by a column.

### Add or edit a user

**Add User** asks for the **Full Name** and **Email address**. Edit opens the same window, where you can also upload or remove the user's avatar. Under **Options**:

- **Administrator**: full access, including Settings, Users and Audit Logs. Without it the user is a Standard User, limited by the permissions below.
- **Disabled**: the user can no longer sign in, and their open sessions end.

You cannot change your own roles, disable or delete yourself, and your own row offers only Edit.

### Row menu

For the other accounts:

- **Permissions**: see below.
- **Set Password**: sets a new password. All other devices of that user are logged out.
- **Reset MFA**: only for users who have MFA. It turns MFA off without a recovery code, and the user can set it up again.
- **Revoke sessions**: logs the user out on every device.
- **Disable** or **Enable**: the same as the **Disabled** option.
- **Delete**: removes the account. Its entries in the Audit Logs stay.

### Permissions

For a Standard User, choose per section (Proxy Hosts, Redirection Hosts, 404 Hosts, Streams, Access Lists, Certificates): **Manage**, **View Only** or **Hidden**. **Item Visibility** decides whether the user sees **All Items** or **Created Items Only**.

A choice also turns on what the section needs: Proxy Hosts need Access Lists and Certificates, and Hidden is unavailable while another section needs that one. Administrators have access to everything, so only the item visibility is offered for them.

More in the wiki: Usage (Users and permissions) and Authentication.
