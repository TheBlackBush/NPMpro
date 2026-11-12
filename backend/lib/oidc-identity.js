// the length of the issuer and subject columns
const MAX_LENGTH = 255;

/**
 * The provider identity of an OIDC sign-in: the id token's issuer and subject
 *
 * @param   {Object}  claims  id token claims merged with userinfo
 * @returns {{issuer: string, subject: string}|null}  null when either is missing, empty or longer than its column
 */
const identityOf = (claims) => {
	const usable = (value) => typeof value === "string" && value !== "" && value.length <= MAX_LENGTH;
	if (!(usable(claims?.iss) && usable(claims?.sub))) return null;
	return { issuer: claims.iss, subject: claims.sub };
};

/**
 * What an OIDC sign-in does with the link of the user its email matched
 *
 * @param   {Object|null}  user      the matched user row (null before auto-create)
 * @param   {{issuer: string, subject: string}}  identity
 * @param   {number|null}  holderId  the user already linked to this identity, or null
 * @returns {"ok"|"link"|"relink"|"mismatch"}
 *          ok: linked to this identity; link: not linked yet; relink: linked at another issuer (the provider was
 *          changed); mismatch: linked to another subject at this issuer, or the identity belongs to another user
 */
const linkAction = (user, identity, holderId) => {
	if (holderId !== null && holderId !== (user?.id ?? null)) return "mismatch";
	if (!user?.npmpro_oidc_issuer) return "link";
	if (user.npmpro_oidc_issuer !== identity.issuer) return "relink";
	return user.npmpro_oidc_subject === identity.subject ? "ok" : "mismatch";
};

export { identityOf, linkAction };
