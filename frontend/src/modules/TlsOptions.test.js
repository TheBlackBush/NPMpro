import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { mtlsBypassPossible, tlsDisabledReasons } from "./TlsOptions.js";

const intl = createIntl({ locale: "en", messages: en });
// the text T shows for a reason (T translates tData's values)
const text = (reason) =>
	reason &&
	intl.formatMessage(
		{ id: reason.id },
		Object.fromEntries(Object.entries(reason.tData ?? {}).map(([key, id]) => [key, intl.formatMessage({ id })])),
	);
const texts = (values, options) =>
	Object.fromEntries(
		Object.entries(tlsDisabledReasons(values, options)).map(([name, reason]) => [name, text(reason)]),
	);

const form = (overrides) => ({
	certificateId: 0,
	npmproMtlsCertificateId: 0,
	npmproMtlsVerifyClientOptional: false,
	sslForced: false,
	hstsEnabled: false,
	npmproAuthRequest: "none",
	locations: [],
	...overrides,
});

// the disabled conditions as SSLOptionsFields and SSLCertificateField had them on develop
function developDisabled(v, { forHttp = true, forProxyHost = false } = {}) {
	const newCertificate = v.certificateId === "new";
	const hasCertificate = newCertificate || v.certificateId > 0;
	const bypassPossible =
		v.npmproMtlsVerifyClientOptional &&
		[
			{ npmproAuthRequest: v.npmproAuthRequest },
			...v.locations.filter((row) => String(row.path ?? "").trim()),
		].some(({ npmproAuthRequest: authRequest = "none" }) => authRequest !== "none");
	const mtlsRequired = v.npmproMtlsCertificateId > 0 && !v.npmproMtlsVerifyClientOptional;
	const disabled = {
		npmproMtlsCertificateId: !(v.certificateId > 0),
		npmproMtlsVerifyClientOptional: !(v.certificateId > 0 && v.npmproMtlsCertificateId > 0),
	};
	if (forProxyHost) disabled.npmproMtlsBypassAuthRequest = !bypassPossible;
	if (forHttp) {
		Object.assign(disabled, {
			sslForced: !hasCertificate || mtlsRequired,
			npmproHttp3Support: !hasCertificate,
			hstsEnabled: !hasCertificate || !v.sslForced,
			hstsSubdomains: !hasCertificate || !v.hstsEnabled,
		});
	}
	if (newCertificate) Object.assign(disabled, { npmproReuseKey: false, npmproDnsChallenge: !forHttp });
	return disabled;
}

it("disables exactly the controls develop disabled, in every window, and gives each a reason", () => {
	let checked = 0;
	for (const certificateId of [0, "new", 7])
		for (const npmproMtlsCertificateId of [0, 3])
			for (const npmproMtlsVerifyClientOptional of [false, true])
				for (const sslForced of [false, true])
					for (const hstsEnabled of [false, true])
						for (const [npmproAuthRequest, locations] of [
							["none", []],
							["authentik", []],
							["none", [{ path: "/a", npmproAuthRequest: "tinyauth" }]],
							["none", [{ path: " ", npmproAuthRequest: "tinyauth" }]],
						])
							for (const options of [
								{ forHttp: true, forProxyHost: true },
								{ forHttp: true },
								{ forHttp: false },
							]) {
								const v = form({
									certificateId,
									npmproMtlsCertificateId,
									npmproMtlsVerifyClientOptional,
									sslForced,
									hstsEnabled,
									npmproAuthRequest,
									locations,
								});
								const reasons = tlsDisabledReasons(v, options);
								for (const [name, disabled] of Object.entries(developDisabled(v, options))) {
									assert.equal(
										Boolean(reasons[name]),
										disabled,
										`${name} ${JSON.stringify({ v, options })}`,
									);
									assert.ok(!disabled || en[reasons[name].id], `${name}: ${reasons[name]?.id}`);
								}
								checked++;
							}
	assert.equal(checked, 3 * 2 * 2 * 2 * 2 * 4 * 3);
});

it("says why: no certificate turns the HTTPS options and mTLS off", () => {
	assert.deepEqual(texts(form({}), { forProxyHost: true }), {
		npmproMtlsCertificateId: "Choose a TLS certificate first.",
		npmproMtlsVerifyClientOptional: "Choose a TLS certificate first.",
		npmproMtlsBypassAuthRequest: 'Turn on "Make mTLS Optional" first.',
		sslForced: "Choose a TLS certificate first.",
		npmproHttp3Support: "Choose a TLS certificate first.",
		hstsEnabled: "Choose a TLS certificate first.",
		hstsSubdomains: "Choose a TLS certificate first.",
	});
});

it("says why: a requested certificate has HTTPS options but no mTLS; a stream's always uses the DNS challenge", () => {
	assert.deepEqual(texts(form({ certificateId: "new" })), {
		npmproMtlsCertificateId: "Needs an existing TLS certificate, not a new request.",
		npmproMtlsVerifyClientOptional: "Needs an existing TLS certificate, not a new request.",
		hstsEnabled: 'Turn on "Force HTTPS" first.',
		hstsSubdomains: 'Turn on "HSTS Enabled (2 Years)" first.',
	});
	assert.deepEqual(texts(form({ certificateId: "new" }), { forHttp: false }), {
		npmproMtlsCertificateId: "Needs an existing TLS certificate, not a new request.",
		npmproMtlsVerifyClientOptional: "Needs an existing TLS certificate, not a new request.",
		npmproDnsChallenge: "New certificates for streams need the DNS challenge",
	});
});

it("says why: HSTS follows Force HTTPS, its subdomains follow HSTS, mTLS needs its CA certificate", () => {
	assert.deepEqual(texts(form({ certificateId: 7 })), {
		npmproMtlsVerifyClientOptional: "Choose an mTLS certificate first.",
		hstsEnabled: 'Turn on "Force HTTPS" first.',
		hstsSubdomains: 'Turn on "HSTS Enabled (2 Years)" first.',
	});
	assert.deepEqual(texts(form({ certificateId: 7, sslForced: true, hstsEnabled: true })), {
		npmproMtlsVerifyClientOptional: "Choose an mTLS certificate first.",
	});
	assert.deepEqual(texts(form({ certificateId: 7 }), { forHttp: false }), {
		npmproMtlsVerifyClientOptional: "Choose an mTLS certificate first.",
	});
});

it("says why: required mTLS holds Force HTTPS on; the bypass needs optional mTLS and an Auth Request", () => {
	const mtls = { certificateId: 7, npmproMtlsCertificateId: 3, sslForced: true, hstsEnabled: true };
	assert.deepEqual(texts(form(mtls), { forProxyHost: true }), {
		npmproMtlsBypassAuthRequest: 'Turn on "Make mTLS Optional" first.',
		sslForced: "Required by mTLS while it is not optional.",
	});
	assert.deepEqual(texts(form({ ...mtls, npmproMtlsVerifyClientOptional: true }), { forProxyHost: true }), {
		npmproMtlsBypassAuthRequest: 'Set "Auth Request" on the host or on one of its custom locations first.',
	});
	assert.deepEqual(
		texts(form({ ...mtls, npmproMtlsVerifyClientOptional: true, npmproAuthRequest: "authelia" }), {
			forProxyHost: true,
		}),
		{},
	);
});

it("mtlsBypassPossible: optional mTLS and an Auth Request on the host or a location with a path", () => {
	assert.equal(mtlsBypassPossible(form({ npmproAuthRequest: "authelia" })), false);
	assert.equal(mtlsBypassPossible(form({ npmproMtlsVerifyClientOptional: true })), false);
	assert.equal(
		mtlsBypassPossible(form({ npmproMtlsVerifyClientOptional: true, npmproAuthRequest: "authelia" })),
		true,
	);
	const location = (path) => ({ path, npmproAuthRequest: "tinyauth" });
	assert.equal(mtlsBypassPossible(form({ npmproMtlsVerifyClientOptional: true, locations: [location("/a")] })), true);
	assert.equal(mtlsBypassPossible(form({ npmproMtlsVerifyClientOptional: true, locations: [location("")] })), false);
	assert.equal(mtlsBypassPossible({ npmproMtlsVerifyClientOptional: true, npmproAuthRequest: "none" }), false);
	assert.equal(mtlsBypassPossible({ npmproMtlsVerifyClientOptional: true, locations: [{ path: "/b" }] }), false);
});
