/**
 * How a user can sign in: "local" with a password, "oidc" when linked to an OIDC identity
 *
 * @param   {Object}  user  a users list item
 * @returns {Array<"local"|"oidc">}
 */
export const signInMethods = (user) => [
	...(user?.npmproHasPassword ? ["local"] : []),
	...(user?.npmproOidcLinkedOn ? ["oidc"] : []),
];
