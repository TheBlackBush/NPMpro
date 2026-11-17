import { rateLimit } from "express-rate-limit";

/**
 * The sign-in limit: 5 failed requests per address (an IPv6 /48) in 5 minutes; successful requests are not counted.
 *
 * @param   {Object}  [options]  express-rate-limit options that replace these
 * @returns {Function} the middleware
 */
const createAuthLimiter = (options = {}) =>
	rateLimit({
		windowMs: 5 * 60 * 1000,
		limit: 5,
		message: { error: { message: "Too many requests, please try again later." } },
		standardHeaders: "draft-8",
		legacyHeaders: false,
		ipv6Subnet: 48,
		skipSuccessfulRequests: true,
		...options,
	});

export { createAuthLimiter };
