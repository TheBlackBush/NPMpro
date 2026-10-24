import {
	IconAlertTriangle,
	IconArrowsTransferDown,
	IconChartBar,
	IconChartLine,
	IconWorld,
	IconWorldOff,
} from "@tabler/icons-react";
import { Fragment } from "react";
import { useSearchParams } from "react-router";
import { ErrorAlert, Flag, Loading, NoticeAlert } from "src/components";
import { EmptyState, StatCard, TopList, TrafficChart, WorldMap } from "src/components/Monitoring";
import { useDeadHosts, useMonitoringTraffic, useProxyHosts, useRedirectionHosts } from "src/hooks";
import { currentLocale, formatDateTime, intl, T } from "src/locale";
import {
	countryName,
	formatBytes,
	formatCount,
	hostOptions,
	isCountryCode,
	OTHER_HOST,
	rangeOptions,
} from "src/modules/Monitoring";

const DEFAULT_RANGE = "24h";
const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

// secondary below 1 %, orange from 1 %, red from 5 %
const errorRateColor = (rate) => {
	if (rate >= 0.05) return "red";
	if (rate >= 0.01) return "orange";
	return "secondary";
};

const hostLabel = (host) => (host === OTHER_HOST ? intl.formatMessage({ id: "monitoring.host.other" }) : host);

const countryLabel = (code) =>
	isCountryCode(code) ? countryName(code, currentLocale) : intl.formatMessage({ id: "unknown" });

function CountryName({ code }) {
	return (
		<span className="d-inline-flex align-items-center gap-2 text-truncate">
			{isCountryCode(code) ? (
				<Flag countryCode={code.toUpperCase()} className="flex-shrink-0" />
			) : (
				<IconWorld className="icon text-secondary flex-shrink-0" width={20} aria-hidden="true" />
			)}
			<span className="text-truncate">{countryLabel(code)}</span>
		</span>
	);
}

function Toolbar({ range, host, onChange }) {
	const { data: proxy } = useProxyHosts();
	const { data: redirection } = useRedirectionHosts();
	const { data: dead } = useDeadHosts();
	const hosts = hostOptions([proxy, redirection, dead], host);

	return (
		<div className="d-flex flex-wrap align-items-center gap-2 mb-3">
			<fieldset className="btn-group" aria-label={intl.formatMessage({ id: "monitoring.range" })}>
				{rangeOptions.map((option) => (
					<Fragment key={option.value}>
						<input
							type="radio"
							className="btn-check"
							name="monitoring-range"
							id={`monitoring-range-${option.value}`}
							checked={range === option.value}
							onChange={() => onChange("range", option.value)}
						/>
						<label className="btn" htmlFor={`monitoring-range-${option.value}`}>
							<T id={option.labelKey} />
						</label>
					</Fragment>
				))}
			</fieldset>
			<select
				className="form-select w-auto mw-100"
				aria-label={intl.formatMessage({ id: "monitoring.host" })}
				value={host}
				onChange={(e) => onChange("host", e.target.value)}
			>
				<option value="">{intl.formatMessage({ id: "monitoring.host.all" })}</option>
				{hosts.map((name) => (
					<option key={name} value={name}>
						{hostLabel(name)}
					</option>
				))}
			</select>
		</div>
	);
}

function StatusLine({ status }) {
	return (
		<div className="text-secondary small mt-3">
			{status.lastRead ? (
				<T id="monitoring.traffic.last-read" data={{ time: formatDateTime(status.lastRead) }} />
			) : (
				<T id="monitoring.traffic.never-read" />
			)}
			{status.skippedLines > 0 ? (
				<>
					<span className="mx-1">·</span>
					<T id="monitoring.traffic.skipped-lines" data={{ count: status.skippedLines }} />
				</>
			) : null}
			{status.droppedRequests > 0 ? (
				<>
					<span className="mx-1">·</span>
					<T id="monitoring.traffic.dropped-requests" data={{ count: status.droppedRequests }} />
				</>
			) : null}
		</div>
	);
}

function TrafficData({ data, range }) {
	const { status, totals } = data;
	const geoip = status.geoip;
	const topCountry = data.topCountries.find((c) => isCountryCode(c.country));
	const empty = <T id="monitoring.no-data" />;

	return (
		<>
			{status.error ? (
				<NoticeAlert>
					<T id="monitoring.traffic.read-error" data={{ error: status.error }} />
				</NoticeAlert>
			) : null}
			<div className="row row-deck row-cards">
				<StatCard
					label={<T id="monitoring.stat.requests" />}
					value={formatCount(totals.requests)}
					hint={intl.formatNumber(totals.requests)}
					icon={IconChartBar}
					color="primary"
				/>
				<StatCard
					label={<T id="monitoring.stat.data-sent" />}
					value={formatBytes(totals.bytes)}
					icon={IconArrowsTransferDown}
					color="azure"
				/>
				<StatCard
					label={<T id="monitoring.stat.error-rate" />}
					value={percentFormat.format(totals.errorRate)}
					hint={<T id="monitoring.stat.error-rate.hint" />}
					icon={IconAlertTriangle}
					color={errorRateColor(totals.errorRate)}
				/>
				<StatCard
					label={<T id="monitoring.stat.top-country" />}
					value={topCountry ? <CountryName code={topCountry.country} /> : "-"}
					hint={
						topCountry ? (
							<T id="monitoring.requests" data={{ count: topCountry.requests }} />
						) : (
							<T id={geoip ? "monitoring.no-data" : "monitoring.geoip.missing"} />
						)
					}
					icon={IconWorld}
					color="green"
				/>
				<div className="col-12">
					<div className="card">
						<div className="card-header">
							<h3 className="card-title">
								<T id="monitoring.traffic.requests-over-time" />
							</h3>
						</div>
						<div className="card-body">
							<TrafficChart series={data.series} range={range} />
						</div>
					</div>
				</div>
				{geoip ? (
					<>
						<div className="col-lg-8">
							<div className="card">
								<div className="card-header">
									<h3 className="card-title">
										<T id="monitoring.traffic.map" />
									</h3>
								</div>
								<div className="card-body">
									<WorldMap
										countries={data.countries}
										label={intl.formatMessage({ id: "monitoring.traffic.map" })}
									/>
								</div>
							</div>
						</div>
						<TopList
							className="col-lg-4"
							title={<T id="monitoring.top.countries" />}
							total={totals.requests}
							empty={empty}
							items={data.topCountries.map((c) => ({
								key: c.country,
								label: <CountryName code={c.country} />,
								title: countryLabel(c.country),
								value: c.requests,
							}))}
						/>
					</>
				) : (
					<div className="col-12">
						<div className="card">
							<div className="card-body">
								<EmptyState
									icon={IconWorldOff}
									title={<T id="monitoring.geoip.missing" />}
									subtitle={<T id="monitoring.geoip.missing.subtitle" />}
									to="/settings/geoip"
									action={<T id="monitoring.geoip.setup" />}
								/>
							</div>
						</div>
					</div>
				)}
				<TopList
					title={<T id="monitoring.top.hosts" />}
					total={totals.requests}
					empty={empty}
					items={data.topHosts.map((h) => ({
						key: h.host,
						label: hostLabel(h.host),
						title: hostLabel(h.host),
						value: h.requests,
					}))}
				/>
				{geoip ? (
					<TopList
						title={<T id="monitoring.top.networks" />}
						total={totals.requests}
						empty={empty}
						items={data.topAsns.map((a) => {
							const name =
								a.asn === 0
									? intl.formatMessage({ id: "monitoring.network.other" })
									: `AS${a.asn} ${a.asnName}`.trim();
							return { key: String(a.asn), label: name, title: name, value: a.requests };
						})}
					/>
				) : null}
				{data.topIps ? (
					<TopList
						title={<T id="monitoring.top.ips" />}
						total={totals.requests}
						empty={empty}
						items={data.topIps.map((i) => {
							const name = i.ip === "other" ? intl.formatMessage({ id: "monitoring.ip.other" }) : i.ip;
							return {
								key: i.ip,
								label: <span className="font-monospace">{name}</span>,
								title: name,
								value: i.requests,
							};
						})}
					/>
				) : null}
			</div>
			<StatusLine status={status} />
		</>
	);
}

const Traffic = () => {
	const [params, setParams] = useSearchParams();
	const range = rangeOptions.some((o) => o.value === params.get("range")) ? params.get("range") : DEFAULT_RANGE;
	const host = params.get("host") ?? "";
	const { data, error, isPending, isPlaceholderData } = useMonitoringTraffic(range, host);

	const onChange = (key, value) =>
		setParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				if (value === "" || (key === "range" && value === DEFAULT_RANGE)) next.delete(key);
				else next.set(key, value);
				return next;
			},
			{ replace: true },
		);

	let content;
	if (isPending) {
		content = <Loading noLogo delay={300} />;
	} else if (error && !data) {
		content = <ErrorAlert error={error} />;
	} else if (data.status.enabled) {
		// the previous range or host stays visible, dimmed, until the new data is there
		content = (
			<div className={isPlaceholderData ? "opacity-50" : undefined} aria-busy={isPlaceholderData}>
				<TrafficData data={data} range={range} />
			</div>
		);
	} else {
		content = (
			<div className="card">
				<div className="card-body">
					<EmptyState
						icon={IconChartLine}
						title={<T id="monitoring.traffic.off" />}
						subtitle={<T id="monitoring.traffic.off.subtitle" />}
						to="/settings/monitoring"
						action={<T id="monitoring.traffic.enable" />}
					/>
				</div>
			</div>
		);
	}

	return (
		<>
			{data?.status.enabled === false ? null : <Toolbar range={range} host={host} onChange={onChange} />}
			{content}
		</>
	);
};

export default Traffic;
