import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { global as defaultLogger } from "../../logger.js";
import { BackupError, readHeader } from "./format.js";

const NAME = /^npmpro-backup-[a-z0-9-]+-\d{8}-\d{6}(-\d{1,3})?(-auto)?\.npmpro$/u;
// a page export, offered as the name of its pending download
const EXPORT_NAME = /^npmpro-export-[a-z0-9-]+-\d{8}-\d{6}\.npmpro$/u;
const PENDING_ID = /^[A-Za-z0-9_-]{16,64}$/u;
const MAX_SESSIONS = 5;
const PAGE_MARK = "--import";
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
	pendingTtlMs = PENDING_TTL_MS,
	logger = defaultLogger,
}) => {
	const autoDir = path.join(dir, "auto");
	let running = false;
	const sessions = new Map(); // token -> { entry, timer }, oldest first
	const pending = new Map();

	// page: the automatic backup before a page import, pruned apart from the Settings ones. "--" never occurs in a
	// cleaned host name, so the mark cannot be mistaken for one.
	const fileName = ({ host, date, auto, page = false }) =>
		`npmpro-backup-${cleanHost(host)}${page ? PAGE_MARK : ""}-${stamp(date)}${auto ? "-auto" : ""}.npmpro`;

	const exportName = ({ kind, host, date }) =>
		`npmpro-export-${cleanHost(String(kind).replaceAll("_", "-"))}-${cleanHost(host)}-${stamp(date)}.npmpro`;

	// a name a pending download may be offered under: a backup or a page export
	const isDownloadName = (name) => typeof name === "string" && (NAME.test(name) || EXPORT_NAME.test(name));

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

	// keeps the newest keepAuto automatic backups of Settings restores and, apart from them, of page imports
	const pruneAuto = async () => {
		const items = (await list()).filter((item) => item.auto);
		for (const page of [false, true]) {
			const group = items.filter((item) => item.name.includes(`${PAGE_MARK}-`) === page);
			for (const item of group.slice(keepAuto)) await remove(item.name);
		}
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
		for (const entry of pending.values()) clearTimeout(entry.timer);
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
		const session = sessions.get(token);
		if (!session) return;
		clearTimeout(session.timer);
		sessions.delete(token);
		// runs from a timer too: a stage that cannot be removed is logged, not thrown (it is cleared at the next start)
		try {
			rmSync(session.entry.stageDir, { recursive: true, force: true });
		} catch (err) {
			logger.warn(`Could not remove the restore stage ${session.entry.stageDir}: ${err.message}`);
		}
	};

	const createToken = ({ stageDir, file, manifest, owner, kind = null }) => {
		// one session per owner, and the oldest goes when there are too many
		for (const [token, session] of sessions) {
			if (session.entry.owner === owner) dropToken(token);
		}
		// a Settings session (an admin's) never goes for the cap, the oldest page session does
		while (sessions.size >= MAX_SESSIONS) {
			const oldest = [...sessions].find(([, session]) => session.entry.kind !== null);
			if (!oldest) break;
			dropToken(oldest[0]);
		}
		const token = randomBytes(24).toString("base64url");
		// an abandoned restore session does not keep its stage until the next one
		const timer = setTimeout(() => dropToken(token), tokenTtlMs);
		timer.unref();
		sessions.set(token, {
			entry: { stageDir, file, manifest, owner, kind, expires: clock.now() + tokenTtlMs },
			timer,
		});
		return token;
	};

	const takeToken = (token, { keep = true, owner } = {}) => {
		const session = sessions.get(token);
		if (!session || session.entry.owner !== owner) throw expired();
		if (clock.now() >= session.entry.expires) {
			dropToken(token);
			throw expired();
		}
		if (!keep) {
			clearTimeout(session.timer);
			sessions.delete(token);
		}
		return session.entry;
	};

	// forgets a pending entry and removes its file; runs from a timer too, so a failed removal is logged, not thrown
	const dropPending = (id) => {
		const entry = pending.get(id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(id);
		try {
			rmSync(entry.target, { force: true });
		} catch (err) {
			logger.warn(`Could not remove the pending file ${entry.target}: ${err.message}`);
		}
	};

	// kind: the page a pending upload is imported on (null for a download). An owner has one pending import: a new one
	// drops the older one. An entry not taken in time is removed with its file.
	const addPending = async (file, { owner, kind = null }) => {
		if (kind !== null) {
			for (const [other, entry] of pending) {
				if (entry.owner === owner && entry.kind !== null) dropPending(other);
			}
		}
		const id = randomBytes(18).toString("base64url");
		const target = path.join(dir, `.pending-${id}.npmpro`);
		await rename(file, target);
		const timer = setTimeout(() => dropPending(id), pendingTtlMs);
		timer.unref();
		pending.set(id, { target, owner, kind, expires: clock.now() + pendingTtlMs, timer });
		return id;
	};

	// the owner's pending entry; an expired one is removed
	const pendingOf = (id, owner) => {
		if (typeof id !== "string" || !PENDING_ID.test(id)) throw expired();
		const entry = pending.get(id);
		if (!entry || entry.owner !== owner) throw expired();
		if (clock.now() >= entry.expires) {
			dropPending(id);
			throw expired();
		}
		return entry;
	};

	const takePending = (id, { owner }) => {
		const entry = pendingOf(id, owner);
		clearTimeout(entry.timer);
		pending.delete(id);
		return entry.target;
	};

	// the pending file and its kind, left in place
	const peekPending = (id, { owner }) => {
		const { target, kind } = pendingOf(id, owner);
		return { file: target, kind };
	};

	return {
		NAME,
		fileName,
		exportName,
		isDownloadName,
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
		peekPending,
	};
};

export { createBackupStore };
