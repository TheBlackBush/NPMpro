import errs from "../error.js";

// The state of a running database move, in memory only (a restart ends it). While it is on, the guard refuses every
// request that could write, apart from logging in and out and the move's own endpoints.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OPEN = [
	["POST", "/api/tokens"],
	["POST", "/api/tokens/totp"],
	["DELETE", "/api/tokens"],
];
const TRAILING_SLASHES = /\/+$/u;

const inProgress = () =>
	new errs.DatabaseMoveError("maintenance", "A database move is in progress, try again when it is done", {
		status: 409,
	});

const isMovePath = (path) => path === "/api/database" || path.startsWith("/api/database/");

const createMaintenance = () => {
	let moveId = null;
	// write requests that passed the guard and have not answered yet: one that started before the move may still write
	let writes = 0;
	let waiters = [];

	const settle = () => {
		if (writes > 0) return;
		const ready = waiters;
		waiters = [];
		for (const resolve of ready) resolve();
	};

	const track = (res) => {
		if (typeof res?.once !== "function") return;
		writes += 1;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			writes -= 1;
			settle();
		};
		res.once("finish", finish);
		res.once("close", finish);
	};

	return {
		active: () => moveId !== null,
		moveId: () => moveId,
		start: (id) => {
			if (moveId !== null) {
				throw new errs.DatabaseMoveError("move-running", "A database move is running", { status: 409 });
			}
			moveId = id;
		},
		end: () => {
			moveId = null;
		},
		// resolves once no write request that passed the guard is still running (the move waits for it before copying)
		idle: () => (writes === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
		// for writes outside the guarded routes (login side effects, a GET that writes an audit entry)
		refuseWrite: () => {
			if (moveId !== null) throw inProgress();
		},
		guard: (req, res, next) => {
			if (READ_METHODS.has(req.method)) return next();
			const path = req.path.replace(TRAILING_SLASHES, "") || "/";
			// the move's own requests: the move request itself runs for the whole move
			if (isMovePath(path)) return next();
			if (moveId !== null && !OPEN.some(([method, open]) => method === req.method && path === open)) {
				return next(inProgress());
			}
			track(res);
			return next();
		},
	};
};

const maintenance = createMaintenance();

export { createMaintenance, maintenance };
