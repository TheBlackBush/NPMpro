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

let running = false;

/**
 * One sample alert in flight at a time (it sends one mail per recipient): a second request while one runs answers 429
 *
 * @param   {Function}  handler  async (req, res)
 * @returns {Function}  an Express handler
 */
const oneAtATime = (handler) => async (req, res, next) => {
	if (running) {
		res.status(429).send({ error: { message: TOO_MANY } });
		return;
	}
	running = true;
	try {
		await handler(req, res, next);
	} finally {
		running = false;
	}
};

export { oneAtATime, testMailLimiter };
