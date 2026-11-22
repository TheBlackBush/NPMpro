import assert from "node:assert/strict";
import { it } from "node:test";
import knexFactory from "knex";
import { checkPageImport } from "../lib/backup/import-checks.js";
import { mergeTypes } from "../lib/backup/merge-db.js";
import { planMerge, readInstanceRows } from "../lib/backup/merge-plan.js";
import { planReferences } from "../lib/backup/references.js";
import { previewReplace, replaceTypes } from "../lib/backup/restore-db.js";
import { selectRows } from "../lib/backup/select.js";
import { TYPES } from "../lib/backup/types.js";
import { createSchema } from "./support/backup-schema.js";

process.env.TZ = "UTC";

const box = { encrypt: (value) => `v1:${JSON.stringify(value)}`, decrypt: (value) => JSON.parse(value.slice(3)) };
const NOW = 1_800_000_000;
const STAMP = "2026-11-23 12:00:00";
const SCOPE = {
	adminUserId: 1,
	importerId: 1,
	page: false,
	canView: () => true,
	canManage: () => true,
	canEdit: () => true,
	visibleOwnerId: null,
};

const open = async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	await createSchema(knex);
	return knex;
};

const credential = (id, owner, name) => ({ id, owner_user_id: owner, name, values: {} });
const domain = (id, credentialId, name, extra = {}) => ({
	id,
	dns_credential_id: credentialId,
	name,
	source: "typed",
	created_on: STAMP,
	modified_on: STAMP,
	...extra,
});
const credentialsData = (credentials, domains) => ({
	dns_credentials: { npmpro_dns_credential: credentials, npmpro_dns_domain: domains },
});

const merge = async (knex, { data, choices, items }) => {
	const types = ["dns_credentials"];
	const instance = { ...(await readInstanceRows(knex)), files: {} };
	const plan = planMerge({ data, instance, stageFiles: {}, types, items, choices, scope: SCOPE, secrets: true });
	return await mergeTypes({
		knex,
		data,
		plan,
		adminUserId: 1,
		importerId: 1,
		page: false,
		box,
		secrets: true,
		now: NOW,
	});
};

it("the dns_credentials type holds the domains and a page export keeps only the chosen credentials' domains", () => {
	assert.deepEqual(
		TYPES.dns_credentials.tables.map(({ table }) => table),
		["npmpro_dns_credential", "npmpro_dns_domain"],
	);
	const rows = {
		npmpro_dns_credential: [credential(1, 1, "a"), credential(2, 1, "b")],
		npmpro_dns_domain: [domain(1, 1, "a.example"), domain(2, 2, "b.example")],
	};
	const chosen = selectRows("dns_credentials", rows, ["2"]);
	assert.deepEqual(
		chosen.npmpro_dns_domain.map((row) => row.name),
		["b.example"],
	);
});

it("a replace restore drops a domain whose credential is not in the backup, with a note", async () => {
	const knex = await open();
	try {
		const data = credentialsData(
			[credential(1, 1, "cf")],
			[domain(1, 1, "a.example"), domain(2, 9, "orphan.example")],
		);
		const preview = await previewReplace({ knex, data, types: ["dns_credentials"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		const note = "DNS domain orphan.example: credential #9 not found";
		assert.deepEqual(
			preview.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(
			result.references.map((change) => change.label),
			[note],
		);
		assert.deepEqual(await knex("npmpro_dns_domain").pluck("name"), ["a.example"]);
	} finally {
		await knex.destroy();
	}
});

it("owner handed to the admin: a duplicate domain of the admin goes, the restore succeeds", async () => {
	const knex = await open();
	try {
		const data = credentialsData(
			[credential(1, 7, "from user 7"), credential(2, 1, "admin's")],
			[domain(1, 1, "a.example"), domain(2, 2, "a.example"), domain(3, 2, "b.example")],
		);
		const preview = await previewReplace({ knex, data, types: ["dns_credentials"], adminUserId: 1 });
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		const note = "DNS domain a.example: the owner keeps it on DNS credential from user 7";
		for (const references of [preview.references, result.references]) {
			assert.equal(references.filter((change) => change.remove).length, 1);
			assert.equal(references.find((change) => change.remove).label, note);
		}
		assert.deepEqual(
			(await knex("npmpro_dns_domain").orderBy("id")).map((row) => [row.dns_credential_id, row.name]),
			[
				[1, "a.example"],
				[2, "b.example"],
			],
		);
	} finally {
		await knex.destroy();
	}
});

it("a merge adds a credential with its domains and skips a name the owner keeps", async () => {
	const knex = await open();
	try {
		await knex("npmpro_dns_credential").insert({ id: 1, owner_user_id: 1, name: "Existing", values: "v1:{}" });
		await knex("npmpro_dns_domain").insert(domain(1, 1, "keep.example"));
		const data = credentialsData(
			[credential(3, 1, "Imported")],
			[domain(5, 3, "keep.example"), domain(6, 3, "new.example", { source: "fetched" })],
		);
		const result = await merge(knex, { data, choices: { "dns_credentials:3": "add" } });
		const added = result.maps.npmpro_dns_credential.get("3");
		assert.deepEqual(result.skipped_domains, [{ name: "keep.example", credential: "Imported" }]);
		const rows = await knex("npmpro_dns_domain").where({ dns_credential_id: added });
		assert.deepEqual(
			rows.map((row) => [row.name, row.source]),
			[["new.example", "fetched"]],
		);
	} finally {
		await knex.destroy();
	}
});

it("a merge onto an existing credential adds no domain", async () => {
	const knex = await open();
	try {
		await knex("npmpro_dns_credential").insert({ id: 1, owner_user_id: 1, name: "Cloudflare", values: "v1:{}" });
		const data = credentialsData([credential(3, 1, "Cloudflare")], [domain(5, 3, "new.example")]);
		const result = await merge(knex, { data, choices: { "dns_credentials:3": "existing" } });
		assert.equal(result.maps.npmpro_dns_credential.get("3"), 1);
		assert.deepEqual(result.skipped_domains, []);
		assert.equal((await knex("npmpro_dns_domain")).length, 0);
	} finally {
		await knex.destroy();
	}
});

it("the import check refuses a domain row that is not in its stored form", async () => {
	const knex = await open();
	try {
		const items = [
			{ key: "dns_credentials:1", type: "dns_credentials", id: 1, label: "cf", action: "add", target: null },
		];
		const check = (rows) =>
			checkPageImport({ knex, plan: { items }, data: credentialsData([credential(1, 1, "cf")], rows) });
		await check([domain(1, 1, "a.example")]);
		for (const bad of [
			domain(1, 1, "Example.COM"),
			domain(1, 1, "*.example.com"),
			domain(1, 1, "a.example", { source: "x" }),
		]) {
			await assert.rejects(
				check([bad]),
				(error) => error.code === "invalid-item" && error.message.includes("domains"),
			);
		}
	} finally {
		await knex.destroy();
	}
});

it("a backup made before DNS domains has no domain table: a replace restore treats it as empty", async () => {
	const knex = await open();
	try {
		await knex("npmpro_dns_credential").insert({ id: 1, owner_user_id: 1, name: "Old", values: "v1:{}" });
		await knex("npmpro_dns_domain").insert(domain(1, 1, "kept-until-restore.example"));
		const data = { dns_credentials: { npmpro_dns_credential: [credential(1, 1, "From backup")] } };
		const result = await replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW });
		assert.deepEqual(result.references, []);
		assert.deepEqual(await knex("npmpro_dns_credential").pluck("name"), ["From backup"]);
		assert.equal((await knex("npmpro_dns_domain")).length, 0);
	} finally {
		await knex.destroy();
	}
});

it("a backup made before DNS domains has no domain table: a merge adds the credential without domains", async () => {
	const knex = await open();
	try {
		const data = { dns_credentials: { npmpro_dns_credential: [credential(3, 1, "Imported")] } };
		const result = await merge(knex, { data, choices: { "dns_credentials:3": "add" } });
		assert.ok(result.maps.npmpro_dns_credential.get("3"));
		assert.deepEqual(result.skipped_domains, []);
		assert.equal((await knex("npmpro_dns_domain")).length, 0);
	} finally {
		await knex.destroy();
	}
});

it("a replace restore refuses a domain row that is not in its stored form", async () => {
	const knex = await open();
	try {
		for (const bad of [domain(1, 1, "Example.COM"), domain(1, 1, "a.example", { source: "x" })]) {
			const data = credentialsData([credential(1, 1, "cf")], [bad]);
			await assert.rejects(
				replaceTypes({ knex, data, types: ["dns_credentials"], adminUserId: 1, box, now: NOW }),
				{ code: "invalid-archive" },
			);
		}
	} finally {
		await knex.destroy();
	}
});

it("a replace restore keeps one name once per owner whatever its case", () => {
	const finalRows = {
		user: [{ id: 1 }],
		npmpro_dns_credential: [credential(1, 1, "a"), credential(2, 1, "b")],
		npmpro_dns_domain: [domain(1, 1, "x.example"), domain(2, 2, "X.example")],
	};
	const changes = planReferences({ finalRows, adminUserId: 1 });
	assert.deepEqual(
		changes.map((change) => [change.table, change.id, change.remove]),
		[["npmpro_dns_domain", 2, true]],
	);
});
