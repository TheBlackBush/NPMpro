import assert from "node:assert/strict";
import { after, it } from "node:test";
import knexFactory from "knex";
import { createOidcIdentity } from "../internal/oidc-identity.js";
import { identityOf, linkAction } from "../lib/oidc-identity.js";
import { up } from "../migrations/20261112120000_oidc_identity_link.js";

const ISS = "https://idp.example.com";
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
const opened = [];
after(() => Promise.all(opened.map((knex) => knex.destroy())));

const make = async ({ writable = true } = {}) => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	opened.push(knex);
	await knex.schema.createTable("user", (table) => {
		table.increments().primary();
		table.string("email").notNull();
		table.string("name").notNull();
	});
	await up(knex);
	await knex("user").insert([
		{ id: 1, email: "a@example.com", name: "A" },
		{ id: 2, email: "b@example.com", name: "B" },
	]);
	const audits = [];
	const releases = [];
	const service = createOidcIdentity({
		knex,
		audit: (entry) => {
			audits.push(entry);
			return Promise.resolve();
		},
		tryBeginWrite: () => (writable ? () => releases.push(true) : null),
	});
	const row = (id) => knex("user").where({ id }).first();
	return { knex, service, audits, releases, row };
};

it("reads issuer and subject from the claims", () => {
	assert.deepEqual(identityOf({ iss: ISS, sub: "s1", email: "a@example.com" }), { issuer: ISS, subject: "s1" });
	assert.equal(identityOf({ iss: ISS }), null);
	assert.equal(identityOf({ iss: "", sub: "s1" }), null);
	assert.equal(identityOf({ iss: ISS, sub: 5 }), null);
	assert.equal(identityOf({ iss: ISS, sub: "x".repeat(256) }), null);
	assert.equal(identityOf(undefined), null);
});

it("decides what a sign-in does with the link", () => {
	const id = { issuer: ISS, subject: "s1" };
	const unlinked = { id: 1, npmpro_oidc_issuer: null, npmpro_oidc_subject: null };
	const linked = { id: 1, npmpro_oidc_issuer: ISS, npmpro_oidc_subject: "s1" };
	assert.equal(linkAction(unlinked, id, null), "link");
	assert.equal(linkAction(linked, id, 1), "ok");
	assert.equal(linkAction({ ...linked, npmpro_oidc_subject: "s2" }, id, null), "mismatch");
	assert.equal(linkAction({ ...linked, npmpro_oidc_issuer: "https://old.example.com" }, id, null), "relink");
	// the subject belongs to another user (R2)
	assert.equal(linkAction(unlinked, id, 2), "mismatch");
	assert.equal(linkAction({ ...linked, npmpro_oidc_issuer: "https://old.example.com" }, id, 2), "mismatch");
	// no user yet (auto-create): a free subject links, a held one is refused
	assert.equal(linkAction(null, id, null), "link");
	assert.equal(linkAction(null, id, 2), "mismatch");
	// the email plays no part: a renamed user keeps its link (Review Focus 1)
	assert.equal(linkAction({ ...linked, email: "new@example.com" }, id, 1), "ok");
});

it("links a user and audits it", async () => {
	const { service, audits, releases, row } = await make();
	const identity = { issuer: ISS, subject: "s1" };
	assert.equal(await service.holderOf(identity), null);
	assert.equal(await service.link(await row(1), identity, "link"), "linked");
	const linked = await row(1);
	assert.equal(linked.npmpro_oidc_issuer, ISS);
	assert.equal(linked.npmpro_oidc_subject, "s1");
	// local time text, as created_on is written on SQLite
	assert.match(linked.npmpro_oidc_linked_on, LOCAL_TIME);
	assert.equal(await service.holderOf(identity), 1);
	assert.deepEqual(audits, [
		{
			user_id: 1,
			action: "oidc-linked",
			object_type: "user",
			object_id: 1,
			meta: { name: "A", email: "a@example.com", issuer: ISS },
		},
	]);
	assert.equal(releases.length, 1);
});

it("marks a relink in the audit meta", async () => {
	const { service, audits, row } = await make();
	await service.link(await row(1), { issuer: "https://old.example.com", subject: "s1" }, "link");
	assert.equal(await service.link(await row(1), { issuer: ISS, subject: "s9" }, "relink"), "linked");
	assert.equal((await row(1)).npmpro_oidc_issuer, ISS);
	assert.equal(audits[1].meta.relinked, true);
});

it("a unique violation becomes a mismatch, not an error (Review Focus 2)", async () => {
	const { service, knex, audits, releases, row } = await make();
	const identity = { issuer: ISS, subject: "s1" };
	await knex("user").where({ id: 2 }).update({ npmpro_oidc_issuer: ISS, npmpro_oidc_subject: "s1" });
	assert.equal(await service.link(await row(1), identity, "link"), "mismatch");
	assert.equal((await row(1)).npmpro_oidc_subject, null);
	assert.equal(audits.length, 0);
	assert.equal(releases.length, 1);
});

it("a failure that is not a unique violation is rethrown without the subject", async () => {
	const { service, knex, audits, releases, row } = await make();
	const user = await row(1);
	await knex.schema.dropTable("user");
	await assert.rejects(service.link(user, { issuer: ISS, subject: "unique-duplicate-x" }, "link"), (err) => {
		assert.equal(err.code, "SQLITE_ERROR");
		assert.doesNotMatch(err.message, /unique-duplicate-x/u);
		return true;
	});
	assert.equal(audits.length, 0);
	assert.equal(releases.length, 1);
});

it("skips the write during a database move (R3)", async () => {
	const { service, audits, row } = await make({ writable: false });
	assert.equal(await service.link(await row(1), { issuer: ISS, subject: "s1" }, "link"), "skipped");
	assert.equal((await row(1)).npmpro_oidc_subject, null);
	assert.equal(audits.length, 0);
});

it("unlinks a user", async () => {
	const { service, knex, row } = await make();
	await knex("user").where({ id: 1 }).update({
		npmpro_oidc_issuer: ISS,
		npmpro_oidc_subject: "s1",
		npmpro_oidc_linked_on: "2026-11-12 12:00:00",
	});
	assert.equal(await service.unlink(1), true);
	const unlinked = await row(1);
	assert.equal(unlinked.npmpro_oidc_issuer, null);
	assert.equal(unlinked.npmpro_oidc_subject, null);
	assert.equal(unlinked.npmpro_oidc_linked_on, null);
	assert.equal(await service.unlink(1), false);
	assert.equal(await service.unlink(99), false);
});
