import errs from "./error.js";

const PORT_PATTERN = /^(\d{1,5})(?:-(\d{1,5}))?$/u;

/**
 * Reads an incoming port: a single port or a range `start-end`, each part from 1 to 65535, start not above end.
 *
 * @param   {*}  value
 * @returns {{start: Number, end: Number}|null}  null when the value is no valid port or range
 */
const parsePortRange = (value) => {
	const match = PORT_PATTERN.exec(String(value ?? ""));
	if (!match) return null;
	const start = Number(match[1]);
	const end = match[2] === undefined ? start : Number(match[2]);
	if (start < 1 || end > 65535 || start > end) return null;
	return { start, end };
};

// a range opens one socket per port, address family and worker (reuseport): 1000 covers game servers and FTP
// passive ranges with room to spare, a bigger span can be split into several streams
const STREAM_RANGE_MAX = 1000;

/**
 * @param   {{start: Number, end: Number}}  range
 * @returns {Number}  the number of ports in it
 */
const rangeSize = ({ start, end }) => end - start + 1;

/**
 * @param {*} value  the incoming port of a stream
 */
const assertIncomingPort = (value) => {
	const range = parsePortRange(value);
	if (range === null) {
		throw new errs.ValidationError(
			"The incoming port must be a port from 1 to 65535 or a range of them (for example 8000-8010), lowest first",
		);
	}
	if (rangeSize(range) > STREAM_RANGE_MAX) {
		throw new errs.ValidationError(
			`A port range can span at most ${STREAM_RANGE_MAX} ports, ${value} spans ${rangeSize(range)}. Split a bigger range into several streams.`,
			"error.stream-port-range-too-wide",
		);
	}
};

/**
 * The ports nginx itself listens on (envs.sh defaults 80, 443, 81), with the protocol each really uses: HTTP_PORT over
 * TCP unless DISABLE_HTTP, HTTPS_PORT over TCP and, unless DISABLE_H3_QUIC, over UDP (HTTP/3), NPM_PORT over TCP
 *
 * @param   {Object}  env  effectiveEnv()
 * @returns {{port: Number, protocol: "tcp"|"udp", setting: String}[]}
 */
const reservedPorts = (env) => {
	const https = Number(env.HTTPS_PORT || 443);
	return [
		...(env.DISABLE_HTTP === "true"
			? []
			: [{ port: Number(env.HTTP_PORT || 80), protocol: "tcp", setting: "HTTP_PORT" }]),
		{ port: https, protocol: "tcp", setting: "HTTPS_PORT" },
		...(env.DISABLE_H3_QUIC === "true" ? [] : [{ port: https, protocol: "udp", setting: "HTTPS_PORT" }]),
		{ port: Number(env.NPM_PORT || 81), protocol: "tcp", setting: "NPM_PORT" },
	];
};

/**
 * The first reserved port the stream's port or range covers on a protocol it forwards, or null
 *
 * @param   {Object}  stream  incoming_port, tcp_forwarding, udp_forwarding
 * @param   {Object}  env
 * @returns {{port: Number, protocol: String, setting: String}|null}
 */
const reservedPortClash = (stream, env) => {
	const range = parsePortRange(stream.incoming_port);
	if (!range) return null;
	const uses = { tcp: Boolean(stream.tcp_forwarding), udp: Boolean(stream.udp_forwarding) };
	return (
		reservedPorts(env).find(({ port, protocol }) => uses[protocol] && range.start <= port && port <= range.end) ??
		null
	);
};

/**
 * @param {*} value  the forwarding port of a stream: empty (the incoming port is used), `$server_port` or 1 to 65535
 */
const assertForwardingPort = (value) => {
	if (value === "" || value === "$server_port") return;
	const port = /^\d{1,5}$/u.test(String(value)) ? Number(value) : 0;
	if (port < 1 || port > 65535) {
		throw new errs.ValidationError(
			"The forwarding port must be a port from 1 to 65535, $server_port or empty (the incoming port is used)",
		);
	}
};

/**
 * True when both streams would listen on the same port for one protocol: they share TCP or UDP and their incoming
 * ports (or ranges) overlap. TCP on a port and UDP on the same port do not conflict.
 *
 * @param   {Object}  a  stream data: incoming_port, tcp_forwarding, udp_forwarding
 * @param   {Object}  b
 * @returns {Boolean}
 */
const streamsConflict = (a, b) => {
	const shared = (a.tcp_forwarding && b.tcp_forwarding) || (a.udp_forwarding && b.udp_forwarding);
	const rangeA = parsePortRange(a.incoming_port);
	const rangeB = parsePortRange(b.incoming_port);
	if (!(shared && rangeA && rangeB)) return false;
	return rangeA.start <= rangeB.end && rangeB.start <= rangeA.end;
};

/**
 * The stored values of a stream create or update, merged with the saved row. UDP has no TLS and no certificate, and
 * nginx sends only PROXY protocol v2 over UDP, so v1 becomes v2 there. A new certificate for a stream can only be
 * requested with the DNS challenge (nothing answers the HTTP challenge on a stream port).
 *
 * @param   {Object}  data          the request
 * @param   {Object}  [existingData]  the saved row (update)
 * @returns {Object}
 */
const cleanStreamData = (data, existingData) => {
	const combinedData = { ...existingData, ...data };

	// a save that keeps the stored port is not blocked, so an older row can still be repaired another way
	if (data.incoming_port !== undefined && data.incoming_port !== existingData?.incoming_port) {
		assertIncomingPort(data.incoming_port);
	}

	if (data.forwarding_port !== undefined && data.forwarding_port !== existingData?.forwarding_port) {
		assertForwardingPort(data.forwarding_port);
	}

	if (!combinedData.tcp_forwarding && !combinedData.udp_forwarding) {
		throw new errs.ValidationError("TCP or UDP forwarding needs to be enabled");
	}

	if (combinedData.udp_forwarding) {
		combinedData.npmpro_proxy_tls = false;
		if (combinedData.npmpro_proxy_protocol_forwarding === 1) combinedData.npmpro_proxy_protocol_forwarding = 2;
		combinedData.certificate_id = 0;
	}

	if (combinedData.certificate_id === "new" && !combinedData.npmpro_dns_challenge) {
		throw new errs.ValidationError(
			"New certificates for streams need the DNS challenge",
			"error.stream.new-certificate-dns",
		);
	}

	if (combinedData.certificate_id !== "new" && !(combinedData.certificate_id > 0)) {
		combinedData.npmpro_mtls_certificate_id = 0;
	}

	if (!(combinedData.npmpro_mtls_certificate_id > 0)) {
		combinedData.npmpro_mtls_verify_client_optional = false;
	}

	return combinedData;
};

export { cleanStreamData, rangeSize, reservedPortClash, reservedPorts, STREAM_RANGE_MAX, streamsConflict };
