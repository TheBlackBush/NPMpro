import { ddnsTimeMs, isSet } from "../runtime-rule-table.js";
import { rulesOf } from "../runtime-rules.js";

// The Dynamic DNS runtime settings (the "ddns" group), read from the env the settings are in effect in: the user's
// variables win, else the saved values (runtime-config.js effectiveEnv), else the defaults.

const SERVICE_KEYS = ["ipv4_services", "ipv6_services"];

/**
 * @param   {Object}  env  process.env or effectiveEnv()
 * @returns {{periodMs: number, cooldownMs: number, resolvers: string[], ipv4Services: string[], ipv6Services: string[]}}
 */
const ddnsSettingsOf = (env) => {
	const values = {};
	for (const rule of rulesOf("ddns")) {
		const raw = env[rule.env];
		const parsed = isSet(raw) && raw.trim() !== "" ? rule.parseEnv(raw) : undefined;
		values[rule.key] = parsed ?? (typeof rule.default === "function" ? rule.default() : rule.default);
	}
	return {
		periodMs: ddnsTimeMs(values.period),
		cooldownMs: ddnsTimeMs(values.cooldown),
		resolvers: values.resolver,
		ipv4Services: values.ipv4_services,
		ipv6Services: values.ipv6_services,
	};
};

export { ddnsSettingsOf, SERVICE_KEYS };
