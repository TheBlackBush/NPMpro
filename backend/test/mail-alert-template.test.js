import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { buildData, makeEnvelope } from "../lib/notify/catalogue.js";
import { loadDictionaries, renderMail } from "../mail/render.js";

const GERMAN = JSON.parse(fs.readFileSync(new URL("./fixtures/mail-text-parts.json", import.meta.url), "utf8"))[
	"alert-de"
];
const INSTANCE = "box.example";
const URL_OF = "https://npm.example.com";
const LONG = 500;
const CUT = 300;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const MONTH_OR_DOT_DAY = /Nov|24\./u;
const NAME = "<script>x</script>";

const SOURCES = {
	"certificate.expiring": { id: 4, nice_name: "example.com", state: "soon", days_left: 5 },
	"certificate.renewal_failed": { id: 4, nice_name: "example.com", error: "rate limit" },
	"host.config_error": { type: "proxy_host", id: 2, domain_names: ["app.example.com"], error: "bad directive" },
	"backup.failed": { schedule: { id: 1, name: "nightly" }, error: "disk full" },
	"geoip.failed": { error: "download failed" },
	"crowdsec.unreachable": { error: "connection refused" },
	"ddns.record_failed": { record: { id: 3, name: "home.example.com" }, error: "api down" },
	"ddns.record_stopped": { record: { id: 3, name: "home.example.com" }, error: "api down" },
};
// a piece of each sentence that names the object, in English and German
const EXPECTED = {
	"certificate.expiring": "Certificate example.com expires in 5 days",
	"certificate.renewal_failed": "Renewal of certificate example.com failed",
	"host.config_error": "The nginx configuration of app.example.com has an error",
	"backup.failed": "Backup nightly failed",
	"geoip.failed": "The GeoIP database update failed",
	"crowdsec.unreachable": "CrowdSec cannot be reached",
	"ddns.record_failed": "Dynamic DNS record home.example.com failed to update",
	"ddns.record_stopped": "Dynamic DNS record home.example.com was stopped",
};
const RESOLVED = {
	"certificate.expiring": "Certificate example.com is valid again",
	"certificate.renewal_failed": "Certificate example.com was renewed",
	"host.config_error": "nginx configuration of app.example.com is valid again",
	"backup.failed": "Backup nightly succeeded again",
	"geoip.failed": "The GeoIP database update works again",
	"crowdsec.unreachable": "CrowdSec is reachable again",
	"ddns.record_failed": "Dynamic DNS record home.example.com updates again",
	"ddns.record_stopped": "Dynamic DNS record home.example.com runs again",
};

const event = (type, extra = {}, stamp = "2026-11-26T10:00:00.000Z") => {
	const base = type.replace(".resolved", "");
	const data = { ...buildData(base, SOURCES[base]), ...extra };
	return { ...makeEnvelope(type, data, { now: new Date(stamp), randomId: () => `msg_${type}` }) };
};
const mail = (events, input = {}) =>
	renderMail("alerts", { language: "en", instance: INSTANCE, data: { events, ...input.data }, ...input.render });

describe("alert mail template", () => {
	for (const language of ["en", "de"]) {
		const expected = language === "en" ? EXPECTED : GERMAN.EXPECTED;
		const recovered = language === "en" ? RESOLVED : GERMAN.RESOLVED;
		it(`renders a line for every state event and its recovery in ${language}`, () => {
			for (const base of Object.keys(SOURCES)) {
				const problem = renderMail("alerts", { language, instance: INSTANCE, data: { events: [event(base)] } });
				assert.ok(problem.text.includes(expected[base]), `${base}: ${problem.text}`);
				assert.ok(problem.html.includes(expected[base]), base);
				const resolved = renderMail("alerts", {
					language,
					instance: INSTANCE,
					data: { events: [event(`${base}.resolved`)] },
				});
				assert.ok(resolved.text.includes(recovered[base]), `${base}.resolved: ${resolved.text}`);
			}
		});
	}

	it("has a real sentence in every language for every state event, with no key left over", () => {
		for (const language of Object.keys(loadDictionaries())) {
			for (const base of Object.keys(SOURCES)) {
				for (const type of [base, `${base}.resolved`]) {
					const { text } = renderMail("alerts", {
						language,
						instance: INSTANCE,
						data: { events: [event(type)] },
					});
					assert.ok(!text.includes("alerts."), `${language} ${type}: ${text}`);
				}
			}
		}
	});

	it("uses the event itself as the subject of a single event", () => {
		const single = mail([event("certificate.expiring")]);
		assert.equal(single.subject, `[NPMpro ${INSTANCE}] Certificate example.com expires in 5 days`);
		assert.ok(single.html.includes("<h1"));
	});

	it("says expired, today, one day and unknown days", () => {
		const text = (extra) => mail([event("certificate.expiring", extra)]).subject;
		assert.ok(text({ state: "expired", days_left: -2 }).endsWith("Certificate example.com has expired"));
		assert.ok(text({ days_left: 0 }).endsWith("Certificate example.com expires today"));
		assert.ok(text({ days_left: 1 }).endsWith("Certificate example.com expires in 1 day"));
		assert.ok(text({ days_left: undefined }).endsWith("Certificate example.com is about to expire"));
	});

	it("counts a group of 3 problems and 1 resolved, problems first, each oldest first", () => {
		const events = [
			event("geoip.failed", {}, "2026-11-26T10:00:00.000Z"),
			event("backup.failed.resolved", {}, "2026-11-26T10:00:10.000Z"),
			event("crowdsec.unreachable", {}, "2026-11-26T10:00:20.000Z"),
			event(
				"certificate.expiring",
				{ reminder: true, since: "2026-11-24T08:30:00.000Z" },
				"2026-11-26T10:00:30.000Z",
			),
		];
		const group = mail(events);
		assert.equal(group.subject, `[NPMpro ${INSTANCE}] 3 problems, 1 resolved`);
		const lines = group.text.split("\n").filter((line) => line.startsWith("- "));
		assert.equal(lines.length, 4);
		assert.ok(lines[0].startsWith("- The GeoIP database update failed: download failed"));
		assert.ok(lines[1].startsWith("- CrowdSec cannot be reached"));
		assert.equal(lines[2], "- Certificate example.com expires in 5 days (Still open since 2026-11-24 08:30 UTC)");
		assert.equal(lines[3], "- Backup nightly succeeded again (Resolved on 2026-11-26 10:00 UTC)");
		const html = group.html;
		assert.ok(html.indexOf("GeoIP database update failed") < html.indexOf("Backup nightly succeeded again"));
	});

	it("names only the kinds that are in the group in the subject", () => {
		assert.equal(
			mail([event("geoip.failed"), event("crowdsec.unreachable")]).subject,
			`[NPMpro ${INSTANCE}] 2 problems`,
		);
		assert.equal(
			mail([event("geoip.failed.resolved"), event("crowdsec.unreachable.resolved")]).subject,
			`[NPMpro ${INSTANCE}] 2 resolved`,
		);
	});

	it("says a reminder without a start time as still open", () => {
		const reminder = mail([event("geoip.failed", { reminder: true })]);
		assert.ok(reminder.text.includes("(Still open)"));
	});

	it("writes the time as YYYY-MM-DD HH:MM UTC in every language, without a month name", () => {
		const german = renderMail("alerts", {
			language: "de",
			instance: INSTANCE,
			data: { events: [event("geoip.failed", { reminder: true, since: "2026-11-24T08:30:00.000Z" })] },
		});
		assert.ok(german.text.includes(GERMAN.reminder), german.text);
		assert.ok(german.text.includes(" seit 2026-11-24 08:30 UTC"), german.text);
		assert.ok(!MONTH_OR_DOT_DAY.test(german.text), german.text);
		const japanese = renderMail("alerts", {
			language: "ja",
			instance: INSTANCE,
			data: { events: [event("backup.failed.resolved", {}, "2026-11-26T10:00:30.000Z")] },
		});
		assert.ok(japanese.text.includes("2026-11-26 10:00 UTC に解決"), japanese.text);
	});

	it("cuts the error to 300 characters with an ellipsis and keeps it on one line", () => {
		const error = `${"x".repeat(LONG)}\nsecond line`;
		const { text } = mail([{ ...event("geoip.failed"), data: { error } }]);
		const line = text.split("\n").find((one) => one.startsWith("- "));
		const shown = line.slice(line.indexOf(": ", 10) + ": ".length);
		assert.equal(shown.length, CUT);
		assert.ok(shown.endsWith("…"));
		const short = mail([{ ...event("geoip.failed"), data: { error: "a\n b\t c" } }]);
		assert.ok(short.text.includes("failed: a b c"));
	});

	it("never cuts the error inside an emoji", () => {
		const error = `${"a".repeat(CUT - 2)}\u{1F600}${"b".repeat(5)}`;
		const { text } = mail([{ ...event("geoip.failed"), data: { error } }]);
		assert.ok(!LONE_SURROGATE.test(text));
		assert.ok(text.includes(`${"a".repeat(CUT - 2)}\u{1F600}\u2026`));
	});

	it("does not say today for a days_left that is empty, null or not a number", () => {
		for (const days_left of ["", null, "soon"]) {
			const { subject } = mail([event("certificate.expiring", { days_left })]);
			assert.ok(subject.endsWith("is about to expire"), String(days_left));
		}
		assert.ok(mail([event("certificate.expiring", { days_left: "0" })]).subject.endsWith("expires today"));
	});

	it("shows the button only with a public URL", () => {
		const without = mail([event("geoip.failed")]);
		assert.ok(!without.html.includes("Open NPMpro"));
		assert.ok(!without.text.includes("Open NPMpro"));
		const withUrl = mail([event("geoip.failed")], { data: { url: URL_OF } });
		assert.ok(withUrl.html.includes(`href="${URL_OF}"`));
		assert.ok(withUrl.text.includes(`Open NPMpro: ${URL_OF}`));
		const german = renderMail("alerts", {
			language: "de",
			instance: INSTANCE,
			data: { events: [event("geoip.failed")], url: URL_OF },
		});
		assert.ok(german.text.includes(`NPMpro öffnen: ${URL_OF}`));
	});

	it("gives the footer its reason", () => {
		const admin = mail([event("geoip.failed")], { data: { reason: "admin" } });
		assert.ok(admin.text.includes(`You get this mail because you are an administrator of NPMpro at ${INSTANCE}.`));
		const listed = mail([event("geoip.failed")], { data: { reason: "listed" } });
		assert.ok(listed.text.includes(`because this address is listed for alerts of NPMpro at ${INSTANCE}.`));
		const none = mail([event("geoip.failed")]);
		assert.ok(none.text.includes(`Sent by NPMpro at ${INSTANCE}.`));
	});

	it("escapes names from the data in the HTML and keeps them plain in the text", () => {
		const hostile = mail([
			event("host.config_error", { domain_names: [NAME] }),
			event("backup.failed", { schedule: { name: NAME } }),
		]);
		assert.ok(hostile.text.includes(NAME));
		assert.ok(!hostile.html.includes("<script"));
		assert.ok(hostile.html.includes("&lt;script&gt;x&lt;/script&gt;"));
	});

	it("names a host by its stream port, a few domains or its id, and falls back for missing names", () => {
		const subject = (extra) => mail([event("host.config_error", extra)]).subject;
		assert.ok(subject({ type: "stream", domain_names: undefined, incoming_port: 8443 }).includes("of :8443 has"));
		assert.ok(
			subject({ domain_names: ["a.test", "b.test", "c.test", "d.test"] }).includes("a.test, b.test, c.test…"),
		);
		assert.ok(subject({ domain_names: undefined }).includes("of #2 has"));
		const unnamed = (type, extra) => mail([event(type, extra)]).subject;
		assert.ok(unnamed("backup.failed", { schedule: undefined }).endsWith("A backup failed"));
		assert.ok(unnamed("backup.failed.resolved", { schedule: undefined }).endsWith("Backups succeed again"));
		assert.ok(
			unnamed("ddns.record_failed", { record: undefined }).endsWith("A dynamic DNS record failed to update"),
		);
		assert.ok(
			unnamed("certificate.expiring", { nice_name: "", domain_names: ["z.test"] }).includes("Certificate z.test"),
		);
	});

	it("words a disabled webhook by its reason, and an unknown event by its type", () => {
		const webhook = (reason) => ({
			id: "msg_w",
			type: "webhook.disabled",
			timestamp: "2026-11-26T10:00:00.000Z",
			data: { webhook: { id: 7, name: "hook" }, reason },
		});
		assert.ok(mail([webhook("gone")]).subject.endsWith("Webhook hook was disabled: its target no longer exists"));
		assert.ok(mail([webhook("failing")]).subject.endsWith("Webhook hook was disabled after repeated failures"));
		assert.ok(mail([webhook("other")]).subject.endsWith("Webhook hook was disabled"));
		const nameless = { ...webhook("gone"), data: { webhook: { id: 7 }, reason: "gone" } };
		assert.ok(mail([nameless]).subject.includes("Webhook #7 was"));
		const unknown = { id: "msg_u", type: "future.event", timestamp: "2026-11-26T10:00:00.000Z", data: {} };
		assert.ok(mail([unknown]).subject.endsWith("Event future.event"));
	});

	it("sends the language's counts in the subject", () => {
		const events = [event("geoip.failed"), event("crowdsec.unreachable"), event("ddns.record_stopped")];
		const subject = (language) => renderMail("alerts", { language, instance: INSTANCE, data: { events } }).subject;
		assert.ok(subject("de").endsWith(GERMAN.problems));
		assert.ok(subject("ru").endsWith("3 проблемы"));
		assert.ok(subject("pl").endsWith("3 problemy"));
		assert.ok(subject("ja").endsWith("3 件の問題"));
		assert.ok(subject("zh").endsWith("3 个问题"));
	});

	it("marks a sample with a translated subject prefix and a note, in every language", () => {
		const events = [event("backup.failed")];
		const plain = mail(events);
		const sample = mail(events, { data: { sample: true } });
		assert.ok(!plain.subject.includes("Sample"));
		assert.ok(sample.subject.includes("Sample: Backup nightly failed"), sample.subject);
		assert.ok(sample.text.includes("sample alert mail"));
		for (const language of Object.keys(loadDictionaries())) {
			const one = renderMail("alerts", { language, instance: INSTANCE, data: { events, sample: true } });
			const normal = renderMail("alerts", { language, instance: INSTANCE, data: { events } });
			assert.notEqual(one.subject, normal.subject, language);
			assert.ok(!one.subject.includes("alerts.sample"), language);
			assert.ok(!one.text.includes("alerts.sample"), language);
		}
	});
});
