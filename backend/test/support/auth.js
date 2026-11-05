import { PASSWORD } from "./api.js";

// Helpers of the auth API tests. The /users and /tokens routers count every failed request per address (5 in 5 minutes),
// so a test that expects several refusals takes a client of its own through these.

let admins = 0;

/**
 * A new administrator with a session of its own (its own address, so its refusals do not add to another client's)
 *
 * @param   {Object}  api    the startApi result
 * @param   {Object}  admin  an existing administrator session
 * @returns {Promise<Object>} the session, with .user
 */
const newAdmin = async (api, admin) => {
	admins += 1;
	const email = `extra-admin${admins}@example.com`;
	const created = await admin.post("/users", {
		name: `Extra admin ${admins}`,
		email,
		roles: ["admin"],
		auth: { type: "password", secret: PASSWORD },
	});
	if (created.status !== 201) throw new Error(`creating an admin answered ${created.status}: ${created.text}`);
	const session = api.client();
	const login = await session.post("/tokens", { identity: email, secret: PASSWORD });
	if (login.status !== 200) throw new Error(`login of an admin answered ${login.status}: ${login.text}`);
	session.user = created.body;
	return session;
};

/**
 * The Set-Cookie line of one cookie in a response
 *
 * @param   {Object}  response
 * @param   {String}  name
 * @returns {String|undefined}
 */
const setCookie = (response, name) => response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));

export { newAdmin, setCookie };
