import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";

const BIN = new URL("../../rootfs/usr/local/bin/", import.meta.url);
const HELPER = new URL("secret-files.sh", BIN).pathname;
const ENVS_SH = new URL("envs.sh", BIN);
const SECRET_LINE = /^NPMPRO_SECRET_ENVS="(?<names>[^"]*)"$/mu;
const ECHO_VALUE = /\becho\b[^\n]*secret_file_value/u;
const SECRET_NAMES = [
	"DB_MYSQL_USER",
	"DB_MYSQL_PASSWORD",
	"DB_POSTGRES_USER",
	"DB_POSTGRES_PASSWORD",
	"INITIAL_ADMIN_EMAIL",
	"INITIAL_ADMIN_PASSWORD",
	"ACME_EMAIL",
	"ACME_EAB_KID",
	"ACME_EAB_HMAC_KEY",
	"COOKIE_SECRET",
	"OIDC_CLIENT_ID",
	"OIDC_CLIENT_SECRET",
	"GEOIP_ACCOUNT_ID",
	"GEOIP_LICENSE_KEY",
	"CROWDSEC_API_KEY",
];
// every secret of these tests contains it, so a leak shows in any output; no file name contains it
const MARK = "s3cret-MARK";
const IS_ROOT = process.getuid?.() === 0;

// a work folder with data/ (the data folder), and run/ and secrets/ outside it
const workDir = async () => {
	const work = await mkdtemp(path.join(tmpdir(), "secret-files-"));
	for (const dir of ["data", "run", "secrets"]) await mkdir(path.join(work, dir));
	return work;
};

const secretFile = async (work, name, content) => {
	const file = path.join(work, "secrets", name);
	await writeFile(file, content);
	return file;
};

// runs the helper like envs.sh does; the environment after it goes to a file, so stdout and stderr hold only what the
// helper prints
const read = async (work, env) => {
	const envOut = path.join(work, "env.out");
	await writeFile(envOut, "");
	const out = spawnSync("sh", ["-c", '. "$HELPER"; secret_files_read "$DATA" "$NAMES" || exit 3; env > "$ENV_OUT"'], {
		env: {
			PATH: process.env.PATH,
			HELPER,
			DATA: path.join(work, "data"),
			NAMES: SECRET_NAMES.join(" "),
			ENV_OUT: envOut,
			...env,
		},
		encoding: "utf8",
	});
	const vars = Object.fromEntries(
		(await readFile(envOut, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
	);
	return { status: out.status, stdout: out.stdout, stderr: out.stderr, vars };
};

// the status and the output of a run that must refuse; the tests compare them with refusedAs. A helper holds no
// assertion, so a failing comparison names the test that made it.
const refusal = async (work, env) => {
	const { status, stdout, stderr } = await read(work, env);
	return { status, stdout, stderr };
};
const refusedAs = (message) => ({ status: 3, stdout: `${message}\n`, stderr: "" });

it("reads NAME_FILE into NAME, exports it and unsets every listed NAME_FILE", async () => {
	const work = await workDir();
	const geoip = await secretFile(work, "geoip", `${MARK}-geoip`);
	const link = path.join(work, "run", "geoip");
	await symlink(geoip, link);
	const out = await read(work, {
		COOKIE_SECRET_FILE: await secretFile(work, "cookie", `${MARK}-cookie\n\n\n`),
		INITIAL_ADMIN_PASSWORD_FILE: await secretFile(work, "password", `  inner space ${MARK}  \n`),
		GEOIP_LICENSE_KEY_FILE: link,
		OIDC_CLIENT_ID: "",
		OIDC_CLIENT_ID_FILE: await secretFile(work, "oidc", `${MARK}-oidc`),
		ACME_EMAIL_FILE: "",
		ACME_EAB_KID: "plain-kid",
		DB_SQLITE_FILE: "/x/database.sqlite",
		NPMPRO_SECRET_KEY_FILE: "/y/key",
	});
	assert.equal(out.status, 0, out.stdout + out.stderr);
	assert.equal(out.stdout, "");
	assert.equal(out.stderr, "");
	assert.equal(out.vars.COOKIE_SECRET, `${MARK}-cookie`);
	assert.equal(out.vars.INITIAL_ADMIN_PASSWORD, `  inner space ${MARK}  `);
	assert.equal(out.vars.GEOIP_LICENSE_KEY, `${MARK}-geoip`);
	assert.equal(out.vars.OIDC_CLIENT_ID, `${MARK}-oidc`);
	assert.equal(out.vars.ACME_EAB_KID, "plain-kid");
	assert.equal(Object.hasOwn(out.vars, "ACME_EMAIL"), false);
	for (const name of SECRET_NAMES) assert.equal(Object.hasOwn(out.vars, `${name}_FILE`), false, name);
	assert.equal(out.vars.DB_SQLITE_FILE, "/x/database.sqlite");
	assert.equal(out.vars.NPMPRO_SECRET_KEY_FILE, "/y/key");
});

it("changes nothing when no NAME_FILE is set", async () => {
	const work = await workDir();
	const out = await read(work, { COOKIE_SECRET: "plain", DB_POSTGRES_PASSWORD: "" });
	assert.equal(out.status, 0, out.stdout + out.stderr);
	assert.equal(out.stdout, "");
	assert.equal(out.vars.COOKIE_SECRET, "plain");
	assert.equal(out.vars.DB_POSTGRES_PASSWORD, "");
});

it("stops when NAME and NAME_FILE are both set, naming both and neither value", async () => {
	const work = await workDir();
	assert.deepEqual(
		await refusal(work, {
			COOKIE_SECRET: `${MARK}-plain`,
			COOKIE_SECRET_FILE: await secretFile(work, "cookie", `${MARK}-file`),
		}),
		refusedAs("COOKIE_SECRET and COOKIE_SECRET_FILE are both set: set only one of them."),
	);
});

it("refuses a relative path", async () => {
	const work = await workDir();
	assert.deepEqual(
		await refusal(work, { COOKIE_SECRET_FILE: "run/secrets/cookie" }),
		refusedAs("COOKIE_SECRET_FILE must be an absolute path, such as /run/secrets/<name>."),
	);
});

it("refuses a path in the data folder, through .. or a link into it", async () => {
	const work = await workDir();
	const data = path.join(work, "data");
	const inside = path.join(data, "cookie");
	await writeFile(inside, `${MARK}-inside`);
	const link = path.join(work, "run", "into-data");
	await symlink(inside, link);
	await secretFile(work, "outside", `${MARK}-outside`);
	for (const file of [inside, data, link, `${work}/run/../data/cookie`, `${data}/../secrets/outside`]) {
		assert.deepEqual(
			await refusal(work, { COOKIE_SECRET_FILE: file }),
			refusedAs(
				`COOKIE_SECRET_FILE points to ${file}, which is inside the data folder ${data}: keep secret files outside it, on their own mount such as /run/secrets.`,
			),
		);
	}
});

it("refuses a missing file, a dangling link, a folder and a FIFO", async () => {
	const work = await workDir();
	const missing = path.join(work, "secrets", "missing");
	const dangling = path.join(work, "run", "dangling");
	await symlink(missing, dangling);
	for (const file of [missing, dangling]) {
		assert.deepEqual(
			await refusal(work, { ACME_EAB_HMAC_KEY_FILE: file }),
			refusedAs(
				`ACME_EAB_HMAC_KEY_FILE points to ${file}, which does not exist (or root cannot reach it inside the container).`,
			),
		);
	}
	const fifo = path.join(work, "secrets", "fifo");
	assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
	for (const file of [path.join(work, "secrets"), fifo]) {
		assert.deepEqual(
			await refusal(work, { ACME_EAB_HMAC_KEY_FILE: file }),
			refusedAs(`ACME_EAB_HMAC_KEY_FILE points to ${file}, which is not a regular file.`),
		);
	}
});

it("refuses a file root cannot read", { skip: IS_ROOT && "root reads every file here" }, async () => {
	const work = await workDir();
	const file = await secretFile(work, "locked", `${MARK}-locked`);
	await chmod(file, 0o000);
	assert.deepEqual(
		await refusal(work, { DB_POSTGRES_PASSWORD_FILE: file }),
		refusedAs(
			`DB_POSTGRES_PASSWORD_FILE points to ${file}, which root cannot read: the file must be readable by root inside the container (for example owned by root with mode 600 or 400).`,
		),
	);
});

it("accepts a file of 4096 bytes and refuses one of 4097, a trailing newline included", async () => {
	const work = await workDir();
	const fits = await secretFile(work, "fits", "a".repeat(4096));
	const out = await read(work, { GEOIP_LICENSE_KEY_FILE: fits });
	assert.equal(out.status, 0, out.stdout + out.stderr);
	assert.equal(out.vars.GEOIP_LICENSE_KEY.length, 4096);
	for (const content of [`${"a".repeat(4096)}\n`, `${MARK}${"a".repeat(5000)}`]) {
		const file = await secretFile(work, "big", content);
		assert.deepEqual(
			await refusal(work, { GEOIP_LICENSE_KEY_FILE: file }),
			refusedAs(`GEOIP_LICENSE_KEY_FILE points to ${file}, which is larger than 4096 bytes.`),
		);
	}
});

it("refuses an empty file and one with only newlines", async () => {
	const work = await workDir();
	for (const content of ["", "\n", "\n\n\n"]) {
		const file = await secretFile(work, "empty", content);
		assert.deepEqual(
			await refusal(work, { OIDC_CLIENT_SECRET_FILE: file }),
			refusedAs(`OIDC_CLIENT_SECRET_FILE points to ${file}, which is empty.`),
		);
	}
});

it("refuses a line break or a carriage return inside, also CRLF line ends", async () => {
	const work = await workDir();
	for (const content of [`${MARK}-1\n${MARK}-2\n`, `${MARK}\r\n`, `${MARK}\rmore`, `\n${MARK}`, "\r"]) {
		const file = await secretFile(work, "lines", content);
		assert.deepEqual(
			await refusal(work, { INITIAL_ADMIN_PASSWORD_FILE: file }),
			refusedAs(
				`INITIAL_ADMIN_PASSWORD_FILE points to ${file}, which has a line break or a carriage return inside: the value must be one line (a newline at the end is fine, Windows line ends are not).`,
			),
		);
	}
});

it("takes the data folder from the caller and never echoes the value", async () => {
	const helper = await readFile(HELPER, "utf8");
	assert.equal(helper.includes("/data"), false);
	assert.equal(ECHO_VALUE.test(helper), false);
});

it("lists exactly the 15 secret names once in envs.sh", () => {
	const text = readFileSync(ENVS_SH, "utf8");
	assert.deepEqual(SECRET_LINE.exec(text)?.groups.names.split(" "), SECRET_NAMES);
	assert.equal(text.split("\nNPMPRO_SECRET_ENVS=").length, 2);
});

it("reads the secret files in envs.sh after /data/.env and before NPMPRO_USER_ENV and every check of the values", () => {
	const text = readFileSync(ENVS_SH, "utf8");
	const at = (needle) => {
		const index = text.indexOf(needle);
		assert.notEqual(index, -1, needle);
		return index;
	};
	const source = at(". /usr/local/bin/secret-files.sh");
	const call = at('if ! secret_files_read /data "$NPMPRO_SECRET_ENVS"; then');
	assert.ok(at(". /data/.env\n") < source);
	assert.ok(at('mv -f "$env_sum" /etc/npmpro/env.sha512sum') < source);
	assert.ok(source < call);
	assert.ok(call < at("for name in $NPMPRO_RUNTIME_ENVS $NPMPRO_STARTUP_ENVS; do"));
	assert.ok(call < at('if [ -n "$ACME_EMAIL" ] && ! echo "$ACME_EMAIL" | grep -q "@"; then'));
	assert.ok(call < at('if [ -n "$INITIAL_ADMIN_EMAIL" ] && ! echo "$INITIAL_ADMIN_EMAIL" | grep -q "@.*\\."; then'));
	assert.ok(call < at(`if [ -n "$INITIAL_ADMIN_PASSWORD" ] && { [ "\${#INITIAL_ADMIN_PASSWORD}" -lt 8 ]`));
	const before = text.slice(0, source);
	for (const name of SECRET_NAMES) {
		assert.equal(before.includes(`$${name}`), false, name);
		assert.equal(before.includes(`\${${name}`), false, name);
	}
});

it("envs.sh counts a variable read from a file as set by the user, and stops when both are set", async () => {
	const text = readFileSync(ENVS_SH, "utf8");
	const block = text
		.slice(
			text.indexOf("NPMPRO_SECRET_ENVS="),
			text.indexOf("export NPMPRO_USER_ENV") + "export NPMPRO_USER_ENV".length,
		)
		.replace(". /usr/local/bin/secret-files.sh", '. "$HELPER"')
		.replace('secret_files_read /data "$NPMPRO_SECRET_ENVS"', 'secret_files_read "$DATA" "$NPMPRO_SECRET_ENVS"')
		.replace("sleep inf", "exit 3");
	assert.ok(block.includes('. "$HELPER"') && block.includes('"$DATA"') && block.includes("exit 3"));
	const work = await workDir();
	const file = await secretFile(work, "pg", `${MARK}-pg\n`);
	const run = (env) =>
		spawnSync("sh", ["-c", `${block}\nprintf '%s' "$NPMPRO_USER_ENV"`], {
			env: { PATH: process.env.PATH, HELPER, DATA: path.join(work, "data"), TZ: "UTC", ...env },
			encoding: "utf8",
		});
	const ok = run({ DB_POSTGRES_PASSWORD_FILE: file });
	assert.equal(ok.status, 0, ok.stderr);
	assert.deepEqual(ok.stdout.split(" ").toSorted(), ["DB_POSTGRES_PASSWORD", "TZ"]);
	assert.equal(ok.stderr, "");
	const both = run({ DB_POSTGRES_PASSWORD_FILE: file, DB_POSTGRES_PASSWORD: `${MARK}-plain` });
	assert.equal(both.status, 3);
	assert.equal(
		both.stdout,
		"DB_POSTGRES_PASSWORD and DB_POSTGRES_PASSWORD_FILE are both set: set only one of them.\n",
	);
	assert.equal(`${both.stdout}${both.stderr}`.includes(MARK), false);
});
