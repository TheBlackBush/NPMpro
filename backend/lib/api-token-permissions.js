// The permissions of an API token: its own levels, never above its owner's current ones (spec rule 1), and
// administrator rights only for an administrator's token with the Administrator switch (rule 6).

const SECTIONS = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams", "access_lists", "certificates"];
const LEVELS = ["hidden", "view", "manage"];

const rank = (level) => Math.max(LEVELS.indexOf(level), 0);
const isAdminUser = (user) => Array.isArray(user?.roles) && user.roles.includes("admin");

/** @returns {Object} visibility and the six levels the owner has now (an administrator: everything) */
const ownerLevels = (user) => {
	if (isAdminUser(user)) return { visibility: "all", ...Object.fromEntries(SECTIONS.map((s) => [s, "manage"])) };
	const own = user?.permissions ?? {};
	return {
		visibility: own.visibility === "all" ? "all" : "user",
		...Object.fromEntries(SECTIONS.map((s) => [s, LEVELS[rank(own[s])]])),
	};
};

/** @returns {Object} the lower of the token's and the owner's level per section; visibility all only when both are all */
const effectivePermissions = (token, user) => {
	const owner = ownerLevels(user);
	return {
		visibility: owner.visibility === "all" && token.visibility === "all" ? "all" : "user",
		...Object.fromEntries(SECTIONS.map((s) => [s, LEVELS[Math.min(rank(token[s]), rank(owner[s]))]])),
	};
};

/** @returns {boolean} */
const tokenIsAdmin = (token, user) => isAdminUser(user) && Boolean(token.is_admin);

/** @returns {string[]} "visibility" and the sections where the requested levels exceed the owner's */
const aboveOwner = (requested, user) => {
	const owner = ownerLevels(user);
	const above = requested.visibility === "all" && owner.visibility !== "all" ? ["visibility"] : [];
	return [...above, ...SECTIONS.filter((s) => rank(requested[s]) > rank(owner[s]))];
};

export { aboveOwner, effectivePermissions, isAdminUser, LEVELS, ownerLevels, SECTIONS, tokenIsAdmin };
