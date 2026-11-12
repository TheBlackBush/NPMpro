/**
 * The user as the API sends it: the OIDC issuer and subject stay on the server, the link date is always present
 *
 * @param   {Object}  json  the formatted user
 * @returns {Object}
 */
const publicUserJson = (json) => {
	const { npmpro_oidc_issuer: _issuer, npmpro_oidc_subject: _subject, ...rest } = json;
	return { ...rest, npmpro_oidc_linked_on: rest.npmpro_oidc_linked_on ?? null };
};

/**
 * @param   {Object[]}  users
 * @param   {number[]}  passwordUserIds  ids of the users with a password auth row
 * @returns {Object[]}  the users with npmpro_has_password
 */
const withPasswordFlag = (users, passwordUserIds) => {
	const ids = new Set(passwordUserIds.map(Number));
	return users.map((user) => ({ ...user, npmpro_has_password: ids.has(Number(user.id)) }));
};

export { publicUserJson, withPasswordFlag };
