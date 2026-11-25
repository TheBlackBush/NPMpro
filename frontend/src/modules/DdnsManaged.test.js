import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	hostKindOf,
	hostOfRecord,
	hostOpener,
	hostRecordInvalidations,
	isManagedRecord,
	isOrphanRecord,
	rowActionKeys,
} from "./DdnsManaged.js";

const manual = { id: 1, enabled: true, hostType: null, hostId: null, hostLabel: null, orphan: false };
const managed = { id: 2, enabled: true, hostType: "proxy_host", hostId: 7, hostLabel: "a.example.com", orphan: false };
const orphan = { ...managed, enabled: false, orphan: true };

describe("isManagedRecord and isOrphanRecord", () => {
	it("tell manual, managed and orphan rows apart", () => {
		assert.equal(isManagedRecord(manual), false);
		assert.equal(isManagedRecord(undefined), false);
		assert.equal(isManagedRecord(managed), true);
		assert.equal(isOrphanRecord(managed), false);
		assert.equal(isOrphanRecord(orphan), true);
		assert.equal(isOrphanRecord({ ...manual, orphan: true }), false);
	});
});

describe("hostOfRecord", () => {
	it("maps the three host types", () => {
		assert.deepEqual(hostOfRecord(managed), { type: "proxy", id: 7, label: "a.example.com" });
		assert.equal(hostOfRecord({ ...managed, hostType: "redirection_host" }).type, "redirection");
		assert.equal(hostOfRecord({ ...managed, hostType: "dead_host" }).type, "dead");
	});
	it("gives none without a label (a host the user may not see), for a manual row or an unknown type", () => {
		assert.equal(hostOfRecord({ ...managed, hostLabel: null }), null);
		assert.equal(hostOfRecord({ ...managed, hostLabel: "" }), null);
		assert.equal(hostOfRecord(manual), null);
		assert.equal(hostOfRecord({ ...managed, hostType: "stream" }), null);
		assert.equal(hostOfRecord({ ...managed, hostId: null }), null);
	});
});

describe("rowActionKeys", () => {
	it("keeps the whole menu of a manual row", () => {
		assert.deepEqual(rowActionKeys(manual, { canManage: true }), [
			"edit",
			"update-now",
			"history",
			"toggle",
			"delete",
		]);
		assert.deepEqual(rowActionKeys({ ...manual, enabled: false }, { canManage: true }), [
			"edit",
			"history",
			"toggle",
			"delete",
		]);
		assert.deepEqual(rowActionKeys(manual, { canManage: false }), ["edit", "history"]);
	});
	it("gives a managed row no Disable and no Delete, and Open host only with a label", () => {
		assert.deepEqual(rowActionKeys(managed, { canManage: true }), ["edit", "open-host", "update-now", "history"]);
		assert.deepEqual(rowActionKeys({ ...managed, hostLabel: null }, { canManage: true }), [
			"edit",
			"update-now",
			"history",
		]);
		assert.deepEqual(rowActionKeys(managed, { canManage: false }), ["edit", "open-host", "history"]);
	});
	it("gives an orphan the two ways out, for users who manage", () => {
		assert.deepEqual(rowActionKeys(orphan, { canManage: true }), [
			"edit",
			"open-host",
			"history",
			"remove-at-provider",
			"forget",
		]);
		assert.deepEqual(rowActionKeys(orphan, { canManage: false }), ["edit", "open-host", "history"]);
	});
});

describe("hostRecordInvalidations", () => {
	it("refreshes the host's caches for a managed row, of any host type, also without a label", () => {
		const keys = hostRecordInvalidations({ ...managed, hostLabel: null });
		assert.deepEqual(keys[0], ["proxy-host", 7]);
		assert.ok(keys.some((key) => key[0] === "proxy-hosts"));
		assert.ok(keys.some((key) => key[0] === "dns-plan"));
		assert.ok(keys.some((key) => key[0] === "audit-logs"));
		assert.deepEqual(hostRecordInvalidations({ ...managed, hostType: "dead_host" })[0], ["dead-host", 7]);
		assert.equal(hostKindOf({ ...managed, hostType: "redirection_host" }), "redirection");
	});
	it("gives nothing for a manual row", () => {
		assert.deepEqual(hostRecordInvalidations(manual), []);
		assert.equal(hostKindOf(manual), null);
	});
});

describe("hostOpener", () => {
	it("opens the window of the host's type with its id", () => {
		const calls = [];
		const windows = {
			proxy: (id) => calls.push(["proxy", id]),
			redirection: (id) => calls.push(["redirection", id]),
			dead: (id) => calls.push(["dead", id]),
		};
		hostOpener({ ...managed, hostType: "redirection_host", hostId: 3 }, windows)();
		assert.deepEqual(calls, [["redirection", 3]]);
	});
	it("gives none without a visible host", () => {
		assert.equal(hostOpener({ ...managed, hostLabel: null }, {}), null);
		assert.equal(hostOpener(manual, {}), null);
	});
});
