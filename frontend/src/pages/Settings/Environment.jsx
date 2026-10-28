import { IconInfoCircle, IconLock } from "@tabler/icons-react";
import { Link } from "react-router";
import { ErrorAlert, Loading } from "src/components";
import { useEnvironment } from "src/hooks";
import { intl, T } from "src/locale";
import { titleClass } from "src/modules/MobileColumns";
import { hasLockReason, LockedBadge, LockReason } from "./Authentication/LockedBadge";
import { StatusAlert } from "./StatusAlert";

// provider names are product names, shown as they are
const PROVIDERS = {
	anubis: "Anubis",
	tinyauth: "Tinyauth",
	oauth2proxy: "OAuth2 Proxy",
	voidauth: "VoidAuth",
	authelia: "Authelia",
	authentik: "Authentik",
};

// where each settings group lives (the logs group is shown in Logs & monitoring, OIDC in Authentication)
const SECTION_OF_GROUP = {
	oidc: "authentication",
	certificates: "certificates",
	network: "network",
	nginx: "nginx",
	"forward-auth": "forward-auth",
	logs: "monitoring",
	monitoring: "monitoring",
	geoip: "geoip",
	advanced: "advanced",
};

// the label of each setting, the same text as in its settings section
const LABELS = {
	"oidc/issuer_url": "settings.authentication.issuer-url",
	"oidc/client_id": "settings.authentication.client-id",
	"oidc/client_secret": "settings.authentication.client-secret",
	"oidc/redirect_domain": "settings.authentication.redirect-domain",
	"oidc/require_verified_email": "settings.authentication.require-verified-email",
	"oidc/skip_mfa": "settings.authentication.skip-mfa",
	"oidc/disable_password": "settings.authentication.disable-password",
	"monitoring/traffic_enabled": "settings.monitoring.traffic",
	"monitoring/retention_days": "settings.monitoring.retention",
	"monitoring/show_ips": "settings.monitoring.show-ips",
	"monitoring/unique_visitors": "settings.monitoring.unique-visitors",
	"monitoring/visitors_cap": "settings.monitoring.visitors-cap",
	"geoip/account_id": "settings.geoip.account-id",
	"geoip/license_key": "settings.geoip.license-key",
	"geoip/editions": "settings.geoip.editions",
	"certificates/key_type": "settings.certificates.key-type",
	"certificates/key_size": "settings.certificates.key-size",
	"certificates/profile": "settings.certificates.profile",
	"certificates/must_staple": "settings.certificates.must-staple",
	"certificates/server_tls_verify": "settings.certificates.server-tls-verify",
	"certificates/renewal_interval": "settings.certificates.renewal-interval",
	"certificates/ocsp_stapling": "settings.certificates.ocsp-stapling",
	"certificates/custom_ocsp_stapling": "settings.certificates.custom-ocsp-stapling",
	"certificates/default_certificate_id": "settings.certificates.default-certificate",
	"certificates/ech_rotation_interval": "settings.certificates.ech-interval",
	"network/trusted_ips": "settings.network.trusted-ips",
	"network/trust_cloudflare": "settings.network.trust-cloudflare",
	"nginx/worker_processes": "settings.nginx.workers",
	"nginx/worker_connections": "settings.nginx.connections",
	"nginx/worker_shutdown_timeout": "settings.nginx.shutdown-timeout",
	"nginx/log_not_found": "settings.nginx.log-not-found",
	"nginx/tls12": "settings.nginx.tls12",
	"nginx/force_mlkem": "settings.nginx.force-mlkem",
	"nginx/secp_curves": "settings.nginx.secp-curves",
	"nginx/rsa_pkcs1": "settings.nginx.rsa-pkcs1",
	"nginx/module_njs": "settings.nginx.module.njs",
	"nginx/module_ldap": "settings.nginx.module.ldap",
	"nginx/module_ntlm": "settings.nginx.module.ntlm",
	"nginx/module_vts": "settings.nginx.module.vts",
	"forward-auth/anubis_custom_images": "settings.forward-auth.anubis-images",
	"logs/write_log_files": "settings.logs.write",
	"logs/log_rotations": "settings.logs.rotations",
	"logs/goaccess": "settings.logs.goaccess",
	"logs/goaccess_keep_days": "settings.logs.goaccess.keep-days",
	"logs/goaccess_anonymize": "settings.logs.goaccess.anonymize",
	"logs/goaccess_drop_query_strings": "settings.logs.goaccess.drop-query-strings",
	"logs/goaccess_real_os": "settings.logs.goaccess.real-os",
	"logs/goaccess_resolve_hosts": "settings.logs.goaccess.resolve-hosts",
	"advanced/time_zone": "settings.advanced.time-zone",
	"advanced/config_beautifier": "settings.advanced.beautifier",
	"advanced/gravatar": "settings.advanced.gravatar",
};

const UPSTREAM_NAME = /^(?<provider>[a-z0-9]+)_upstream$/u;

const label = (id) => intl.formatMessage({ id });

// cells shown inside the phone title block instead of their own (see components/Table/MobileTitle.jsx)
const PHONE_HIDDEN = "d-none d-md-table-cell";

/**
 * The phone part of a stacked row, inside its title cell: the title with `end` on its right and the grey summary
 * line. The cells it repeats are PHONE_HIDDEN, so one copy is always display none and nothing is read twice.
 */
function PhoneTitle({ title, end, summary }) {
	return (
		<div className="d-md-none">
			<div className="d-flex align-items-start gap-2">
				<div className={titleClass()}>{title}</div>
				{end}
			</div>
			{summary ? <div className="mt-1 small text-secondary text-break">{summary}</div> : null}
		</div>
	);
}

function SettingLabel({ group, name }) {
	const upstream = group === "forward-auth" ? UPSTREAM_NAME.exec(name) : null;
	if (upstream) {
		const provider = PROVIDERS[upstream.groups.provider] ?? upstream.groups.provider;
		return <T id="settings.forward-auth.upstream" data={{ provider }} />;
	}
	const id = LABELS[`${group}/${name}`];
	return id ? <T id={id} /> : name;
}

function LockedSettings({ locked }) {
	if (locked.length === 0) {
		return (
			<p className="text-secondary">
				<T id="settings.environment.locked.none" />
			</p>
		);
	}
	return (
		<div className="table-responsive mb-4">
			<table className="table table-vcenter card-table table-mobile-md">
				<thead>
					<tr>
						<th>
							<T id="settings.environment.setting" />
						</th>
						<th>
							<T id="settings.environment.locked-by" />
						</th>
						<th>
							<T id="settings.environment.section" />
						</th>
					</tr>
				</thead>
				<tbody>
					{locked.map(({ group, key, env, reason }) => (
						<tr key={`${group}/${key}`}>
							<td>
								<PhoneTitle
									title={<SettingLabel group={group} name={key} />}
									end={<LockedBadge env={env} reason={reason} className="" />}
									summary={
										hasLockReason(env, reason) ? <LockReason env={env} reason={reason} /> : null
									}
								/>
								<div className="d-none d-md-block">
									<SettingLabel group={group} name={key} />
								</div>
							</td>
							<td className={PHONE_HIDDEN} data-label={label("settings.environment.locked-by")}>
								{/* the same wording as the badge in the settings section */}
								<LockedBadge env={env} reason={reason} className="" />
								{reason ? (
									<div className="small text-secondary mt-1">
										<LockReason env={env} reason={reason} />
									</div>
								) : null}
							</td>
							<td data-label={label("settings.environment.section")}>
								<Link to={`/settings/${SECTION_OF_GROUP[group]}`}>
									<T id={`settings.environment.group.${group}`} />
								</Link>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Value({ item }) {
	if (item.secret) {
		return (
			<span className="text-secondary">
				<T id={item.set ? "settings.environment.secret.set" : "settings.environment.secret.unset"} />
			</span>
		);
	}
	if (item.value === "") {
		return (
			<span className="text-secondary">
				<T id="settings.environment.empty" />
			</span>
		);
	}
	return <code className={item.value.length > 24 ? "text-break" : "text-nowrap"}>{item.value}</code>;
}

// "set" or "default"; a startup setting (TZ, GOA) not set by env comes from its settings section
function Status({ item }) {
	if (item.setting && !item.set) {
		return (
			<Link to={`/settings/${item.setting}`} className="badge bg-azure-lt">
				<T id="settings.environment.from-setting" />
			</Link>
		);
	}
	return (
		<span className={`badge ${item.set ? "bg-green-lt" : "bg-secondary-lt"}`}>
			<T id={item.set ? "settings.environment.set" : "settings.environment.default"} />
		</span>
	);
}

function GroupRows({ group }) {
	return (
		<tbody>
			<tr className="bg-body-tertiary">
				<th colSpan={4} className="text-body">
					<T id={`settings.environment.group.${group.id}`} />
				</th>
			</tr>
			{group.items.map((item) => (
				<tr key={item.name}>
					<td>
						<PhoneTitle
							title={<code>{item.name}</code>}
							end={<Status item={item} />}
							summary={<Value item={item} />}
						/>
						<div className="d-none d-md-block">
							<code className="text-nowrap">{item.name}</code>
						</div>
					</td>
					<td className={PHONE_HIDDEN} data-label={label("settings.environment.value")}>
						<Value item={item} />
					</td>
					<td className={PHONE_HIDDEN} data-label={label("settings.environment.status")}>
						<Status item={item} />
					</td>
					<td data-label={label("settings.environment.description")}>
						<T id={`environment.${group.id}.${item.name}`} />
					</td>
				</tr>
			))}
		</tbody>
	);
}

function GroupTable({ groups }) {
	return (
		<div className="table-responsive">
			<table className="table table-vcenter card-table table-mobile-md">
				<thead>
					<tr>
						<th>
							<T id="settings.environment.variable" />
						</th>
						<th>
							<T id="settings.environment.value" />
						</th>
						<th>
							<T id="settings.environment.status" />
						</th>
						<th>
							<T id="settings.environment.description" />
						</th>
					</tr>
				</thead>
				{groups.map((group) => (
					<GroupRows key={group.id} group={group} />
				))}
			</table>
		</div>
	);
}

export default function Environment() {
	const { isPending, error, data } = useEnvironment();

	return (
		<div className="card-body">
			<h2 className="mb-3">
				<T id="settings.environment" />
			</h2>
			{error ? <ErrorAlert error={error} /> : null}
			{isPending ? <Loading noLogo /> : null}
			{data ? (
				<>
					<StatusAlert variant="info" icon={IconInfoCircle} id="settings.environment.note" />
					<h3 className="mb-2">
						<IconLock className="icon me-2" aria-hidden="true" />
						<T id="settings.environment.locked" />
					</h3>
					<LockedSettings locked={data.lockedRuntime ?? []} />
					<GroupTable groups={data.groups} />
				</>
			) : null}
		</div>
	);
}
