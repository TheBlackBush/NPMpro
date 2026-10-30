import assert from "node:assert/strict";
import { it } from "node:test";
import { hiddenRuledOut, PERMISSION_SECTIONS, permissionChanges } from "./Permissions.js";

const ALL_HIDDEN = Object.fromEntries(PERMISSION_SECTIONS.map((section) => [section, "hidden"]));

it("turns on what a permission needs, as the permission buttons did", () => {
	assert.deepEqual(permissionChanges(ALL_HIDDEN, "proxyHosts", "view"), {
		accessLists: "view",
		certificates: "view",
	});
	assert.deepEqual(permissionChanges(ALL_HIDDEN, "streams", "manage"), { certificates: "view" });
	assert.deepEqual(permissionChanges(ALL_HIDDEN, "accessLists", "manage"), {});
	assert.deepEqual(permissionChanges(ALL_HIDDEN, "proxyHosts", "hidden"), {});
	const shown = { ...ALL_HIDDEN, accessLists: "manage", certificates: "manage" };
	assert.deepEqual(permissionChanges(shown, "proxyHosts", "manage"), {});
});

it("rules out hidden for the access lists and certificates while a section needs them", () => {
	assert.equal(hiddenRuledOut(ALL_HIDDEN, "accessLists"), false);
	assert.equal(hiddenRuledOut({ ...ALL_HIDDEN, proxyHosts: "view" }, "accessLists"), true);
	assert.equal(hiddenRuledOut(ALL_HIDDEN, "certificates"), false);
	for (const section of ["proxyHosts", "redirectionHosts", "deadHosts", "streams"]) {
		assert.equal(hiddenRuledOut({ ...ALL_HIDDEN, [section]: "manage" }, "certificates"), true, section);
	}
	assert.equal(hiddenRuledOut({ ...ALL_HIDDEN, accessLists: "manage" }, "certificates"), false);
	assert.equal(hiddenRuledOut({ ...ALL_HIDDEN, proxyHosts: "manage" }, "streams"), false);
});
