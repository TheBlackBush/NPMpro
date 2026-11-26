import express from "express";
import internalPasswordReset from "../internal/password-reset.js";
import { createAuthLimiter } from "../lib/express/auth-limiter.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

// Public routes of the reset by mail. None of them logs the body (it holds an address, a token or a password).

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

// 5 requests per address (an IPv6 /48) in 15 minutes for the three routes together, every request counted: a request for
// an unknown address costs the same as one for a real address
const limiter = createAuthLimiter({ windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: false });
router.use(limiter);

/** POST /password-reset: always 202 with no body; the work follows the answer */
router.post("/", (req, res) => {
	const { email } = apiValidator(getValidationSchema("/password-reset", "post"), req.body);
	res.status(202).end();
	internalPasswordReset.request({ email, ip: req.ip });
});

/** POST /password-reset/check */
router.post("/check", async (req, res) => {
	const { token } = apiValidator(getValidationSchema("/password-reset/check", "post"), req.body);
	res.status(200).send(await internalPasswordReset.check(token));
});

/** POST /password-reset/confirm */
router.post("/confirm", async (req, res) => {
	const { token, password } = apiValidator(getValidationSchema("/password-reset/confirm", "post"), req.body);
	res.status(200).send(await internalPasswordReset.confirm({ token, password, ip: req.ip }));
});

export default router;
