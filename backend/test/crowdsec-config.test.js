import assert from "node:assert/strict";
import { it } from "node:test";
import { crowdsecEnabledNow, parseConfLines, parseCrowdsecConf } from "../lib/crowdsec/config.js";

it("reads every key of a hand-edited file: BOM, CRLF, export, quotes, inline comments, last one wins", () => {
	const text = [
		"﻿ENABLED=true",
		"# a comment",
		'export API_URL="http://127.0.0.1:8080"',
		"API_KEY=abc # from cscli",
		"SECRET_KEY='x#y'",
		"mode = stream",
		"MODE=live",
		"BROKEN LINE",
		"",
	].join("\r\n");
	assert.deepEqual(parseConfLines(text), {
		ENABLED: "true",
		API_URL: "http://127.0.0.1:8080",
		API_KEY: "abc",
		SECRET_KEY: "x#y",
		MODE: "live",
	});
	assert.deepEqual(parseConfLines(undefined), {});
});

it("keeps the monitoring view of the file", () => {
	assert.deepEqual(parseCrowdsecConf("ENABLED=true\nAPI_URL=http://lapi:8080\nAPI_KEY=k\n"), {
		enabled: true,
		apiUrl: "http://lapi:8080",
		apiKey: "k",
		useTls: false,
		certFile: "",
		keyFile: "",
		sslVerify: true,
	});
});

it("reads CrowdSec on from a valid CROWDSEC_ENABLED first, then from crowdsec.conf", () => {
	const file = (text) => ({ readText: () => text });
	assert.equal(crowdsecEnabledNow({ CROWDSEC_ENABLED: " TRUE " }, file("ENABLED=false")), true);
	assert.equal(crowdsecEnabledNow({ CROWDSEC_ENABLED: "false" }, file("ENABLED=true")), false);
	assert.equal(crowdsecEnabledNow({ CROWDSEC_ENABLED: "yes" }, file("ENABLED=true")), true); // invalid env: the file
	assert.equal(crowdsecEnabledNow({}, file(`export ENABLED="${true}"\r\n`)), true);
	assert.equal(crowdsecEnabledNow({}, file(null)), false);
	assert.equal(crowdsecEnabledNow({}, file("ENABLED=false")), false);
});
