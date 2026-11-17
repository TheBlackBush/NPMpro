// keys whose values are secrets or credentials: removed from every MCP result, at any depth
const SECRET_KEYS = new Set([
	"password",
	"secret",
	"secret_hash",
	"token",
	"values",
	"certificate_key",
	"private_key",
	"client_secret",
	"api_key",
	"license_key",
	"captcha_secret_key",
	"passphrase",
	"dns_provider_credentials",
	"npmpro_dns_provider_credentials",
]);

/** @returns {*} a copy without secret keys, Dates as ISO text */
const redact = (value) => {
	if (Array.isArray(value)) return value.map(redact);
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Date) return value.toISOString();
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !SECRET_KEYS.has(key))
			.map(([key, item]) => [key, redact(item)]),
	);
};

export { redact, SECRET_KEYS };
