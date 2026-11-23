import { readFileSync } from "node:fs";
import { rooted } from "./paths.js";

// The nginx settings of Settings > nginx (runtime group "nginx"): include files nginx.conf reads in the main,
// events, http and stream context, plus resolver.conf (read in http and stream).
// rootfs/usr/local/bin/nginx-core-files.sh writes the same files at the first start (test/nginx-core.test.js keeps
// them equal).
const DIR = rooted("/data/npmpro/nginx");
const NGINX_CORE_FILES = {
	main: `${DIR}/core-main.conf`,
	events: `${DIR}/core-events.conf`,
	http: `${DIR}/core-http.conf`,
	stream: `${DIR}/core-stream.conf`,
	resolver: `${DIR}/resolver.conf`,
};
const HEADER = "# written by NPMpro from Settings > nginx and the NGINX_* environment variables, do not edit";
const CORE_MODULES = {
	module_njs: ["ngx_http_js_module.so", "ngx_stream_js_module.so"],
	module_ldap: ["ngx_http_auth_ldap_module.so"],
	module_ntlm: ["ngx_http_upstream_ntlm_module.so"],
	module_vts: ["ngx_http_vhost_traffic_status_module.so"],
};
const SIGALGS =
	"mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256";
const RSA_PKCS1 = ":rsa_pkcs1_sha512:rsa_pkcs1_sha384:rsa_pkcs1_sha256";

const CPU_LIST = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u;
const CPU_LIST_LINE = /^Cpus_allowed_list:[ \t]*(?<list>\S*)[ \t]*$/mu;
const MAX_CPUS = 1024;
const STATUS_FILE = "/proc/self/status";

const onOff = (value) => (value ? "on" : "off");

/**
 * @param   {Object}  values  the nginx group's values
 * @returns {string}  the resolver directive: the addresses replace local=on (the container's own resolvers)
 */
const resolverLine = (values) => {
	const addresses = values.resolver_addresses ?? [];
	const servers = addresses.length > 0 ? addresses.join(" ") : "local=on";
	const valid = values.resolver_valid ? ` valid=${values.resolver_valid}` : "";
	return `resolver ${servers} hosts=${onOff(values.resolver_hosts)} ipv6=${onOff(values.resolver_ipv6)}${valid};`;
};

const file = (lines) => `${[HEADER, ...lines].join("\n")}\n`;

const curvesOf = (values) => {
	if (values.force_mlkem) return "X25519MLKEM768";
	return values.secp_curves ? "X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1" : "X25519MLKEM768:x25519";
};

const tlsLines = (values) => [
	`ssl_protocols ${values.tls12 && !values.force_mlkem ? "TLSv1.2 TLSv1.3" : "TLSv1.3"};`,
	`ssl_ecdh_curve ${curvesOf(values)};`,
	`ssl_sigalgs ${SIGALGS}${values.rsa_pkcs1 ? RSA_PKCS1 : ""};`,
];

/**
 * @param   {string}  list  a CPU list in Cpus_allowed_list syntax such as 0-3,8-11
 * @returns {Set<number>|null} null for anything else, a reversed range or a CPU of 1024 or more
 */
const parseCpuList = (list) => {
	if (typeof list !== "string" || !CPU_LIST.test(list)) return null;
	const cpus = new Set();
	for (const part of list.split(",")) {
		const [low, high = low] = part.split("-").map(Number);
		if (high < low || high >= MAX_CPUS) return null;
		for (let cpu = low; cpu <= high; cpu += 1) cpus.add(cpu);
	}
	return cpus;
};

/**
 * @param   {Set<number>} cpus
 * @returns {string|null}  nginx's bit mask, CPU 0 the right-most bit; null for an empty set
 */
const cpuAffinityMask = (cpus) => {
	if (!cpus || cpus.size === 0) return null;
	const top = Math.max(...cpus);
	return Array.from({ length: top + 1 }, (_, i) => (cpus.has(top - i) ? "1" : "0")).join("");
};

const readStatus = (statusFile) => {
	try {
		return readFileSync(statusFile, "utf8");
	} catch {
		return null;
	}
};

/**
 * The CPUs this process (and so nginx, in the same container) may run on
 *
 * @param   {Object}   [options]
 * @param   {string}   [options.statusFile]  NPMPRO_PROC_STATUS (tests) or /proc/self/status
 * @param   {Function} [options.readText]    (file) => text or null
 * @returns {string|null}  the Cpus_allowed_list value, null when it cannot be read
 */
const readCpusAllowed = ({ statusFile = process.env.NPMPRO_PROC_STATUS ?? STATUS_FILE, readText = readStatus } = {}) =>
	readText(statusFile)?.match(CPU_LIST_LINE)?.groups.list || null;

/**
 * @param   {string}       setting      off, auto or a CPU list
 * @param   {string|null}  cpusAllowed  readCpusAllowed()
 * @returns {{line: string|null, note: string|null}}  the worker_cpu_affinity line, or the note why there is none
 */
const affinityOf = (setting, cpusAllowed) => {
	if (setting === "off") return { line: null, note: null };
	const allowed = parseCpuList(cpusAllowed);
	if (!allowed || allowed.size === 0) {
		return {
			line: null,
			note: "Pin workers to CPUs: the container's CPU list cannot be read, workers are not pinned",
		};
	}
	const wanted = setting === "auto" ? allowed : parseCpuList(setting);
	const cpus = new Set([...(wanted ?? [])].filter((cpu) => allowed.has(cpu)));
	const mask = cpuAffinityMask(cpus);
	if (mask === null) {
		return {
			line: null,
			note: `Pin workers to CPUs: none of the CPUs ${setting} is allowed in this container (${cpusAllowed}), workers are not pinned`,
		};
	}
	return { line: `worker_cpu_affinity auto ${mask};`, note: null };
};

/**
 * @param   {Object} values  the merged values of the nginx group (mergeRuntimeConfig("nginx", ...).values)
 * @param   {Object} [options]
 * @param   {string|null} [options.cpusAllowed]  the container's CPU list (default: this process's)
 * @returns {{main: string, events: string, http: string, stream: string, affinityNote: string|null}}
 */
const renderNginxCore = (values, { cpusAllowed = readCpusAllowed() } = {}) => {
	const affinity = affinityOf(values.cpu_affinity ?? "off", cpusAllowed);
	const modules = Object.entries(CORE_MODULES)
		.filter(([key]) => values[key])
		.flatMap(([, names]) => names.map((name) => `load_module modules/${name};`));
	const js = values.module_njs ? ["js_engine qjs;"] : [];
	return {
		affinityNote: affinity.note,
		main: file([
			`worker_processes ${values.worker_processes};`,
			...(affinity.line ? [affinity.line] : []),
			...(values.worker_shutdown_timeout === "0"
				? []
				: [`worker_shutdown_timeout ${values.worker_shutdown_timeout};`]),
			...modules,
		]),
		// 512 is nginx's own default and left out, so a custom events.conf may set it
		events: file(values.worker_connections === 512 ? [] : [`worker_connections ${values.worker_connections};`]),
		http: file([`log_not_found ${values.log_not_found ? "on" : "off"};`, ...tlsLines(values), ...js]),
		stream: file([...tlsLines(values), ...js]),
		resolver: file([resolverLine(values)]),
	};
};

export { affinityOf, cpuAffinityMask, NGINX_CORE_FILES, parseCpuList, readCpusAllowed, renderNginxCore, resolverLine };
