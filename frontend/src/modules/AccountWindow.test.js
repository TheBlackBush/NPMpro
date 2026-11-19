import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	ACCOUNT_PARTS,
	frameState,
	mfaStepFocus,
	mfaStepReport,
	otherDirtyPart,
	partOf,
	partsFor,
	reportPart,
	signInActions,
	startsOnHeading,
	USER_PARTS,
	visitPart,
} from "./AccountWindow.js";

const en = JSON.parse(readFileSync(new URL("../../translations/ui/en.json", import.meta.url), "utf8"));

describe("the parts", () => {
	it("are Profile, Password, MFA and API tokens, in the side list order", () => {
		assert.deepEqual(
			ACCOUNT_PARTS.map((part) => part.id),
			["profile", "password", "mfa", "api-tokens"],
		);
	});

	it("each label is an English key", () => {
		for (const part of ACCOUNT_PARTS) assert.equal(typeof en[part.labelId], "string", part.labelId);
	});

	it("an unknown part opens Profile", () => {
		assert.equal(partOf("mfa"), "mfa");
		assert.equal(partOf("api-tokens"), "api-tokens");
		assert.equal(partOf("me"), "profile");
		assert.equal(partOf(undefined), "profile");
	});
});

describe("startsOnHeading", () => {
	it("Profile and Password start on their first field on a desktop", () => {
		assert.equal(startsOnHeading({ part: "profile", isPhone: false }), false);
		assert.equal(startsOnHeading({ part: "password", isPhone: false }), false);
	});

	it("MFA and API tokens start on their heading", () => {
		assert.equal(startsOnHeading({ part: "mfa", isPhone: false }), true);
		assert.equal(startsOnHeading({ part: "api-tokens", isPhone: false }), true);
	});

	it("every part starts on its heading on a phone (no on-screen keyboard over the window)", () => {
		for (const { id } of ACCOUNT_PARTS) assert.equal(startsOnHeading({ part: id, isPhone: true }), true);
	});
});

describe("reportPart and frameState", () => {
	it("a report that changes nothing keeps the same object", () => {
		const states = reportPart({}, "profile", { dirty: true });
		assert.equal(reportPart(states, "profile", { dirty: true }), states);
		assert.equal(reportPart(states, "profile", { dirty: true, locked: false, busy: false }), states);
	});

	it("an idle report of an unknown part changes nothing", () => {
		const states = {};
		assert.equal(reportPart(states, "mfa", {}), states);
	});

	it("a changed report is a new object with plain booleans", () => {
		const states = reportPart({}, "password", { dirty: 1, busy: undefined });
		assert.deepEqual(states, { password: { dirty: true, locked: false, busy: false } });
	});

	it("nothing reported: closable, nothing dirty", () => {
		assert.deepEqual(frameState({}), { dirtyParts: [], locked: false, busy: false, closable: true });
	});

	it("dirty parts in side list order; dirty alone still closes (after the question)", () => {
		let states = reportPart({}, "password", { dirty: true });
		states = reportPart(states, "profile", { dirty: true });
		assert.deepEqual(frameState(states), {
			dirtyParts: ["profile", "password"],
			locked: false,
			busy: false,
			closable: true,
		});
	});

	it("a locked or busy part keeps the window open", () => {
		assert.equal(frameState(reportPart({}, "api-tokens", { locked: true })).closable, false);
		assert.equal(frameState(reportPart({}, "api-tokens", { locked: true })).locked, true);
		assert.equal(frameState(reportPart({}, "profile", { busy: true })).closable, false);
		assert.equal(frameState(reportPart({}, "profile", { busy: true })).busy, true);
	});

	it("a part that reports idle again frees the window", () => {
		const locked = reportPart({}, "mfa", { locked: true });
		assert.equal(frameState(reportPart(locked, "mfa", {})).closable, true);
	});
});

describe("visitPart and otherDirtyPart", () => {
	it("a visited part is added once", () => {
		const visited = ["profile"];
		assert.equal(visitPart(visited, "profile"), visited);
		assert.deepEqual(visitPart(visited, "mfa"), ["profile", "mfa"]);
	});

	it("the footer names the first other part with edits", () => {
		assert.equal(otherDirtyPart(["profile", "password"], "password"), "profile");
		assert.equal(otherDirtyPart(["profile", "password"], "profile"), "password");
		assert.equal(otherDirtyPart(["profile"], "profile"), null);
		assert.equal(otherDirtyPart([], "mfa"), null);
	});
});

describe("the MFA steps", () => {
	it("a started step is an unsaved change; the backup codes lock the window", () => {
		assert.deepEqual(mfaStepReport("status"), { dirty: false, locked: false });
		assert.deepEqual(mfaStepReport("loading"), { dirty: false, locked: false });
		for (const step of ["setup", "disable", "verify"])
			assert.deepEqual(mfaStepReport(step), { dirty: true, locked: false });
		assert.deepEqual(mfaStepReport("backup"), { dirty: false, locked: true });
	});

	it("a new step takes the focus: the code on a desktop, Done for the codes, else the heading", () => {
		for (const step of ["setup", "disable", "verify"]) {
			assert.equal(mfaStepFocus({ step, isPhone: false }), "code");
			assert.equal(mfaStepFocus({ step, isPhone: true }), "heading");
		}
		assert.equal(mfaStepFocus({ step: "backup", isPhone: false }), "done");
		assert.equal(mfaStepFocus({ step: "backup", isPhone: true }), "done");
		assert.equal(mfaStepFocus({ step: "status", isPhone: false }), "heading");
		assert.equal(mfaStepFocus({ step: "error", isPhone: false }), "heading");
	});
});

describe("another user's window (D36)", () => {
	it("has Profile and Sign-in; the own window has the four parts", () => {
		assert.deepEqual(
			partsFor(false).map((part) => part.id),
			["profile", "sign-in"],
		);
		assert.equal(partsFor(false), USER_PARTS);
		assert.equal(partsFor(true), ACCOUNT_PARTS);
	});

	it("each label is an English key", () => {
		for (const part of USER_PARTS) assert.equal(typeof en[part.labelId], "string", part.labelId);
	});

	it("a part of the other window opens Profile", () => {
		assert.equal(partOf("sign-in", USER_PARTS), "sign-in");
		assert.equal(partOf("mfa", USER_PARTS), "profile");
		assert.equal(partOf("sign-in"), "profile");
	});

	it("Profile starts on its first field, Sign-in on its heading (its buttons are destructive)", () => {
		assert.equal(startsOnHeading({ part: "profile", isPhone: false, parts: USER_PARTS }), false);
		assert.equal(startsOnHeading({ part: "sign-in", isPhone: false, parts: USER_PARTS }), true);
		assert.equal(startsOnHeading({ part: "profile", isPhone: true, parts: USER_PARTS }), true);
	});

	it("frameState reads the given parts, in their order", () => {
		let states = reportPart({}, "sign-in", { busy: true });
		states = reportPart(states, "profile", { dirty: true });
		assert.deepEqual(frameState(states, USER_PARTS), {
			dirtyParts: ["profile"],
			locked: false,
			busy: true,
			closable: false,
		});
	});
});

describe("signInActions (the Users row menu's rules)", () => {
	it("nothing for the own account", () => {
		assert.deepEqual(signInActions({ isSelf: true, hasMfa: true, oidcLinked: true }), []);
	});

	it("Set Password and Revoke sessions always; Reset MFA only with MFA; Unlink OIDC only with a link", () => {
		assert.deepEqual(signInActions({ isSelf: false, hasMfa: false, oidcLinked: false }), [
			"set-password",
			"revoke-sessions",
		]);
		assert.deepEqual(signInActions({ isSelf: false, hasMfa: true, oidcLinked: true }), [
			"set-password",
			"reset-mfa",
			"revoke-sessions",
			"unlink-oidc",
		]);
		assert.deepEqual(signInActions({ isSelf: false, hasMfa: false, oidcLinked: true }), [
			"set-password",
			"revoke-sessions",
			"unlink-oidc",
		]);
	});
});
