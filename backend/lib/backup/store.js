import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { global as defaultLogger } from "../../logger.js";
import { BackupError, readHeader } from "./format.js";

const NAME = /^npmpro-backup-[a-z0-9-]+-\d{8}-\d{6}(-\d{1,3})?(-auto)?\.npmpro$/u;
const PENDING_ID = /^[A-Za-z0-9_-]{16,64}$/u;
const PENDING_TTL_MS = 30 * 60 * 1000;
const LEFTOVER = [".tmp-", ".upload-", ".restore-", ".pending-"];
// the name without its number; a taken name gets a new number in place of the old one
const NAME_PARTS = /^(.+-\d{8}-\d{6})(?:-\d{1,3})?(-auto)?\.npmpro$/u;

const pad = (value, length = 2) => String(value).padStart(length, "0");

const stamp = (date) =>
	`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

const cleanHost = (host) =>
	String(host ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^-+|-+$/gu, "") || "npmpro";

const notABackup = () => Object.assign(new BackupError("not-a-backup", "Backup not found"), { status: 404 });
const busy = () => Object.assign(new BackupError("busy", "A backup or restore is running"), { status: 409 });
const expired = () =>
	Object.assign(new BackupError("token-expired", "The restore session has expired"), { status: 410 });

const randomName = () => randomBytes(12).toString("hex");

const createBackupStore = ({
	dir,
	clock = Date,
	keepAuto = 5,
	tokenTtlMs = 30 * 60 * 1000,
	logger = defaultLogger,
}) => {
	const autoDir = path.join(dir, "auto");
	let running = false;
	let current = null; // { token, entry, timer }
	const pending = new Map();

	const fileName = ({ host, date, auto }) =>
		`npmpro-backup-${cleanHost(host)}-${stamp(date)}${auto ? "-auto" : ""}.npmpro`;

	const pathOf = (name) => {
		if (typeof name !== "string" || !NAME.test(name)) throw notABackup();
		return path.join(name.endsWith("-auto.npmpro") ? autoDir : dir, name);
	};

	const uniqueName = (name) => {
		const parts = NAME_PARTS.exec(name);
		if (!parts) throw notABackup();
		let candidate = name;
		for (let n = 2; existsSync(pathOf(candidate)); n++) {
			if (n > 999) throw new BackupError("name-taken", "Too many backups with the same name");
			candidate = `${parts[1]}-${n}${parts[2] ?? ""}.npmpro`;
		}
		return candidate;
	};

	const describeFile = async (folder, name) => {
		const file = path.join(folder, name);
		const info = await stat(file);
		if (!info.isFile()) return null;
		let summary = null;
		let encrypted = null;
		try {
			const { header } = await readHeader(file);
			summary = header.summary ?? null;
			encrypted = header.kdf !== "none";
		} catch {
			// Unreadable headers stay listed so the file can still be deleted.
		}
		return {
			name,
			size: info.size,
			modified: info.mtime.toISOString(),
			auto: folder === autoDir,
			summary,
			encrypted,
		};
	};

	const names = async (folder) => {
		try {
			return (await readdir(folder)).filter((name) => NAME.test(name));
		} catch (err) {
			if (err.code === "ENOENT") return [];
			throw err;
		}
	};

	const list = async () => {
		const items = [];
		for (const folder of [dir, autoDir]) {
			for (const name of await names(folder)) {
				if (name.endsWith("-auto.npmpro") !== (folder === autoDir)) continue;
				const item = await describeFile(folder, name);
				if (item) items.push(item);
			}
		}
		return items.sort((a, b) => b.modified.localeCompare(a.modified) || b.name.localeCompare(a.name));
	};

	const remove = async (name) => {
		const file = pathOf(name);
		try {
			await rm(file);
		} catch (err) {
			if (err.code === "ENOENT") throw notABackup();
			throw err;
		}
	};

	const pruneAuto = async () => {
		const items = (await list()).filter((item) => item.auto);
		for (const item of items.slice(keepAuto)) await remove(item.name);
	};

	const tempPath = (prefix) => path.join(dir, `.${prefix}-${randomName()}`);

	const createStageDir = async (prefix) => {
		await mkdir(dir, { recursive: true, mode: 0o700 });
		const stage = tempPath(prefix);
		await mkdir(stage, { mode: 0o700 });
		return stage;
	};

	const cleanup = async () => {
		for (const folder of [dir, autoDir]) {
			let entries;
			try {
				entries = await readdir(folder);
			} catch (err) {
				if (err.code === "ENOENT") continue;
				throw err;
			}
			for (const entry of entries) {
				const leftover = folder === dir && LEFTOVER.some((prefix) => entry.startsWith(prefix));
				if (leftover || entry.endsWith(".part"))
					await rm(path.join(folder, entry), { recursive: true, force: true });
			}
		}
		pending.clear();
	};

	const withLock = async (fn) => {
		if (running) throw busy();
		running = true;
		try {
			return await fn();
		} finally {
			running = false;
		}
	};

	const dropToken = (token) => {
		if (current?.token !== token) return;
		const { timer, entry } = current;
		clearTimeout(timer);
		current = null;
		// runs from a timer too: a stage that cannot be removed is logged, not thrown (it is cleared at the next start)
		try {
			rmSync(entry.stageDir, { recursive: true, force: true });
		} catch (err) {
			logger.warn(`Could not remove the restore stage ${entry.stageDir}: ${err.message}`);
		}
	};

	const createToken = ({ stageDir, file, manifest }) => {
		if (current) dropToken(current.token);
		const token = randomBytes(24).toString("base64url");
		// an abandoned restore session does not keep its stage until the next one
		const timer = setTimeout(() => dropToken(token), tokenTtlMs);
		timer.unref();
		current = { token, entry: { stageDir, file, manifest, expires: clock.now() + tokenTtlMs }, timer };
		return token;
	};

	const takeToken = (token, { keep = true } = {}) => {
		if (!current || current.token !== token) throw expired();
		if (clock.now() >= current.entry.expires) {
			dropToken(token);
			throw expired();
		}
		const { entry } = current;
		if (!keep) {
			clearTimeout(current.timer);
			current = null;
		}
		return entry;
	};

	const addPending = async (file) => {
		const id = randomBytes(18).toString("base64url");
		const target = path.join(dir, `.pending-${id}.npmpro`);
		await rename(file, target);
		pending.set(id, { target, expires: clock.now() + PENDING_TTL_MS });
		return id;
	};

	const takePending = (id) => {
		if (typeof id !== "string" || !PENDING_ID.test(id)) throw expired();
		const entry = pending.get(id);
		if (!entry) throw expired();
		pending.delete(id);
		if (clock.now() >= entry.expires) {
			rmSync(entry.target, { force: true });
			throw expired();
		}
		return entry.target;
	};

	return {
		NAME,
		fileName,
		pathOf,
		list,
		remove,
		pruneAuto,
		uniqueName,
		tempPath,
		createStageDir,
		cleanup,
		withLock,
		createToken,
		takeToken,
		dropToken,
		addPending,
		takePending,
	};
};

export { createBackupStore };
