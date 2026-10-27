import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BackupError } from "./format.js";
import { accountIds, rebuildRenewalConf } from "./renewal-conf.js";
import { createJournal, exists, isPictureOf, namesIn, swapFiles } from "./restore-files.js";
import { TYPES } from "./types.js";

// Merge of the files: the files of added certificates land under their new ids, chosen custom files replace the
// instance's, and every step is journaled so undo() puts the folder back as it was.

const CUSTOM_TYPES = ["custom_nginx", "crowdsec_files"];
const ACCOUNTS = "tls/certbot/accounts";
const AVATAR_DIR = "public/avatar";
// ids name files (npm-<id>, <id>.png), so a move takes nothing but positive integers
const ITEM_ID = /^[1-9]\d*$/u;

const invalid = (reason) => new BackupError("invalid-archive", reason);

const checkMoves = (moves, what) => {
	for (const move of moves) {
		if (!(ITEM_ID.test(String(move?.from)) && ITEM_ID.test(String(move?.to)))) {
			throw invalid(`A ${what} move has an invalid id`);
		}
	}
};

// root joined with rel, refused when the result leaves root
const inside = (root, rel) => {
	const full = path.resolve(root, rel);
	if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw invalid(`${rel} leaves its folder`);
	return full;
};

const certificatePaths = (id) => [
	`tls/certbot/archive/npm-${id}`,
	`tls/certbot/renewal/npm-${id}.conf`,
	`tls/custom/npm-${id}`,
	`tls/custom/npm-${id}.der`,
	`tls/mtls/npm-${id}.pem`,
	`tls/certbot/live/npm-${id}.der`,
];

const createPlacer = ({ dataDir, stageDir, asideDir }) => {
	const journal = createJournal({ dataDir, asideDir });
	const dataRoot = path.resolve(dataDir);
	const stageRoot = path.resolve(stageDir, "files");
	const inData = (rel) => inside(dataRoot, rel);
	const inStage = (rel) => inside(stageRoot, rel);

	// places the staged file or folder at stageRel as destRel; a file the instance has is moved aside first and its
	// mode kept. transform maps the text of a file.
	const putTree = async (stageRel, destRel, transform) => {
		inData(destRel);
		const from = inStage(stageRel);
		const info = await exists(from);
		if (!info) return;
		if (info.isDirectory()) {
			await journal.ensureFolder(destRel);
			for (const name of (await readdir(from)).sort())
				await putTree(`${stageRel}/${name}`, `${destRel}/${name}`, transform);
			return;
		}
		if (!info.isFile()) throw new Error(`files/${stageRel} is not a regular file`);
		if (transform) await writeFile(from, transform(await readFile(from, "utf8")));
		await journal.placeFile(destRel, from, await journal.setAside(destRel));
	};

	// places the staged account files the instance lacks
	const addMissing = async (rel) => {
		inData(rel);
		const from = inStage(rel);
		const info = await exists(from);
		if (!info) return;
		if (info.isDirectory()) {
			for (const name of (await readdir(from)).sort()) await addMissing(`${rel}/${name}`);
			return;
		}
		if (info.isFile() && !(await exists(inData(rel)))) await journal.placeFile(rel, from);
	};

	return { ...journal, putTree, addMissing, inData, inStage };
};

// the rebuilt renewal conf of every moved certificate that has one, by backup id; the ACME accounts the confs may name
// are the instance's and those placed with the merge
const rebuiltRenewals = async ({ dataDir, stageDir, certificateMoves, placeAccounts }) => {
	const accounts = await accountIds(dataDir);
	if (placeAccounts) for (const id of await accountIds(path.join(stageDir, "files"))) accounts.add(id);
	const out = new Map();
	for (const { from, to } of certificateMoves) {
		const staged = path.join(stageDir, "files", `tls/certbot/renewal/npm-${from}.conf`);
		if (!(await exists(staged))?.isFile()) continue;
		const text = await readFile(staged, "utf8");
		out.set(String(from), rebuildRenewalConf(text, { id: to, dataDir, accounts, label: `#${from}` }));
	}
	return out;
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
 * @param   {boolean}   [options.placeAccounts]   whether the staged ACME accounts the instance lacks are added
 * @returns {Promise<{ undo: () => Promise<void> }>}  staged files are moved, not copied (the stage is disposable);
 *          undo() restores the instance, not the stage. On failure everything is moved back before the original
 *          error rejects (a failing undo is attached as its cause).
 */
const placeMergedFiles = async ({
	dataDir,
	stageDir,
	asideDir,
	certificateMoves,
	takeFiles,
	takeDefaultSite,
	avatarMoves = [],
	placeAccounts = true,
}) => {
	for (const rel of takeFiles) {
		if (!CUSTOM_TYPES.some((type) => TYPES[type].files.allow(rel)))
			throw invalid(`files/${rel} is not a custom file`);
	}
	checkMoves(certificateMoves, "certificate");
	checkMoves(avatarMoves, "picture");
	// a renewal conf that cannot be rebuilt refuses its certificate before anything moves
	const renewals = await rebuiltRenewals({ dataDir, stageDir, certificateMoves, placeAccounts });
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
				await placer.setAside(destRel);
				await placer.putTree(
					rel,
					destRel,
					rel.endsWith(".conf") ? () => renewals.get(String(from)) : undefined,
				);
			}
		}
		if (placeAccounts) await placer.addMissing(ACCOUNTS);
		for (const rel of takeFiles) await placer.putTree(rel, rel);
		for (const { from, to } of avatarMoves) {
			const staged = await namesIn(placer.inStage(AVATAR_DIR));
			const names = staged.filter((name) => isPictureOf(from, name));
			if (names.length === 0) continue;
			for (const name of (await namesIn(placer.inData(AVATAR_DIR))).filter((item) => isPictureOf(to, item))) {
				await placer.setAside(`${AVATAR_DIR}/${name}`);
			}
			for (const name of names) {
				await placer.putTree(`${AVATAR_DIR}/${name}`, `${AVATAR_DIR}/${to}${name.slice(String(from).length)}`);
			}
		}
		if (takeDefaultSite) {
			siteSwap = await swapFiles({ dataDir, stageDir, types: ["settings_default_site"], asideDir });
		}
	} catch (error) {
		try {
			await undo();
		} catch (undoError) {
			error.cause ??= undoError;
		}
		throw error;
	}
	return { undo };
};

export { placeMergedFiles };
