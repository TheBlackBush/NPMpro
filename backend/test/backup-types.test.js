import assert from "node:assert/strict";
import { it } from "node:test";
import { allowFile, CATEGORIES, RESTORE_ORDER, TYPES } from "../lib/backup/types.js";
import { RUNTIME_GROUPS } from "../lib/runtime-rules.js";

const box = { decrypt: (s) => JSON.parse(s.slice(3)), encrypt: (o) => `v1:${JSON.stringify(o)}` };
const otherBox = { decrypt: (s) => JSON.parse(s.slice(3)), encrypt: (o) => `v1:other:${JSON.stringify(o)}` };

it("restore order holds every type of the categories exactly once", () => {
	const types = CATEGORIES.flatMap((category) => category.types);
	assert.equal(new Set(types).size, types.length);
	assert.equal(RESTORE_ORDER.length, types.length);
	assert.deepEqual(new Set(RESTORE_ORDER), new Set(types));
	assert.deepEqual(new Set(Object.keys(TYPES)), new Set(types));
});

it("selects the runtime setting groups", () => {
	const ids = [];
	const qb = { whereIn: (column, values) => ids.push(column, values) };
	const [{ table, where }] = TYPES.settings_runtime.tables;
	assert.equal(table, "setting");
	where(qb);
	assert.deepEqual(ids, ["id", RUNTIME_GROUPS]);
});

it("allows only the chosen types' files", () => {
	assert.equal(allowFile(["custom_nginx"], "files/custom_nginx/http.conf"), true);
	assert.equal(allowFile(["custom_nginx"], "files/npmpro/keys-ec.json"), false);
	assert.equal(allowFile(["users"], "files/custom_nginx/http.conf"), false);
	assert.equal(allowFile(["custom_nginx"], "custom_nginx/http.conf"), false);
	assert.equal(allowFile(["unknown"], "files/custom_nginx/http.conf"), false);
	assert.equal(allowFile(["users"], "files/public/avatar/1.png"), true);
	assert.equal(allowFile(["settings_default_site"], "files/public/html/index.html"), true);
	assert.equal(allowFile(["crowdsec_files"], "files/crowdsec/crowdsec.conf"), true);
	assert.equal(allowFile(["crowdsec_files"], "files/crowdsec/acquis.yaml"), false);
});

it("allows the certificate files and not the live symlinks", () => {
	const ok = [
		"tls/certbot/archive/npm-3/privkey1.pem",
		"tls/certbot/archive/npm-3/fullchain12.pem",
		"tls/certbot/renewal/npm-3.conf",
		"tls/certbot/accounts/acme-v02.api.letsencrypt.org/directory/abc/private_key.json",
		"tls/custom/npm-3/privkey.pem",
		"tls/custom/npm-3/chain.pem",
		"tls/custom/npm-3.der",
		"tls/certbot/live/npm-3.der",
		"tls/mtls/npm-3.pem",
	];
	for (const rel of ok) assert.equal(allowFile(["certificates"], `files/${rel}`), true, rel);
	const refused = [
		"tls/certbot/live/npm-3/privkey.pem",
		"tls/certbot/live/npm-3",
		"tls/certbot/archive/npm-3/privkey.pem.bak",
		"tls/certbot/renewal/other.conf",
		"tls/ech/nginx.conf",
		"tls/dummycert.pem",
	];
	for (const rel of refused) assert.equal(allowFile(["certificates"], `files/${rel}`), false, rel);
});

it("allows the folders that lead to allowed files, for copying and extraction", () => {
	const { allow } = TYPES.certificates.files;
	for (const dir of [
		"tls",
		"tls/certbot",
		"tls/certbot/archive",
		"tls/certbot/archive/npm-3",
		"tls/certbot/renewal",
		"tls/certbot/accounts",
		"tls/certbot/accounts/acme-v02.api.letsencrypt.org",
		"tls/certbot/live",
		"tls/custom",
		"tls/custom/npm-3",
		"tls/mtls",
	]) {
		assert.equal(allow(dir), true, dir);
	}
	assert.equal(allow("tls/ech"), false);
	assert.equal(TYPES.users.files.allow("public"), true);
	assert.equal(TYPES.users.files.allow("public/html"), false);
	assert.equal(TYPES.crowdsec_files.files.allow("crowdsec"), true);
	for (const [id, type] of Object.entries(TYPES)) {
		for (const root of type.files.roots) assert.equal(type.files.allow(root), true, `${id} ${root}`);
	}
});

it("marks private keys and the bouncer config as secret files", () => {
	const { secret } = TYPES.certificates.files;
	assert.equal(secret("tls/certbot/archive/npm-3/privkey1.pem"), true);
	assert.equal(secret("tls/custom/npm-3/privkey.pem"), true);
	assert.equal(secret("tls/certbot/accounts/x/directory/abc/private_key.json"), true);
	assert.equal(secret("tls/certbot/accounts/x/directory/abc/regr.json"), false);
	assert.equal(secret("tls/certbot/archive/npm-3/fullchain1.pem"), false);
	assert.equal(TYPES.crowdsec_files.files.secret("crowdsec/crowdsec.conf"), true);
	assert.equal(TYPES.crowdsec_files.files.secret("crowdsec/ban.html"), false);
	assert.equal(TYPES.custom_nginx.files.secret("custom_nginx/http.conf"), false);
});

it("round trips dns credential values through export, strip and seal", () => {
	const { secrets } = TYPES.dns_credentials;
	const stored = { npmpro_dns_credential: [{ id: 1, values: box.encrypt({ token: "t" }) }] };
	const exported = secrets.export(stored, box);
	assert.deepEqual(exported.npmpro_dns_credential[0].values, { token: "t" });
	assert.equal(stored.npmpro_dns_credential[0].values, 'v1:{"token":"t"}');
	const sealed = secrets.seal(exported, otherBox);
	assert.equal(sealed.npmpro_dns_credential[0].values, 'v1:other:{"token":"t"}');
	assert.deepEqual(secrets.strip(exported).npmpro_dns_credential[0].values, {});
	assert.equal(secrets.seal(secrets.strip(exported), otherBox).npmpro_dns_credential[0].values, "v1:other:{}");
});

it("strips the user secrets and round trips totp secrets", () => {
	const { secrets } = TYPES.users;
	const auth = [
		{ id: 1, secret: "$argon2id$hash", type: "password", user_id: 1 },
		{ id: 2, secret: box.encrypt({ totp: "BASE32" }), type: "totp", user_id: 1 },
		{ id: 3, secret: "PLAIN32", type: "totp_pending", user_id: 2 },
		{ id: 4, secret: "$argon2id$code", type: "backup_code", user_id: 1 },
		{ id: 5, secret: "", type: "oidc", user_id: 2 },
	];
	const rows = { auth, user: [{ id: 1 }, { id: 2 }] };
	const stripped = secrets.strip(rows);
	assert.deepEqual(
		stripped.auth.map((row) => row.id),
		[5],
	);
	assert.equal(stripped.user.length, 2);
	assert.equal(rows.auth.length, 5);

	const exported = secrets.export(rows, box);
	assert.equal(exported.auth[0].secret, "$argon2id$hash");
	assert.equal(exported.auth[1].secret, "BASE32");
	assert.equal(exported.auth[2].secret, "PLAIN32");
	const sealed = secrets.seal(exported, otherBox);
	assert.equal(sealed.auth[0].secret, "$argon2id$hash");
	assert.equal(sealed.auth[1].secret, 'v1:other:{"totp":"BASE32"}');
	assert.equal(sealed.auth[2].secret, 'v1:other:{"totp":"PLAIN32"}');
	assert.equal(sealed.auth[3].secret, "$argon2id$code");
});

it("blanks access list passwords when stripped", () => {
	const rows = { access_list: [{ id: 1 }], access_list_auth: [{ id: 1, password: "$2b$hash", username: "a" }] };
	const stripped = TYPES.access_lists.secrets.strip(rows);
	assert.deepEqual(stripped.access_list_auth, [{ id: 1, password: "", username: "a" }]);
	assert.deepEqual(TYPES.access_lists.secrets.export(rows, box), rows);
});

it("opens, strips and seals the oidc client secret and the geoip license key", () => {
	const oidc = { setting: [{ id: "oidc", meta: { client_id: "c", client_secret: box.encrypt("s") } }] };
	const opened = TYPES.settings_oidc.secrets.export(oidc, box);
	assert.equal(opened.setting[0].meta.client_secret, "s");
	assert.deepEqual(TYPES.settings_oidc.secrets.strip(opened).setting[0].meta, { client_id: "c" });
	assert.equal(TYPES.settings_oidc.secrets.seal(opened, otherBox).setting[0].meta.client_secret, 'v1:other:"s"');

	const monitoring = {
		setting: [
			{ id: "monitoring", meta: { traffic_enabled: true } },
			{ id: "geoip", meta: { account_id: "1", license_key: box.encrypt("k") } },
		],
	};
	const openedGeoip = TYPES.settings_monitoring.secrets.export(monitoring, box);
	assert.equal(openedGeoip.setting[1].meta.license_key, "k");
	assert.deepEqual(openedGeoip.setting[0], monitoring.setting[0]);
	assert.deepEqual(TYPES.settings_monitoring.secrets.strip(openedGeoip).setting[1].meta, { account_id: "1" });
	assert.equal(
		TYPES.settings_monitoring.secrets.seal(openedGeoip, otherBox).setting[1].meta.license_key,
		'v1:other:"k"',
	);
});
