import assert from "node:assert/strict";
import { it } from "node:test";
import { GROUP_MAX_LENGTH, groupNames, groupOption, isNewGroupName } from "./HostGroups.js";

it("lists every group of every host type once, sorted, without empty ones", () => {
	assert.deepEqual(
		groupNames(
			[{ npmproDirectory: "Staging" }, { npmproDirectory: "" }, { npmproDirectory: "Production" }],
			undefined,
			[{ npmproDirectory: "Staging" }, {}, null],
			[{ npmproDirectory: "Lab" }],
		),
		["Lab", "Production", "Staging"],
	);
	assert.deepEqual(groupNames(), []);
	assert.deepEqual(groupNames(undefined, []), []);
});

it("keeps names that differ only in case apart, as the lists group them apart", () => {
	assert.deepEqual(groupNames([{ npmproDirectory: "lab" }, { npmproDirectory: "Lab" }]).length, 2);
});

it("turns a name into the select's option, and no group into none", () => {
	assert.deepEqual(groupOption("Staging"), { label: "Staging", value: "Staging" });
	assert.equal(groupOption(""), null);
	assert.equal(groupOption(undefined), null);
});

it("offers a typed name as a new group unless it is empty, too long or already there in any case", () => {
	const names = ["Production", "Staging"];
	assert.equal(isNewGroupName("Lab", names), true);
	assert.equal(isNewGroupName("  Lab  ", names), true);
	assert.equal(isNewGroupName("", names), false);
	assert.equal(isNewGroupName("   ", names), false);
	assert.equal(isNewGroupName("staging", names), false);
	assert.equal(isNewGroupName(" PRODUCTION ", names), false);
	assert.equal(isNewGroupName("x".repeat(GROUP_MAX_LENGTH), names), true);
	assert.equal(isNewGroupName("x".repeat(GROUP_MAX_LENGTH + 1), names), false);
	assert.equal(GROUP_MAX_LENGTH, 255);
});
