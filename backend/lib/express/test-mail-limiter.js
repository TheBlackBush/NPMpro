import { rateLimit } from "express-rate-limit";

const TOO_MANY = "Too many requests, please try again later.";

/** A test mail reaches a real mail server: 5 requests a minute per IP address, shared by every test mail route */
const testMailLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 5,
	message: { error: { message: TOO_MANY } },
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 48,
});

// the keys of the tests in flight
const running = new Set();

/**
 * One test in flight at a time per key: a second request with the same key while one runs answers 429. Each route has
 * its own key (the sample alert sends one mail per recipient; a webhook test is keyed by its webhook), so a slow test
 * never blocks another one.
 *
 * @param   {Function}         handler  async (req, res)
 * @param   {String|Function}  key      the key, or (req) => the key
 * @returns {Function}  an Express handler
 */
const oneAtATime = (handler, key) => async (req, res, next) => {
	const name = typeof key === "function" ? key(req) : key;
	if (running.has(name)) {
		res.status(429).send({ error: { message: TOO_MANY } });
		return;
	}
	running.add(name);
	try {
		await handler(req, res, next);
	} finally {
		running.delete(name);
	}
};

export { oneAtATime, testMailLimiter };
