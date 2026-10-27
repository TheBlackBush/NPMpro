import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { placeMergedFiles } from "../lib/backup/merge-files.js";

const setup = async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "npmpro-merge-files-"));
	const dirs = {
		root,
		dataDir: path.join(root, "data"),
		stageDir: path.join(root, "stage"),
		asideDir: path.join(root, "aside"),
	};
	await mkdir(dirs.dataDir);
	await mkdir(path.join(dirs.stageDir, "files"), { recursive: true });
	await mkdir(dirs.asideDir, { mode: 0o700 });
	return dirs;
};

const put = async (file, content) => {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, content);
};

const has = (file) =>
	lstat(file).then(
		() => true,
		() => false,
	);

const IN_THE_WAY = /ENOTDIR|is in the way/u;
const ARCHIVE_12 = /^archive_dir = .*\/tls\/certbot\/archive\/npm-12$/mu;
const LIVE_12 = /^cert = .*\/tls\/certbot\/live\/npm-12\/cert\.pem$/mu;
const NPM_3 = /npm-3\b/u;

const RENEWAL = [
	"archive_dir = /data/tls/certbot/archive/npm-3",
	"cert = /data/tls/certbot/live/npm-3/cert.pem",
	"[renewalparams]",
	"authenticator = webroot",
	"",
].join("\n");

const options = (dirs, extra = {}) => ({
	dataDir: dirs.dataDir,
	stageDir: dirs.stageDir,
	asideDir: dirs.asideDir,
	certificateMoves: [],
	takeFiles: [],
	takeDefaultSite: false,
	...extra,
});

it("places certificate files under the new id and rewrites the renewal conf", async () => {
	const dirs = await setup();
	try {
		const staged = (rel) => path.join(dirs.stageDir, "files", rel);
		await put(staged("tls/certbot/archive/npm-3/cert1.pem"), "cert");
		await put(staged("tls/certbot/renewal/npm-3.conf"), RENEWAL);
		await put(staged("tls/custom/npm-3/fullchain.pem"), "full");
		await put(staged("tls/custom/npm-3.der"), "der");
		await put(staged("tls/mtls/npm-3.pem"), "mtls");
		await put(staged("tls/certbot/live/npm-3.der"), "live");
		const placed = await placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] }));
		const data = (rel) => path.join(dirs.dataDir, rel);
		assert.equal(await readFile(data("tls/certbot/archive/npm-12/cert1.pem"), "utf8"), "cert");
		const conf = await readFile(data("tls/certbot/renewal/npm-12.conf"), "utf8");
		assert.match(conf, ARCHIVE_12);
		assert.match(conf, LIVE_12);
		assert.doesNotMatch(conf, NPM_3);
		for (const rel of ["tls/custom/npm-12/fullchain.pem", "tls/custom/npm-12.der", "tls/mtls/npm-12.pem"]) {
			assert.ok(await has(data(rel)), rel);
		}
		assert.ok(await has(data("tls/certbot/live/npm-12.der")));
		assert.equal((await stat(data("tls/mtls/npm-12.pem"))).mode % 0o1000, 0o600);
		assert.equal((await stat(data("tls/custom/npm-12"))).mode % 0o1000, 0o700);
		await placed.undo();
		assert.deepEqual(await readdir(dirs.dataDir), []);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("copies account files only when the instance lacks them", async () => {
	const dirs = await setup();
	try {
		const acc = "tls/certbot/accounts/acme/dir/abc";
		await put(path.join(dirs.stageDir, "files", acc, "regr.json"), "backup regr");
		await put(path.join(dirs.stageDir, "files", acc, "meta.json"), "backup meta");
		await put(path.join(dirs.dataDir, acc, "regr.json"), "instance regr");
		const placed = await placeMergedFiles(options(dirs));
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "regr.json"), "utf8"), "instance regr");
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "meta.json"), "utf8"), "backup meta");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, acc, "regr.json"), "utf8"), "instance regr");
		assert.equal(await has(path.join(dirs.dataDir, acc, "meta.json")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("takes chosen custom files, leaves the others, and undo restores", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/custom_nginx/http.conf"), "new http");
		await put(path.join(dirs.stageDir, "files/custom_nginx/server.conf"), "new server");
		await put(path.join(dirs.dataDir, "custom_nginx/http.conf"), "old http");
		await put(path.join(dirs.dataDir, "custom_nginx/server.conf"), "old server");
		const placed = await placeMergedFiles(
			options(dirs, { takeFiles: ["custom_nginx/http.conf"], certificateMoves: [{ from: 3, to: 12 }] }),
		);
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/http.conf"), "utf8"), "new http");
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/server.conf"), "utf8"), "old server");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx/http.conf"), "utf8"), "old http");
		assert.equal(await has(path.join(dirs.dataDir, "tls/certbot/archive/npm-12")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("takes the default site and undo brings the old one back", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/html/index.html"), "new site");
		await put(path.join(dirs.dataDir, "public/html/index.html"), "old site");
		const placed = await placeMergedFiles(options(dirs, { takeDefaultSite: true }));
		assert.equal(await readFile(path.join(dirs.dataDir, "public/html/index.html"), "utf8"), "new site");
		await placed.undo();
		assert.equal(await readFile(path.join(dirs.dataDir, "public/html/index.html"), "utf8"), "old site");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("places an added user's picture under its new id", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/avatar/2.png"), "pic");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 2, to: 7 }] }));
		const file = path.join(dirs.dataDir, "public/avatar/7.png");
		assert.equal(await readFile(file, "utf8"), "pic");
		assert.equal((await stat(file)).mode % 0o1000, 0o644);
		await placed.undo();
		assert.equal(await has(file), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("moves a replaced user's old picture aside and undo brings it back", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/public/avatar/5.png"), "new");
		await put(path.join(dirs.dataDir, "public/avatar/5.jpg"), "old");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 5, to: 5 }] }));
		const avatar = (name) => path.join(dirs.dataDir, "public/avatar", name);
		assert.equal(await has(avatar("5.jpg")), false);
		assert.equal(await readFile(avatar("5.png"), "utf8"), "new");
		await placed.undo();
		assert.equal(await readFile(avatar("5.jpg"), "utf8"), "old");
		assert.equal(await has(avatar("5.png")), false);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("changes nothing for a move without a staged picture", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.dataDir, "public/avatar/5.jpg"), "old");
		const placed = await placeMergedFiles(options(dirs, { avatarMoves: [{ from: 5, to: 5 }] }));
		assert.equal(await readFile(path.join(dirs.dataDir, "public/avatar/5.jpg"), "utf8"), "old");
		await placed.undo();
		assert.deepEqual(await readdir(path.join(dirs.dataDir, "public/avatar")), ["5.jpg"]);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

const modeOf = async (file) => (await stat(file)).mode % 0o1000;

it("moves an orphan of the new id aside as a whole", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "backup");
		await put(path.join(dirs.dataDir, "tls/certbot/archive/npm-12/cert5.pem"), "orphan");
		await put(path.join(dirs.dataDir, "tls/custom/npm-12.der"), "orphan der");
		const placed = await placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] }));
		const archive = path.join(dirs.dataDir, "tls/certbot/archive/npm-12");
		assert.deepEqual(await readdir(archive), ["cert1.pem"]);
		assert.equal(await has(path.join(dirs.dataDir, "tls/custom/npm-12.der")), false);
		await placed.undo();
		assert.deepEqual(await readdir(archive), ["cert5.pem"]);
		assert.equal(await readFile(path.join(dirs.dataDir, "tls/custom/npm-12.der"), "utf8"), "orphan der");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("undoes the earlier steps and rejects with the original error when a later step fails", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "backup");
		await put(path.join(dirs.stageDir, "files/custom_nginx/http.conf"), "new http");
		await put(path.join(dirs.dataDir, "custom_nginx"), "a file, not a folder");
		await put(path.join(dirs.dataDir, "tls/certbot/archive/npm-12/cert5.pem"), "orphan");
		await assert.rejects(
			placeMergedFiles(
				options(dirs, { certificateMoves: [{ from: 3, to: 12 }], takeFiles: ["custom_nginx/http.conf"] }),
			),
			(error) => {
				assert.match(error.message, IN_THE_WAY);
				return true;
			},
		);
		assert.deepEqual(await readdir(path.join(dirs.dataDir, "tls/certbot/archive/npm-12")), ["cert5.pem"]);
		assert.equal(await readFile(path.join(dirs.dataDir, "custom_nginx"), "utf8"), "a file, not a folder");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("keeps chained moves apart", async () => {
	const dirs = await setup();
	try {
		const staged = (rel) => path.join(dirs.stageDir, "files", rel);
		await put(staged("tls/certbot/archive/npm-3/cert1.pem"), "three");
		await put(staged("tls/certbot/archive/npm-12/cert1.pem"), "twelve");
		await placeMergedFiles(
			options(dirs, {
				certificateMoves: [
					{ from: 3, to: 12 },
					{ from: 12, to: 20 },
				],
			}),
		);
		const archive = (id) => path.join(dirs.dataDir, `tls/certbot/archive/npm-${id}/cert1.pem`);
		assert.equal(await readFile(archive(12), "utf8"), "three");
		assert.equal(await readFile(archive(20), "utf8"), "twelve");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("adds a taken file the instance lacks and sets the modes", async () => {
	const dirs = await setup();
	try {
		const staged = (rel) => path.join(dirs.stageDir, "files", rel);
		await put(staged("custom_nginx/new.conf"), "new");
		await put(staged("custom_nginx/http.conf"), "new http");
		await put(staged("tls/certbot/accounts/acme/dir/abc/meta.json"), "meta");
		await put(staged("public/avatar/2.png"), "pic");
		await put(path.join(dirs.dataDir, "custom_nginx/http.conf"), "old http");
		await chmod(path.join(dirs.dataDir, "custom_nginx/http.conf"), 0o640);
		await placeMergedFiles(
			options(dirs, {
				takeFiles: ["custom_nginx/new.conf", "custom_nginx/http.conf"],
				avatarMoves: [{ from: 2, to: 7 }],
			}),
		);
		const data = (rel) => path.join(dirs.dataDir, rel);
		assert.equal(await readFile(data("custom_nginx/new.conf"), "utf8"), "new");
		assert.equal(await modeOf(data("custom_nginx/new.conf")), 0o600);
		assert.equal(await modeOf(data("custom_nginx/http.conf")), 0o640);
		assert.equal(await modeOf(data("tls/certbot/accounts/acme/dir/abc/meta.json")), 0o600);
		assert.equal(await modeOf(data("public/avatar/7.png")), 0o644);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("refuses a taken file outside the custom file types before moving anything", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "backup");
		await put(path.join(dirs.stageDir, "files/custom_nginx/http.conf"), "new http");
		for (const rel of ["/etc/passwd", "custom_nginx/../x", "tls/mtls/npm-1.pem", "database.sqlite"]) {
			await assert.rejects(
				placeMergedFiles(
					options(dirs, {
						certificateMoves: [{ from: 3, to: 12 }],
						takeFiles: ["custom_nginx/http.conf", rel],
					}),
				),
				{ code: "invalid-archive" },
			);
			assert.deepEqual(await readdir(dirs.dataDir), []);
		}
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("refuses certificate and avatar moves whose ids are not positive integers before moving anything", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.root, "victim/secret.txt"), "secret");
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "backup");
		const bad = [
			{ certificateMoves: [{ from: "1/../../../../victim", to: 12 }] },
			{ certificateMoves: [{ from: 3, to: "12/../../x" }] },
			{ certificateMoves: [{ from: 3, to: 0 }] },
			{ certificateMoves: [{ from: 3, to: 12 }], avatarMoves: [{ from: "../x", to: 2 }] },
		];
		for (const extra of bad) {
			await assert.rejects(placeMergedFiles(options(dirs, extra)), (error) => {
				assert.equal(error.code, "invalid-archive");
				return true;
			});
			assert.deepEqual(await readdir(dirs.dataDir), []);
		}
		assert.equal(await readFile(path.join(dirs.root, "victim/secret.txt"), "utf8"), "secret");
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

const ACCOUNT = "a".repeat(32);
const OTHER_ACCOUNT = "b".repeat(32);
const CRAFTED_RENEWAL = [
	"version = 5.1.0",
	"archive_dir = /etc",
	"cert = /etc/passwd",
	"privkey = /etc/shadow",
	"chain = /data/tls/certbot/live/npm-3/chain.pem",
	"fullchain = /data/tls/certbot/live/npm-3/fullchain.pem",
	"renew_hook = touch /tmp/top-level",
	"",
	"[renewalparams]",
	`account = ${OTHER_ACCOUNT}`,
	"authenticator = webroot",
	"webroot_path = /etc,",
	"server = https://acme-v02.api.letsencrypt.org/directory",
	"key_type = ecdsa",
	"elliptic_curve = secp384r1",
	"config_dir = /etc",
	"work_dir = /etc/work",
	"deploy_hook = rm -rf /",
	"pre_hook = touch /tmp/pre",
	"post_hook = touch /tmp/post",
	"manual_auth_hook = touch /tmp/auth",
	"installer = nginx",
	"[[webroot_map]]",
	"a.example.com = /etc",
	"b.example.com; = /etc",
	"",
].join("\n");

it("rebuilds the renewal conf of a merged certificate: fixed paths, no hooks, unknown account dropped", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "cert");
		await put(path.join(dirs.stageDir, "files/tls/certbot/renewal/npm-3.conf"), CRAFTED_RENEWAL);
		await mkdir(path.join(dirs.dataDir, `tls/certbot/accounts/acme/directory/${ACCOUNT}`), { recursive: true });
		await placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] }));
		const conf = await readFile(path.join(dirs.dataDir, "tls/certbot/renewal/npm-12.conf"), "utf8");
		const certbot = `${dirs.dataDir}/tls/certbot`;
		assert.equal(
			conf,
			[
				"version = 5.1.0",
				`archive_dir = ${certbot}/archive/npm-12`,
				`cert = ${certbot}/live/npm-12/cert.pem`,
				`privkey = ${certbot}/live/npm-12/privkey.pem`,
				`chain = ${certbot}/live/npm-12/chain.pem`,
				`fullchain = ${certbot}/live/npm-12/fullchain.pem`,
				"",
				"# Options used in the renewal process",
				"[renewalparams]",
				"authenticator = webroot",
				"server = https://acme-v02.api.letsencrypt.org/directory",
				"key_type = ecdsa",
				"elliptic_curve = secp384r1",
				`config_dir = ${certbot}`,
				"work_dir = /tmp/certbot-work",
				`webroot_path = ${dirs.dataDir}/public/acme-challenge,`,
				"[[webroot_map]]",
				`a.example.com = ${dirs.dataDir}/public/acme-challenge`,
				"",
			].join("\n"),
		);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("keeps the account of a merged renewal conf when the instance has it, and the DNS plugin settings", async () => {
	const dirs = await setup();
	try {
		const text = [
			"[renewalparams]",
			`account = ${ACCOUNT}`,
			"authenticator = dns-cloudflare",
			"dns_cloudflare_credentials = /etc/shadow",
			"dns_cloudflare_propagation_seconds = 60",
			"dns_cloudflare_other = x",
			"",
		].join("\n");
		await put(path.join(dirs.stageDir, "files/tls/certbot/renewal/npm-3.conf"), text);
		await mkdir(path.join(dirs.dataDir, `tls/certbot/accounts/acme/directory/${ACCOUNT}`), { recursive: true });
		await placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] }));
		const conf = await readFile(path.join(dirs.dataDir, "tls/certbot/renewal/npm-12.conf"), "utf8");
		assert.equal(
			conf.slice(conf.indexOf("[renewalparams]")),
			[
				"[renewalparams]",
				`account = ${ACCOUNT}`,
				"authenticator = dns-cloudflare",
				"dns_cloudflare_credentials = /tmp/certbot-credentials/credentials-12",
				"dns_cloudflare_propagation_seconds = 60",
				"",
			].join("\n"),
		);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("refuses a merged certificate whose renewal conf has an unknown authenticator before moving anything", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "cert");
		await put(
			path.join(dirs.stageDir, "files/tls/certbot/renewal/npm-3.conf"),
			// biome-ignore lint/security/noSecrets: a renewal conf sample, not a secret
			"[renewalparams]\nauthenticator = manual\nmanual_auth_hook = touch /tmp/x\n",
		);
		await assert.rejects(placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] })), (error) => {
			assert.equal(error.code, "invalid-item");
			assert.equal(error.public, true);
			return true;
		});
		assert.deepEqual(await readdir(dirs.dataDir), []);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("places no account files when told not to", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, `files/tls/certbot/accounts/acme/directory/${ACCOUNT}/meta.json`), "m");
		await placeMergedFiles(options(dirs, { placeAccounts: false }));
		assert.deepEqual(await readdir(dirs.dataDir), []);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});

it("refuses a staged renewal conf that is a folder before moving anything", async () => {
	const dirs = await setup();
	try {
		await put(path.join(dirs.stageDir, "files/tls/certbot/archive/npm-3/cert1.pem"), "cert");
		await put(path.join(dirs.stageDir, "files/tls/certbot/renewal/npm-3.conf/x"), "x");
		await assert.rejects(
			placeMergedFiles(options(dirs, { certificateMoves: [{ from: 3, to: 12 }] })),
			(error) => error.code === "invalid-archive" && error.message.includes("npm-3.conf is not a regular file"),
		);
		assert.deepEqual(await readdir(dirs.dataDir), []);
	} finally {
		await rm(dirs.root, { recursive: true, force: true });
	}
});
