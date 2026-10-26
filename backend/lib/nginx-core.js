// The nginx settings of Settings > nginx (runtime group "nginx"): four include files nginx.conf reads in the main,
// events, http and stream context. rootfs/usr/local/bin/nginx-core-files.sh writes the same files at the first start
// (test/nginx-core.test.js keeps them equal).
const DIR = "/data/npmpro/nginx";
const NGINX_CORE_FILES = {
	main: `${DIR}/core-main.conf`,
	events: `${DIR}/core-events.conf`,
	http: `${DIR}/core-http.conf`,
	stream: `${DIR}/core-stream.conf`,
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
 * @param   {Object} values  the merged values of the nginx group (mergeRuntimeConfig("nginx", ...).values)
 * @returns {{main: string, events: string, http: string, stream: string}}
 */
const renderNginxCore = (values) => {
	const modules = Object.entries(CORE_MODULES)
		.filter(([key]) => values[key])
		.flatMap(([, names]) => names.map((name) => `load_module modules/${name};`));
	const js = values.module_njs ? ["js_engine qjs;"] : [];
	return {
		main: file([
			`worker_processes ${values.worker_processes};`,
			...(values.worker_shutdown_timeout === "0"
				? []
				: [`worker_shutdown_timeout ${values.worker_shutdown_timeout};`]),
			...modules,
		]),
		// 512 is nginx's own default and left out, so a custom events.conf may set it
		events: file(values.worker_connections === 512 ? [] : [`worker_connections ${values.worker_connections};`]),
		http: file([`log_not_found ${values.log_not_found ? "on" : "off"};`, ...tlsLines(values), ...js]),
		stream: file([...tlsLines(values), ...js]),
	};
};

export { CORE_MODULES, NGINX_CORE_FILES, renderNginxCore };
