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
 * @param   {number[]}  [linkedUserIds]  ids of the users with an OIDC link
 * @param   {number[]}  [authUserIds]    ids of the users with any auth row (a password, TOTP, backup codes); the
 *                                       password ids when not given
 * @returns {Object[]}  the users with npmpro_has_password and invited (enabled, no auth row, no OIDC link: they can
 *                      still accept an invitation, the same rule as internalUser.isInvited)
 */
const withPasswordFlag = (users, passwordUserIds, linkedUserIds = [], authUserIds = passwordUserIds) => {
	const ids = new Set(passwordUserIds.map(Number));
	const withAuth = new Set(authUserIds.map(Number));
	const linked = new Set(linkedUserIds.map(Number));
	return users.map((user) => {
		const id = Number(user.id);
		return {
			...user,
			npmpro_has_password: ids.has(id),
			invited: !(ids.has(id) || withAuth.has(id) || linked.has(id) || user.is_disabled),
		};
	});
};

export { publicUserJson, withPasswordFlag };
