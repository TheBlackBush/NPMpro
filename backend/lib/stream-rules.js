import errs from "./error.js";

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

export { cleanStreamData };
