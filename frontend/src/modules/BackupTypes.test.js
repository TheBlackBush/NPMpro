import assert from "node:assert/strict";
import { it } from "node:test";
import {
	categoriesOf,
	categoryState,
	contentLabels,
	DEFAULT_SELECTED,
	passphraseErrors,
	toggleCategory,
	toggleType,
	withErrorDetails,
} from "./BackupTypes.js";

const hosts = { id: "hosts", types: ["proxy_hosts", "streams", "dead_hosts"] };
const settings = { id: "settings", types: ["settings_runtime", "settings_oidc"] };

it("categoryState is all, some or none", () => {
	assert.equal(categoryState(hosts, []), "none");
	assert.equal(categoryState(hosts, ["settings_oidc"]), "none");
	assert.equal(categoryState(hosts, ["streams"]), "some");
	assert.equal(categoryState(hosts, ["streams", "proxy_hosts", "dead_hosts", "settings_oidc"]), "all");
});

it("toggleCategory selects the rest of a partial category and clears a full one", () => {
	assert.deepEqual(toggleCategory(hosts, []), ["proxy_hosts", "streams", "dead_hosts"]);
	assert.deepEqual(toggleCategory(hosts, ["streams", "settings_oidc"]), [
		"streams",
		"settings_oidc",
		"proxy_hosts",
		"dead_hosts",
	]);
	assert.deepEqual(toggleCategory(hosts, ["proxy_hosts", "streams", "dead_hosts", "settings_oidc"]), [
		"settings_oidc",
	]);
});

it("toggleType adds or removes one type and does not mutate the input", () => {
	const selected = ["streams"];
	assert.deepEqual(toggleType("proxy_hosts", selected), ["streams", "proxy_hosts"]);
	assert.deepEqual(toggleType("streams", selected), []);
	assert.deepEqual(selected, ["streams"]);
});

it("DEFAULT_SELECTED lists every type", () => {
	assert.deepEqual(DEFAULT_SELECTED([hosts, settings]), [
		"proxy_hosts",
		"streams",
		"dead_hosts",
		"settings_runtime",
		"settings_oidc",
	]);
	assert.deepEqual(DEFAULT_SELECTED([]), []);
});

it("categoriesOf keeps only the given types and drops empty categories", () => {
	assert.deepEqual(categoriesOf([hosts, settings], ["streams", "proxy_hosts"]), [
		{ id: "hosts", types: ["proxy_hosts", "streams"] },
	]);
	assert.deepEqual(categoriesOf([hosts, settings], []), []);
	assert.deepEqual(hosts.types, ["proxy_hosts", "streams", "dead_hosts"]);
});

it("passphraseErrors checks length and repeat only with secrets", () => {
	assert.deepEqual(passphraseErrors({ secrets: false, passphrase: "", passphraseRepeat: "x" }), {});
	assert.deepEqual(passphraseErrors({ secrets: true, passphrase: "", passphraseRepeat: "" }), {
		passphrase: "settings.backup.passphrase.too-short",
	});
	assert.deepEqual(passphraseErrors({ secrets: true, passphrase: "short", passphraseRepeat: "short" }), {
		passphrase: "settings.backup.passphrase.too-short",
	});
	assert.deepEqual(
		passphraseErrors({ secrets: true, passphrase: "twelve chars", passphraseRepeat: "twelve chars!" }),
		{ passphraseRepeat: "settings.backup.passphrase.mismatch" },
	);
	assert.deepEqual(
		passphraseErrors({ secrets: true, passphrase: "twelve chars", passphraseRepeat: "twelve chars" }),
		{},
	);
});

it("contentLabels names full categories once and partial ones by type", () => {
	assert.deepEqual(
		contentLabels([hosts, settings], ["streams", "settings_runtime", "settings_oidc", "custom_nginx"]),
		[
			{ kind: "type", id: "streams" },
			{ kind: "category", id: "settings" },
			{ kind: "type", id: "custom_nginx" },
		],
	);
	assert.deepEqual(contentLabels([hosts], []), []);
});

it("withErrorDetails offers the message of detailed backup errors as output", () => {
	const apiError = (error) => Object.assign(new Error("x"), { payload: { error } });
	const nginx = apiError({ message_i18n: "backup.error.nginx-failed", message: "nginx rejected: emerg" });
	assert.equal(withErrorDetails(nginx).payload.error.output, "nginx rejected: emerg");
	assert.equal(nginx.payload.error.output, undefined);
	const busy = apiError({ message_i18n: "backup.error.busy", message: "running" });
	assert.equal(withErrorDetails(busy), busy);
	const withOutput = apiError({ message_i18n: "backup.error.nginx-failed", message: "m", output: "o" });
	assert.equal(withErrorDetails(withOutput), withOutput);
	assert.equal(withErrorDetails(null), null);
});
