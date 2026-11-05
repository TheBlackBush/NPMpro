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

/**
 * @param {*} value  the incoming port of a stream
 */
const assertIncomingPort = (value) => {
	if (parsePortRange(value) === null) {
		throw new errs.ValidationError(
			"The incoming port must be a port from 1 to 65535 or a range of them (for example 8000-8010), lowest first",
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

export { assertIncomingPort, cleanStreamData, parsePortRange, streamsConflict };
