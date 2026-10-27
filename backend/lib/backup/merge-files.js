import { chmod, cp, mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exists, fileMode, folderMode, isPictureOf, move, namesIn, permissions, swapFiles } from "./restore-files.js";

// Merge of the files: the files of added certificates land under their new ids, chosen custom files replace the
// instance's, and every step is journaled so undo() puts the folder back as it was.

const ACCOUNTS = "tls/certbot/accounts";
const AVATAR_DIR = "public/avatar";

const certificatePaths = (id) => [
	`tls/certbot/archive/npm-${id}`,
	`tls/certbot/renewal/npm-${id}.conf`,
	`tls/custom/npm-${id}`,
	`tls/custom/npm-${id}.der`,
	`tls/mtls/npm-${id}.pem`,
	`tls/certbot/live/npm-${id}.der`,
];

const createPlacer = ({ dataDir, stageDir, asideDir }) => {
	const journal = [];
	const inData = (rel) => path.join(dataDir, rel);
	const inAside = (rel) => path.join(asideDir, rel);
	const inStage = (rel) => path.join(stageDir, "files", rel);

	const ensureFolder = async (rel) => {
		const parts = rel === "." ? [] : rel.split("/");
		for (let index = 1; index <= parts.length; index++) {
			const prefix = parts.slice(0, index).join("/");
			const info = await exists(inData(prefix));
			if (info?.isDirectory()) continue;
			if (info) throw new Error(`${prefix} is in the way of the merged files`);
			await mkdir(inData(prefix), { mode: folderMode(prefix) });
			await chmod(inData(prefix), folderMode(prefix));
			journal.push({ op: "mkdir", rel: prefix });
		}
	};

	// moves the instance's file at rel aside; returns its mode
	const moveAside = async (rel) => {
		const info = await exists(inData(rel));
		if (!info) return;
		if (info.isDirectory()) throw new Error(`${rel} is a folder in the way of the merged file`);
		await mkdir(path.dirname(inAside(rel)), { recursive: true, mode: 0o700 });
		await move(inData(rel), inAside(rel));
		journal.push({ op: "aside", rel });
		return info.isFile() ? permissions(info.mode) : undefined;
	};

	// puts a file at rel: content is a path to move from, or text to write
	const putFile = async (rel, { from, text }) => {
		const mode = await moveAside(rel);
		await ensureFolder(path.posix.dirname(rel));
		if (from === undefined) await writeFile(inData(rel), text, { mode: mode ?? fileMode(rel) });
		else await move(from, inData(rel));
		journal.push({ op: "place", rel });
		await chmod(inData(rel), mode ?? fileMode(rel));
	};

	// places the staged file or folder at stageRel as destRel; text maps the content of a file
	const putTree = async (stageRel, destRel, transform) => {
		const from = inStage(stageRel);
		const info = await exists(from);
		if (!info) return;
		if (info.isDirectory()) {
			await ensureFolder(destRel);
			for (const name of (await readdir(from)).sort())
				await putTree(`${stageRel}/${name}`, `${destRel}/${name}`, transform);
			return;
		}
		if (!info.isFile()) throw new Error(`files/${stageRel} is not a regular file`);
		if (transform) await putFile(destRel, { text: transform(await readFile(from, "utf8")) });
		else await putFile(destRel, { from });
	};

	// copies the staged account files the instance lacks
	const addMissing = async (rel) => {
		const from = inStage(rel);
		const info = await exists(from);
		if (!info) return;
		if (info.isDirectory()) {
			for (const name of (await readdir(from)).sort()) await addMissing(`${rel}/${name}`);
			return;
		}
		if (!info.isFile() || (await exists(inData(rel)))) return;
		await ensureFolder(path.posix.dirname(rel));
		await cp(from, inData(rel), { errorOnExist: true });
		journal.push({ op: "place", rel });
		await chmod(inData(rel), fileMode(rel));
	};

	const undoEntry = async ({ op, rel, mode }) => {
		if (op === "place") await rm(inData(rel), { force: true });
		else if (op === "mkdir") await rmdir(inData(rel));
		else if (op === "rmdir") await mkdir(inData(rel), { mode });
		else await move(inAside(rel), inData(rel));
	};

	const undo = async () => {
		const errors = [];
		while (journal.length > 0) {
			try {
				await undoEntry(journal.pop());
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) throw new AggregateError(errors, "Some merged files could not be moved back");
	};

	return { moveAside, putTree, addMissing, inData, inStage, undo };
};

const renewalText = (from, to) => {
	const segment = new RegExp(`(?<=/)npm-${from}(?=[/.]|$)`, "gmu");
	return (text) => text.replace(segment, `npm-${to}`);
};

/**
 * Moves the merged files into dataDir; every replaced instance file goes to asideDir first.
 *
 * @param   {Object}    options
 * @param   {string}    options.dataDir
 * @param   {string}    options.stageDir          holds files/<rel>
 * @param   {string}    options.asideDir          empty, mode 700, same filesystem as dataDir
 * @param   {Array}     options.certificateMoves  [{ from, to }] backup id -> new id
 * @param   {string[]}  options.takeFiles         rel paths (custom_nginx/..., crowdsec/...) to take
 * @param   {boolean}   options.takeDefaultSite   whether public/html is taken (settings_default_site)
 * @param   {Array}     [options.avatarMoves]     [{ from, to }] backup user id -> instance user id
 * @returns {Promise<{ undo: () => Promise<void> }>}  on failure everything is moved back before it rejects
 */
const placeMergedFiles = async ({
	dataDir,
	stageDir,
	asideDir,
	certificateMoves,
	takeFiles,
	takeDefaultSite,
	avatarMoves = [],
}) => {
	const placer = createPlacer({ dataDir, stageDir, asideDir });
	let siteSwap = null;
	const undo = async () => {
		const errors = [];
		for (const step of [() => siteSwap?.undo(), placer.undo]) {
			try {
				await step();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) throw new AggregateError(errors, "Some merged files could not be moved back");
	};
	try {
		for (const { from, to } of certificateMoves) {
			for (const rel of certificatePaths(from)) {
				const destRel = rel.replaceAll(`npm-${from}`, `npm-${to}`);
				await placer.putTree(rel, destRel, rel.endsWith(".conf") ? renewalText(from, to) : undefined);
			}
		}
		await placer.addMissing(ACCOUNTS);
		for (const rel of takeFiles) await placer.putTree(rel, rel);
		for (const { from, to } of avatarMoves) {
			const staged = await namesIn(placer.inStage(AVATAR_DIR));
			const names = staged.filter((name) => isPictureOf(from, name));
			if (names.length === 0) continue;
			for (const name of (await namesIn(placer.inData(AVATAR_DIR))).filter((item) => isPictureOf(to, item))) {
				await placer.moveAside(`${AVATAR_DIR}/${name}`);
			}
			for (const name of names) {
				await placer.putTree(`${AVATAR_DIR}/${name}`, `${AVATAR_DIR}/${to}${name.slice(String(from).length)}`);
			}
		}
		if (takeDefaultSite) {
			siteSwap = await swapFiles({ dataDir, stageDir, types: ["settings_default_site"], asideDir });
		}
	} catch (error) {
		await undo();
		throw error;
	}
	return { undo };
};

export { placeMergedFiles };
