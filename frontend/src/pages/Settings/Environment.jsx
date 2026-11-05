import { Info, Lock } from "lucide-react";
import { Link } from "react-router";
import { BreakableHost, ErrorAlert, Loading } from "src/components";
import { Badge } from "src/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "src/components/ui/table";
import { useEnvironment } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { PHONE_HIDDEN_CELL, titleClass } from "src/modules/MobileColumns";
import { hasLockReason, LockedBadge, LockReason } from "./Authentication/LockedBadge";
import { SettingsCard } from "./SettingsCard";
import { SettingsHeading } from "./SettingsHeading";
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

// The stacked phone layout of the lists (TableLayout/TableBody): below md the table, its bodies and its rows are
// blocks and each row is a card whose cells show their header as a small label above the value.
const STACKED_TABLE = "max-md:block max-md:[&>tbody]:block";
const CARD_ROW = "max-md:mb-3 max-md:flex max-md:flex-col max-md:gap-1 max-md:rounded-lg max-md:border max-md:p-3";
const CARD_CELL =
	"whitespace-normal max-md:px-0 max-md:py-1 max-md:data-label:before:block max-md:data-label:before:text-xs max-md:data-label:before:text-muted-foreground max-md:data-label:before:content-[attr(data-label)]";
const HEAD = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * The phone part of a stacked row, inside its title cell: the title with `end` on its right and the grey summary
 * line. The cells it repeats are PHONE_HIDDEN_CELL, so one copy is always display none and nothing is read twice.
 */
function PhoneTitle({ title, end, summary }) {
	return (
		<div className="md:hidden">
			<div className="flex items-start gap-2">
				<div className={titleClass()}>{title}</div>
				{end}
			</div>
			{summary ? <div className="mt-1 break-words text-xs text-muted-foreground">{summary}</div> : null}
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
			<p className="text-muted-foreground">
				<T id="settings.environment.locked.none" />
			</p>
		);
	}
	return (
		<Table className={STACKED_TABLE} role="table">
			<TableHeader className="max-md:hidden" role="rowgroup">
				<TableRow className="hover:bg-transparent" role="row">
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.setting" />
					</TableHead>
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.locked-by" />
					</TableHead>
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.section" />
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody className="max-md:[&_tr:last-child]:border!" role="rowgroup">
				{locked.map(({ group, key, env, reason }) => (
					<TableRow key={`${group}/${key}`} className={CARD_ROW} role="row">
						<TableCell className={CARD_CELL} role="cell">
							<PhoneTitle
								title={<SettingLabel group={group} name={key} />}
								end={<LockedBadge env={env} reason={reason} className="" />}
								summary={hasLockReason(env, reason) ? <LockReason env={env} reason={reason} /> : null}
							/>
							<div className="hidden md:block">
								<SettingLabel group={group} name={key} />
							</div>
						</TableCell>
						<TableCell
							className={cn(CARD_CELL, PHONE_HIDDEN_CELL)}
							data-label={label("settings.environment.locked-by")}
							role="cell"
						>
							{/* the same wording as the badge in the settings section */}
							<LockedBadge env={env} reason={reason} className="" />
							{hasLockReason(env, reason) ? (
								<div className="mt-1 text-xs text-muted-foreground">
									<LockReason env={env} reason={reason} />
								</div>
							) : null}
						</TableCell>
						<TableCell className={CARD_CELL} data-label={label("settings.environment.section")} role="cell">
							<Link
								to={`/settings/${SECTION_OF_GROUP[group]}`}
								className="text-primary underline-offset-4 hover:underline"
							>
								<T id={`settings.environment.group.${group}`} />
							</Link>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function Value({ item }) {
	if (item.secret) {
		return (
			<span className="text-muted-foreground">
				<T id={item.set ? "settings.environment.secret.set" : "settings.environment.secret.unset"} />
			</span>
		);
	}
	if (item.value === "") {
		return (
			<span className="text-muted-foreground">
				<T id="settings.environment.empty" />
			</span>
		);
	}
	return (
		<code className={cn("font-mono text-xs", item.value.length > 24 ? "break-all" : "whitespace-nowrap")}>
			{item.value}
		</code>
	);
}

// "set" or "default"; a startup setting (TZ, GOA) not set by env comes from its settings section
function Status({ item }) {
	if (item.setting && !item.set) {
		return (
			<Badge asChild variant="outline">
				<Link to={`/settings/${item.setting}`}>
					<T id="settings.environment.from-setting" />
				</Link>
			</Badge>
		);
	}
	return (
		<Badge variant={item.set ? "default" : "secondary"}>
			<T id={item.set ? "settings.environment.set" : "settings.environment.default"} />
		</Badge>
	);
}

function GroupRows({ group }) {
	return (
		<TableBody className="max-md:[&_tr:last-child]:border!" role="rowgroup">
			{/* below md a block at full width, like the cards */}
			<TableRow className="border-0 hover:bg-transparent max-md:block" role="row">
				<TableHead
					scope="rowgroup"
					colSpan={4}
					className={cn(
						"bg-muted/50 text-xs font-semibold uppercase tracking-wide text-muted-foreground max-md:block max-md:w-full",
					)}
					role="rowheader"
				>
					<T id={`settings.environment.group.${group.id}`} />
				</TableHead>
			</TableRow>
			{group.items.map((item) => (
				<TableRow key={item.name} className={CARD_ROW} role="row">
					<TableCell className={CARD_CELL} role="cell">
						<PhoneTitle
							title={<code className="font-mono text-xs">{item.name}</code>}
							end={<Status item={item} />}
							summary={<Value item={item} />}
						/>
						<div className="hidden md:block">
							{/* on tablets the name breaks after an underscore, so the table fits next to the settings menu */}
							<code className="font-mono text-xs lg:hidden">
								<BreakableHost value={item.name} separators="_" />
							</code>
							<code className="hidden whitespace-nowrap font-mono text-xs lg:inline">{item.name}</code>
						</div>
					</TableCell>
					<TableCell
						className={cn(CARD_CELL, PHONE_HIDDEN_CELL)}
						data-label={label("settings.environment.value")}
						role="cell"
					>
						<Value item={item} />
					</TableCell>
					<TableCell
						className={cn(CARD_CELL, PHONE_HIDDEN_CELL)}
						data-label={label("settings.environment.status")}
						role="cell"
					>
						<Status item={item} />
					</TableCell>
					<TableCell className={CARD_CELL} data-label={label("settings.environment.description")} role="cell">
						<T id={`environment.${group.id}.${item.name}`} />
					</TableCell>
				</TableRow>
			))}
		</TableBody>
	);
}

function GroupTable({ groups }) {
	return (
		<Table className={STACKED_TABLE} role="table">
			<TableHeader className="max-md:hidden" role="rowgroup">
				<TableRow className="hover:bg-transparent" role="row">
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.variable" />
					</TableHead>
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.value" />
					</TableHead>
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.status" />
					</TableHead>
					<TableHead className={HEAD} role="columnheader">
						<T id="settings.environment.description" />
					</TableHead>
				</TableRow>
			</TableHeader>
			{groups.map((group) => (
				<GroupRows key={group.id} group={group} />
			))}
		</Table>
	);
}

export default function Environment() {
	const { isPending, error, data } = useEnvironment();

	return (
		<div className="space-y-4">
			<SettingsHeading titleId="settings.environment" />
			{error ? <ErrorAlert error={error} /> : null}
			{isPending ? <Loading noLogo /> : null}
			{data ? (
				<>
					<StatusAlert variant="info" icon={Info} id="settings.environment.note" />
					<SettingsCard
						title={
							<span className="inline-flex items-center gap-2">
								<Lock className="size-4" aria-hidden="true" />
								<T id="settings.environment.locked" />
							</span>
						}
					>
						<LockedSettings locked={data.lockedRuntime ?? []} />
					</SettingsCard>
					<SettingsCard>
						<GroupTable groups={data.groups} />
					</SettingsCard>
				</>
			) : null}
		</div>
	);
}
