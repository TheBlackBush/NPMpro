import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostOfRecord, isManagedRecord, isOrphanRecord, rowActionKeys } from "./DdnsManaged.js";

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
