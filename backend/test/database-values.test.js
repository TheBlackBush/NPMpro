import assert from "node:assert/strict";
import { it } from "node:test";

process.env.TZ = "America/New_York";
const { default: knexFactory } = await import("knex");
const { columnKinds, comparable, describeDifference, firstDifference, kindOfType, portableRow, targetRow } =
	await import("../lib/database/values.js");

const kindsOf = (types) =>
	Object.fromEntries(Object.entries(types).map(([column, [source, target]]) => [column, { source, target }]));

it("takes the kind from the real column types of each engine", async () => {
	const knex = knexFactory({
		client: "better-sqlite3",
		connection: { filename: ":memory:" },
		useNullAsDefault: true,
	});
	try {
		await knex.schema.createTable("t", (t) => {
			t.increments("id");
			t.json("meta");
			t.boolean("enabled");
			t.dateTime("created_on");
			t.binary("blob");
			t.string("time", 5);
			t.tinyint("flag");
			t.bigInteger("bytes");
		});
		const info = await knex("t").columnInfo();
		const kinds = columnKinds(info, info);
		assert.deepEqual(Object.fromEntries(Object.entries(kinds).map(([column, { source }]) => [column, source])), {
			id: null,
			meta: "json",
			enabled: "bool",
			created_on: "date",
			blob: "binary",
			time: null,
			flag: null,
			bytes: null,
		});
	} finally {
		await knex.destroy();
	}
	assert.equal(kindOfType("timestamp with time zone"), "date");
	assert.equal(kindOfType("character varying"), null);
	assert.equal(kindOfType("bytea"), "binary");
	assert.equal(kindOfType("boolean"), "bool");
});

it("makes portable rows from each source engine", () => {
	const kinds = kindsOf({
		meta: ["json", "json"],
		names: ["json", "json"],
		label: ["json", "json"],
		created_on: ["date", "date"],
		bytes: [null, null],
		blob: ["binary", "binary"],
		note: [null, null],
		gone: [null, null],
	});
	const buffer = Buffer.from([0, 1, 255]);
	// what pg returns
	assert.deepEqual(
		portableRow(
			kinds,
			{
				meta: { a: 1 },
				names: ["x.example.com"],
				label: "abc",
				created_on: new Date("2026-10-29T14:00:00.000Z"),
				bytes: "5000000000",
				blob: buffer,
				note: "",
				gone: null,
			},
			"postgres",
		),
		{
			meta: '{"a":1}',
			names: '["x.example.com"]',
			label: '"abc"',
			created_on: "2026-10-29T14:00:00.000Z",
			bytes: "5000000000",
			blob: buffer,
			note: "",
			gone: null,
		},
	);
	// what SQLite returns: the stored text stays as it is
	assert.deepEqual(
		portableRow(kinds, { meta: '{ "a": 1 }', created_on: "2026-10-29 10:00:00", bytes: 5_000_000_000 }, "sqlite"),
		{ meta: '{ "a": 1 }', created_on: "2026-10-29 10:00:00", bytes: 5_000_000_000 },
	);
	assert.deepEqual(portableRow(kinds, { bytes: 12n }, "sqlite"), { bytes: "12" });
});

it("writes booleans, dates and JSON as each target takes them", () => {
	const kinds = (target) =>
		kindsOf({ enabled: ["bool", target], created_on: ["date", "date"], meta: ["json", "json"], n: [null, null] });
	const row = { enabled: 1, created_on: "2026-10-29 10:00:00", meta: '{"a":1}', n: "" };
	// 10:00 EDT is 14:00Z
	assert.deepEqual(targetRow(kinds("bool"), row, "postgres"), {
		enabled: true,
		created_on: "2026-10-29T14:00:00.000Z",
		meta: '{"a":1}',
		n: "",
	});
	assert.deepEqual(targetRow(kinds("bool"), { ...row, enabled: true }, "sqlite"), { ...row, enabled: 1 });
	// MySQL has tinyint for knex booleans: 1/0
	assert.deepEqual(targetRow(kinds(null), { ...row, enabled: false }, "mysql").enabled, 0);
	assert.deepEqual(
		targetRow(kinds("bool"), { ...row, created_on: "2026-10-29T14:00:00.000Z" }, "mysql").created_on,
		"2026-10-29 10:00:00",
	);
	// SQLite to SQLite keeps the text, also a time in the spring-forward gap
	assert.equal(
		targetRow(kinds("bool"), { ...row, created_on: "2026-03-08 02:30:00" }, "sqlite").created_on,
		"2026-03-08 02:30:00",
	);
	assert.deepEqual(targetRow(kinds("bool"), { enabled: null, n: null }, "postgres"), { enabled: null, n: null });
});

it("compares meaning, not representation", () => {
	assert.equal(comparable("bool", true, "postgres"), comparable("bool", 1, "sqlite"));
	assert.equal(comparable("bool", false, "postgres"), comparable("bool", 0, "mysql"));
	assert.equal(comparable(null, "5000000000", "postgres"), comparable(null, 5_000_000_000, "sqlite"));
	assert.notEqual(comparable(null, "", "sqlite"), comparable(null, null, "sqlite"));
	assert.equal(
		comparable("json", { a: 1, b: [2] }, "postgres"),
		comparable("json", '{ "a": 1, "b": [2] }', "sqlite"),
	);
	assert.equal(comparable("json", "abc", "postgres"), comparable("json", '"abc"', "sqlite"));
	assert.notEqual(comparable("json", { a: 1 }, "postgres"), comparable("json", '{"a":2}', "sqlite"));
	assert.equal(
		comparable("date", new Date("2026-10-29T14:00:00.000Z"), "postgres"),
		comparable("date", "2026-10-29 10:00:00", "sqlite"),
	);
	assert.equal(
		comparable("binary", Buffer.from("ab"), "postgres"),
		comparable("binary", Buffer.from("ab"), "sqlite"),
	);
	assert.equal(comparable(null, null, "sqlite"), null);
});

it("names the first column that differs", () => {
	const kinds = kindsOf({ id: [null, null], enabled: ["bool", "bool"], meta: ["json", "json"], name: [null, null] });
	const source = { id: 1, enabled: 1, meta: '{"a":1}', name: "a" };
	assert.equal(
		firstDifference(kinds, source, { id: 1, enabled: true, meta: { a: 1 }, name: "a" }, "sqlite", "postgres"),
		null,
	);
	assert.equal(
		firstDifference(kinds, source, { id: 1, enabled: true, meta: { a: 1 }, name: "" }, "sqlite", "postgres"),
		"name",
	);
	assert.equal(
		firstDifference(kinds, source, { id: 1, enabled: false, meta: { a: 1 }, name: "a" }, "sqlite", "postgres"),
		"enabled",
	);
});

it("compares booleans from every engine by meaning", () => {
	for (const [engine, yes, no] of [
		["postgres", true, false],
		["sqlite", 1, 0],
		["mysql", 1, 0],
		["postgres", "t", "f"],
	]) {
		assert.equal(comparable("bool", yes, engine), "1");
		assert.equal(comparable("bool", no, engine), "0");
	}
	// a MySQL tinyint column has no bool kind: the kind of the other side decides
	const kinds = kindsOf({ enabled: ["bool", null] });
	assert.equal(firstDifference(kinds, { enabled: true }, { enabled: 1 }, "postgres", "mysql"), null);
	assert.equal(firstDifference(kinds, { enabled: true }, { enabled: 0 }, "postgres", "mysql"), "enabled");
	assert.equal(
		firstDifference(kindsOf({ enabled: [null, "bool"] }), { enabled: 1 }, { enabled: true }, "mysql", "postgres"),
		null,
	);
	assert.deepEqual(targetRow(kindsOf({ enabled: [null, "bool"] }), { enabled: 0 }, "postgres"), { enabled: false });
});

it("keeps big integers exact", () => {
	assert.equal(comparable(null, "5000000000", "postgres"), "5000000000");
	assert.equal(comparable(null, 5_000_000_000, "mysql"), "5000000000");
	// past Number.MAX_SAFE_INTEGER only a bigint or a string is exact
	assert.equal(comparable(null, 9_007_199_254_740_993n, "sqlite"), comparable(null, "9007199254740993", "postgres"));
	assert.notEqual(comparable(null, "9007199254740993", "postgres"), comparable(null, "9007199254740992", "sqlite"));
	assert.deepEqual(portableRow({}, { n: 9_007_199_254_740_993n }, "sqlite"), { n: "9007199254740993" });
	assert.equal(comparable(null, 0, "sqlite"), comparable(null, "0", "postgres"));
	assert.notEqual(comparable(null, 0, "sqlite"), comparable(null, null, "sqlite"));
});

it("compares decimals by value and keeps their precision", () => {
	assert.equal(kindOfType("numeric"), "decimal");
	assert.equal(kindOfType("decimal(10,2)"), "decimal");
	assert.equal(kindOfType("double precision"), "decimal");
	assert.equal(kindOfType("bigint"), null);
	// pg returns numeric as text with its scale, SQLite as a number
	assert.equal(comparable("decimal", "1.50", "postgres"), comparable("decimal", 1.5, "sqlite"));
	assert.equal(comparable("decimal", "-0.10", "postgres"), comparable("decimal", -0.1, "sqlite"));
	assert.equal(comparable("decimal", "0.00", "postgres"), comparable("decimal", 0, "sqlite"));
	const wide = `${"9".repeat(20)}.12`;
	assert.equal(comparable("decimal", `+0${wide}00`, "postgres"), wide);
	assert.notEqual(comparable("decimal", "1.51", "postgres"), comparable("decimal", 1.5, "sqlite"));
	assert.deepEqual(portableRow(kindsOf({ d: ["decimal", "decimal"] }), { d: "1.50" }, "postgres"), { d: "1.50" });
});

it("compares JSON by content: parsed or text, any key order, string scalars", () => {
	const nested = { b: { y: [1, { q: 2, p: 1 }], x: null }, a: "é ü 漢" };
	const reordered = '{"a":"é ü 漢","b":{"x":null,"y":[1,{"p":1,"q":2}]}}';
	assert.equal(comparable("json", nested, "postgres"), comparable("json", reordered, "sqlite"));
	assert.equal(comparable("json", nested, "mysql"), comparable("json", JSON.parse(reordered), "postgres"));
	assert.notEqual(comparable("json", nested, "postgres"), comparable("json", reordered.replace("2", "3"), "sqlite"));
	// a JSON string scalar is not the bare text
	assert.equal(comparable("json", "abc", "postgres"), comparable("json", '"abc"', "sqlite"));
	assert.notEqual(comparable("json", "abc", "sqlite"), comparable("json", '"abc"', "sqlite"));
	assert.equal(portableRow(kindsOf({ j: ["json", "json"] }), { j: "abc" }, "mysql").j, '"abc"');
	assert.deepEqual(comparable("json", [], "postgres"), comparable("json", "[]", "sqlite"));
	assert.notEqual(comparable("json", [], "postgres"), comparable("json", "{}", "sqlite"));
	// text that is not JSON compares as text
	assert.equal(comparable("json", "not json", "sqlite"), "text:not json");
});

it("compares dates across engines in a zone with DST", () => {
	assert.equal(new Date(2026, 0, 1).getTimezoneOffset(), 300);
	const cases = [
		// EST, EDT, the last minute before and the first after the fall-back hour, and the repeated hour (first one)
		["2026-01-15 08:00:00", "2026-01-15T13:00:00.000Z"],
		["2026-07-15 08:00:00", "2026-07-15T12:00:00.000Z"],
		["2026-11-01 00:59:59", "2026-11-01T04:59:59.000Z"],
		["2026-11-01 02:00:00", "2026-11-01T07:00:00.000Z"],
		["2026-11-01 01:30:00", "2026-11-01T05:30:00.000Z"],
	];
	const kinds = kindsOf({ at: ["date", "date"] });
	for (const [local, iso] of cases) {
		assert.equal(comparable("date", local, "sqlite"), comparable("date", new Date(iso), "postgres"), local);
		assert.equal(comparable("date", new Date(iso), "mysql"), comparable("date", local, "sqlite"), local);
		assert.equal(targetRow(kinds, { at: local }, "postgres").at, iso, local);
		assert.equal(targetRow(kinds, portableRow(kinds, { at: new Date(iso) }, "postgres"), "sqlite").at, local, iso);
		assert.equal(targetRow(kinds, portableRow(kinds, { at: new Date(iso) }, "mysql"), "mysql").at, local, iso);
	}
	// a second off is a difference
	assert.notEqual(
		comparable("date", "2026-07-15 08:00:01", "sqlite"),
		comparable("date", new Date("2026-07-15T12:00:00.000Z"), "postgres"),
	);
	// a time in the spring-forward gap means the instant after the gap on every engine
	assert.equal(
		comparable("date", "2026-03-08 02:30:00", "sqlite"),
		comparable("date", new Date("2026-03-08T07:30:00.000Z"), "postgres"),
	);
	assert.equal(comparable("date", "not a date", "sqlite"), "text:not a date");
});

it("keeps empty text, whitespace, unicode and binary as they are", () => {
	const kinds = kindsOf({ a: [null, null], b: [null, null], c: [null, null], blob: ["binary", "binary"] });
	const row = { a: "", b: "  two  spaces\t\n", c: "שלום 🙂 é", blob: Buffer.from([0, 255, 10]) };
	for (const engine of ["sqlite", "mysql", "postgres"]) {
		assert.deepEqual(targetRow(kinds, portableRow(kinds, row, "sqlite"), engine), row);
	}
	assert.equal(firstDifference(kinds, row, { ...row, a: null }, "sqlite", "postgres"), "a");
	assert.equal(firstDifference(kinds, { ...row, a: null }, row, "postgres", "sqlite"), "a");
	assert.equal(firstDifference(kinds, row, { ...row, b: "two spaces" }, "sqlite", "postgres"), "b");
	// composed and decomposed forms are different text
	assert.equal(firstDifference(kinds, row, { ...row, c: "שלום 🙂 é" }, "sqlite", "postgres"), "c");
	assert.equal(
		firstDifference(kinds, row, { ...row, blob: Buffer.from([0, 255, 11]) }, "sqlite", "postgres"),
		"blob",
	);
	assert.equal(firstDifference(kinds, row, { a: "", b: row.b, c: row.c }, "sqlite", "postgres"), "blob");
});

it("describes a difference with both values and hides secrets", () => {
	const kinds = kindsOf({ name: [null, null], secret: [null, null], meta: ["json", "json"], v: [null, null] });
	const source = { name: "a", secret: "$2b$13$abc", meta: '{"totp_secret":"ABC"}', v: "v1:aaa:bbb:ccc" };
	assert.equal(
		describeDifference(kinds, "name", source, { name: "" }, "sqlite", "postgres"),
		'name: "a" in use, "" in the target',
	);
	assert.equal(
		describeDifference(kinds, "name", source, { name: null }, "sqlite", "postgres"),
		'name: "a" in use, null in the target',
	);
	assert.equal(
		describeDifference(kinds, "name", source, {}, "sqlite", "postgres"),
		'name: "a" in use, missing in the target',
	);
	const secret = describeDifference(kinds, "secret", source, { secret: "$2b$13$abd" }, "sqlite", "postgres");
	assert.equal(secret, "secret: <hidden> in use, <hidden> in the target");
	const meta = describeDifference(kinds, "meta", source, { meta: { totp_secret: "ABD" } }, "sqlite", "postgres");
	assert.equal(meta, "meta: <hidden> in use, <hidden> in the target");
	const sealed = describeDifference(kinds, "v", source, { v: "v1:aaa:bbb:ccd" }, "sqlite", "postgres");
	assert.equal(sealed, "v: <hidden> in use, <hidden> in the target");
	const long = describeDifference(kinds, "name", { name: "x".repeat(200) }, { name: "y" }, "sqlite", "postgres");
	assert.ok(long.length < 140, long);
});

const env = process.env;
const skip = env.POSTGRES_NPMPRO_HOST ? false : "POSTGRES_NPMPRO_HOST is not set";

const createValues = (knex) =>
	knex.schema.createTable("vals", (t) => {
		t.integer("id").primary();
		t.boolean("enabled");
		t.json("meta");
		t.dateTime("created_on");
		t.bigInteger("bytes");
		t.decimal("price", 12, 4);
		t.string("name");
		t.text("note");
		t.binary("blob");
	});

const sqliteRows = [
	{
		id: 1,
		enabled: 1,
		meta: '{"b":{"y":[1,2],"x":"é"},"a":true}',
		created_on: "2026-11-01 01:30:00",
		bytes: 5_000_000_000,
		price: 1.5,
		name: "",
		note: "  שלום 🙂\n",
		blob: Buffer.from([0, 1, 255]),
	},
	{
		id: 2,
		enabled: 0,
		meta: '"just a string"',
		created_on: "2026-03-08 03:30:00",
		bytes: 0,
		price: 0,
		name: null,
		note: "",
		blob: null,
	},
	{
		id: 3,
		enabled: null,
		meta: null,
		created_on: null,
		bytes: null,
		price: null,
		name: "x",
		note: null,
		blob: null,
	},
];

const copyAll = async (from, fromEngine, to, toEngine) => {
	const kinds = columnKinds(await from("vals").columnInfo(), await to("vals").columnInfo());
	const rows = await from("vals").select("*").orderBy("id");
	for (const row of rows) await to("vals").insert(targetRow(kinds, portableRow(kinds, row, fromEngine), toEngine));
	const copied = await to("vals").select("*").orderBy("id");
	return { kinds, rows, copied };
};

it("SQLite to Postgres and back gives equal rows", { skip, timeout: 60_000 }, async () => {
	const sqlite = () =>
		knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
	const first = sqlite();
	const last = sqlite();
	const pg = knexFactory({
		client: "pg",
		connection: {
			host: env.POSTGRES_NPMPRO_HOST,
			port: Number(env.POSTGRES_NPMPRO_PORT ?? 5432),
			user: env.POSTGRES_NPMPRO_USER,
			password: env.POSTGRES_NPMPRO_PASS,
			database: "npmpro_test_unit",
		},
	});
	try {
		await pg.raw("drop schema public cascade");
		await pg.raw("create schema public");
		for (const knex of [first, pg, last]) await createValues(knex);
		await first("vals").insert(sqliteRows);

		const there = await copyAll(first, "sqlite", pg, "postgres");
		// Postgres returns its own representation: booleans, parsed JSON, Dates, bigint and numeric as text
		assert.equal(there.copied[0].enabled, true);
		assert.deepEqual(there.copied[0].meta, { b: { y: [1, 2], x: "é" }, a: true });
		assert.equal(there.copied[1].meta, "just a string");
		assert.ok(there.copied[0].created_on instanceof Date);
		assert.equal(there.copied[0].bytes, "5000000000");
		assert.equal(there.copied[0].price, "1.5000");
		assert.equal(there.copied[0].name, "");
		assert.equal(there.copied[2].name, "x");
		assert.equal(there.copied[1].name, null);
		for (const [index, row] of there.rows.entries()) {
			assert.equal(
				firstDifference(there.kinds, row, there.copied[index], "sqlite", "postgres"),
				null,
				`row ${row.id}`,
			);
		}

		const back = await copyAll(pg, "postgres", last, "sqlite");
		for (const [index, row] of back.rows.entries()) {
			assert.equal(
				firstDifference(back.kinds, row, back.copied[index], "postgres", "sqlite"),
				null,
				`row ${row.id}`,
			);
		}
		const original = await first("vals").select("*").orderBy("id");
		const kinds = columnKinds(await first("vals").columnInfo(), await last("vals").columnInfo());
		for (const [index, row] of original.entries()) {
			assert.equal(firstDifference(kinds, row, back.copied[index], "sqlite", "sqlite"), null, `row ${row.id}`);
		}
		// the round trip writes the same text again, except JSON (normalized by Postgres) and numbers it parsed
		for (const column of ["id", "enabled", "created_on", "name", "note", "blob"]) {
			assert.deepEqual(
				back.copied.map((row) => row[column]),
				original.map((row) => row[column]),
				column,
			);
		}

		// one changed field is found and named
		await last("vals").where({ id: 1 }).update({ note: "changed" });
		const changed = await last("vals").where({ id: 1 }).first();
		assert.equal(firstDifference(kinds, original[0], changed, "sqlite", "sqlite"), "note");
		assert.equal(
			describeDifference(kinds, "note", original[0], changed, "sqlite", "sqlite"),
			'note: "  שלום 🙂\\n" in use, "changed" in the target',
		);
	} finally {
		await Promise.all([first.destroy(), last.destroy(), pg.destroy()]);
	}
});

it("SQLite to SQLite keeps the stored text verbatim", async () => {
	const open = () =>
		knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
	const from = open();
	const to = open();
	try {
		for (const knex of [from, to]) await createValues(knex);
		const odd = { ...sqliteRows[1], id: 4, meta: '{ "b": 1,  "a": 2 }', created_on: "2026-03-08 02:30:00" };
		await from("vals").insert([...sqliteRows, odd]);
		const { kinds, rows, copied } = await copyAll(from, "sqlite", to, "sqlite");
		assert.deepEqual(copied, rows);
		for (const [index, row] of rows.entries()) {
			assert.equal(firstDifference(kinds, row, copied[index], "sqlite", "sqlite"), null);
		}
	} finally {
		await Promise.all([from.destroy(), to.destroy()]);
	}
});
