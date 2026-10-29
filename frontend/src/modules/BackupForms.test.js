import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { scheduleErrors } from "./BackupSchedules.js";
import { passphraseErrors } from "./BackupTypes.js";
import { formResolver, translateErrors } from "./HookForm.js";

const intl = createIntl({ locale: "en", messages: en });

it("backup schedule: the resolver gives the window's translated errors", async () => {
	const validate = (form) => translateErrors(scheduleErrors(form, { editingWithPassphrase: false }), intl);
	const values = {
		name: " ",
		enabled: true,
		frequency: "daily",
		everyHours: "6",
		time: "03:00",
		weekday: "0",
		monthDay: "1",
		types: ["proxy_hosts"],
		protection: "none",
		passphrase: "",
		passphraseRepeat: "",
		keep: "7",
	};
	const { errors } = await formResolver(validate)(values);
	assert.deepEqual(errors, { name: { type: "validate", message: "Enter a name of 1 to 60 characters." } });
});

it("export: the passphrase rules of the secrets fields", async () => {
	const validate = (form) => translateErrors(passphraseErrors(form), intl);
	const { errors } = await formResolver(validate)({ secrets: true, passphrase: "short", passphraseRepeat: "" });
	assert.deepEqual(errors, {
		passphrase: { type: "validate", message: "The passphrase needs at least 12 characters" },
		passphraseRepeat: { type: "validate", message: "The passphrases do not match" },
	});
	assert.deepEqual(
		(await formResolver(validate)({ secrets: false, passphrase: "", passphraseRepeat: "x" })).errors,
		{},
	);
});
