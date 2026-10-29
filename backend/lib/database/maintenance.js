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

const writesRunning = () =>
	new errs.DatabaseMoveError("writes-running", "Requests that write are still running, try again later", {
		status: 409,
	});

// exactly the move's own writes: nothing else under /api/database is open during a move
const MOVE_PATHS = new Set(["/api/database/test", "/api/database/move"]);
const isMovePath = (path) => MOVE_PATHS.has(path);

const createMaintenance = () => {
	let moveId = null;
	// writes that started before the move (requests that passed the guard, claimed writes) and are not done yet
	let writes = 0;
	let waiters = [];

	const settle = () => {
		if (writes > 0) return;
		const ready = waiters;
		waiters = [];
		for (const resolve of ready) resolve();
	};

	// counts one write until the returned release is called (once; later calls do nothing)
	const claim = () => {
		writes += 1;
		let done = false;
		return () => {
			if (done) return;
			done = true;
			writes -= 1;
			settle();
		};
	};

	// a write request counts until its response is ended, not until the connection closes: a client (or nginx) that
	// drops the connection does not stop the handler, which can still write. A handler that never ends its response
	// keeps the claim, so the move's wait for running writes times out and the move fails before copying.
	const track = (res) => {
		if (typeof res?.once !== "function") return;
		const release = claim();
		res.once("finish", release);
		if (typeof res.end === "function") {
			const end = res.end;
			res.end = function endAndRelease(...args) {
				release();
				return end.apply(this, args);
			};
		}
	};

	const tryBeginWrite = () => (moveId === null ? claim() : null);

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
		/**
		 * Resolves once no write that started before the move is still running (the move waits for it before
		 * copying). With timeoutMs it rejects with "writes-running" when they take longer.
		 *
		 * @param   {{ timeoutMs?: number }}  [options]
		 * @returns {Promise<void>}
		 */
		idle: ({ timeoutMs } = {}) => {
			if (writes === 0) return Promise.resolve();
			let waiter;
			const settled = new Promise((resolve) => {
				waiter = resolve;
				waiters.push(resolve);
			});
			if (timeoutMs === undefined) return settled;
			let timer;
			const late = new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(writesRunning()), timeoutMs);
			});
			return Promise.race([settled, late]).finally(() => {
				clearTimeout(timer);
				// a timed-out wait leaves nothing behind
				const index = waiters.indexOf(waiter);
				if (index !== -1) waiters.splice(index, 1);
			});
		},
		/**
		 * Claims a write outside the guarded routes (login side effects, a GET that writes an audit entry): refused
		 * during a move, else counted by idle() until the returned release is called (in a finally).
		 *
		 * @returns {Function}  release
		 */
		beginWrite: () => {
			const release = tryBeginWrite();
			if (!release) throw inProgress();
			return release;
		},
		// the same for a write that can be skipped (done at a later login): null during a move
		tryBeginWrite,
		refuseWrite: () => {
			if (moveId !== null) throw inProgress();
		},
		guard: (req, res, next) => {
			if (READ_METHODS.has(req.method)) return next();
			const path = req.path.replace(TRAILING_SLASHES, "") || "/";
			// the move's own requests: the move request itself runs for the whole move
			if (req.method === "POST" && isMovePath(path)) return next();
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
