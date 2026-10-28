import internalAccessList from "./access-list.js";
import { internalBackupSchedules } from "./backup-service.js";
import internalCertificate from "./certificate.js";
import internalDeadHost from "./dead-host.js";
import internalProxyHost from "./proxy-host.js";
import internalRedirectionHost from "./redirection-host.js";
import internalStream from "./stream.js";

const canView = (access, permission) => {
	try {
		access.can(permission);
		return true;
	} catch {
		return false;
	}
};

const isAdmin = (access) => {
	try {
		access.canAdmin();
		return true;
	} catch {
		return false;
	}
};

const internalReport = {
	/**
	 * @param  {Access}   access
	 * @return {Promise}
	 */
	getHostsReport: async (access) => {
		const userId = access.token.getUserId(1);

		const view = {
			proxy: canView(access, "proxy_hosts:view"),
			redirection: canView(access, "redirection_hosts:view"),
			dead: canView(access, "dead_hosts:view"),
			stream: canView(access, "streams:view"),
			certificate: canView(access, "certificates:view"),
		};
		const zero = Promise.resolve(0);

		const [proxy, redirection, stream, dead, access_list, certificate, errors, expiry] = await Promise.all([
			internalProxyHost.getCount(userId, access.visibility),
			internalRedirectionHost.getCount(userId, access.visibility),
			internalStream.getCount(userId, access.visibility),
			internalDeadHost.getCount(userId, access.visibility),
			internalAccessList.getCount(userId, access.visibility),
			internalCertificate.getCount(userId, access.visibility),
			Promise.all([
				view.proxy ? internalProxyHost.getErrorCount(userId, access.visibility) : zero,
				view.redirection ? internalRedirectionHost.getErrorCount(userId, access.visibility) : zero,
				view.dead ? internalDeadHost.getErrorCount(userId, access.visibility) : zero,
				view.stream ? internalStream.getErrorCount(userId, access.visibility) : zero,
			]),
			view.certificate
				? internalCertificate.getExpiryCounts(userId, access.visibility)
				: { expiring: 0, expired: 0 },
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
			backup_schedules_failed: isAdmin(access) ? await internalBackupSchedules.failedSchedules() : [],
		};
	},
};

export default internalReport;
