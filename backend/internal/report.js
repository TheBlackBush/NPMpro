import internalAccessList from "./access-list.js";
import internalCertificate from "./certificate.js";
import internalDeadHost from "./dead-host.js";
import internalProxyHost from "./proxy-host.js";
import internalRedirectionHost from "./redirection-host.js";
import internalStream from "./stream.js";

const internalReport = {
	/**
	 * @param  {Access}   access
	 * @return {Promise}
	 */
	getHostsReport: async (access) => {
		const userId = access.token.getUserId(1);

		const [proxy, redirection, stream, dead, access_list, certificate, errors, expiry] = await Promise.all([
			internalProxyHost.getCount(userId, access.visibility),
			internalRedirectionHost.getCount(userId, access.visibility),
			internalStream.getCount(userId, access.visibility),
			internalDeadHost.getCount(userId, access.visibility),
			internalAccessList.getCount(userId, access.visibility),
			internalCertificate.getCount(userId, access.visibility),
			Promise.all([
				internalProxyHost.getErrorCount(userId, access.visibility),
				internalRedirectionHost.getErrorCount(userId, access.visibility),
				internalDeadHost.getErrorCount(userId, access.visibility),
				internalStream.getErrorCount(userId, access.visibility),
			]),
			internalCertificate.getExpiryCounts(userId, access.visibility),
		]);

		return {
			proxy,
			redirection,
			stream,
			dead,
			access_list,
			certificate,
			errors: { proxy: errors[0], redirection: errors[1], dead: errors[2], stream: errors[3] },
			certificates_expiring: expiry.expiring,
			certificates_expired: expiry.expired,
		};
	},
};

export default internalReport;
