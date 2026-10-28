import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import multer from "multer";
import { maintenance } from "./lib/database/maintenance.js";
import errs from "./lib/error.js";
import { jsonReplacer } from "./lib/helpers.js";
import { express as logger } from "./logger.js";
import mainRoutes from "./routes/main.js";

Object.assign(multer.MulterError.prototype, { public: true, status: 400 });

/**
 * App
 */
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.set("json spaces", 2);
app.set("json replacer", jsonReplacer);

app.use(cookieParser(process.env.COOKIE_SECRET || crypto.randomBytes(16).toString("hex")));
app.use(express.json());

/**
 * General Logging, BEFORE routes
 */

app.use((req, res, next) => {
	if (
		req.method === "GET" &&
		req.path === "/api/oidc/callback" &&
		req.get("sec-fetch-mode") === "navigate" &&
		req.get("sec-fetch-dest") === "document"
	) {
		return next();
	}

	if (req.get("origin") && req.get("origin") !== `${req.protocol}://${req.host}`) {
		return res.status(403).json({
			error: { message: "Rejected Origin." },
		});
	}
	if (["same-origin", "none", undefined].includes(req.get("sec-fetch-site"))) {
		return next();
	}

	res.status(403).json({
		error: { message: "Rejected Sec-Fetch-Site Value." },
	});
});

// a database move refuses writes until the backend restarts on the new database
app.use(maintenance.guard);
app.use("/", mainRoutes);

const COMMAND_OUTPUT_MAX = 8000;

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, _) => {
	const status = err.status || 500;
	const exposed = err.public || err.expose;
	const payload = {
		error: {
			code: status,
			message: exposed ? err.message : "Internal Error",
		},
	};

	if (err.message_i18n) {
		payload.error.message_i18n = err.message_i18n;
	}

	// on purpose, although the error is not public: the UI shows the certbot or nginx output so a failed certificate
	// request or config can be fixed (DNS, rate limits, a rejected directive). Only the end, where the cause is.
	if (err instanceof errs.CommandError) {
		payload.error.output =
			err.message.length > COMMAND_OUTPUT_MAX ? `…${err.message.slice(-COMMAND_OUTPUT_MAX)}` : err.message;
	}

	// the driver or verification message of a database move error, shown under the translated message
	if (exposed && typeof err.details === "string" && err.details !== "") {
		payload.error.output =
			err.details.length > COMMAND_OUTPUT_MAX ? `…${err.details.slice(-COMMAND_OUTPUT_MAX)}` : err.details;
	}

	// Not every error is worth logging - but this is good for now until it gets annoying.
	if (err.stack && !exposed) logger.warn(`${req.method} ${req.originalUrl}: ${err}`);

	res.status(status).send(payload);
});

export default app;
