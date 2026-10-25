import {
	IconAlertTriangle,
	IconArrowsCross,
	IconBolt,
	IconBoltOff,
	IconDisc,
	IconHistory,
	IconLock,
	IconShield,
} from "@tabler/icons-react";
import { Link } from "react-router";
import { ErrorAlert, EventFormatter, HasPermission, Loading, PageHeader } from "src/components";
import { useHostReport, useRecentAuditLogs, useUser } from "src/hooks";
import { T } from "src/locale";
import { EXPIRY_WARNING_DAYS } from "src/modules/Expiry";
import {
	ACCESS_LISTS,
	ADMIN,
	CERTIFICATES,
	DEAD_HOSTS,
	hasPermission,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	STREAMS,
	VIEW,
} from "src/modules/Permissions";
import { DashboardTile } from "./DashboardTile";
import { MonitoringRow } from "./MonitoringRow";

// Host types in the order the error tile links to them
const ERROR_SECTIONS = [
	{ section: PROXY_HOSTS, key: "proxy", path: "/nginx/proxy" },
	{ section: REDIRECTION_HOSTS, key: "redirection", path: "/nginx/redirection" },
	{ section: DEAD_HOSTS, key: "dead", path: "/nginx/404" },
	{ section: STREAMS, key: "stream", path: "/nginx/stream" },
];

const Dashboard = () => {
	const { data: hostReport } = useHostReport();
	const { data: user } = useUser("me");
	const isAdmin = Boolean(user?.roles?.includes("admin"));
	const { data: recentLogs, error: recentError, isPending: recentPending } = useRecentAuditLogs(isAdmin);

	const viewable = ERROR_SECTIONS.filter((e) => hasPermission(e.section, VIEW, user?.permissions, user?.roles));
	const errorCounts = hostReport?.errors;
	const errorTotal = errorCounts ? viewable.reduce((sum, e) => sum + (errorCounts[e.key] ?? 0), 0) : null;
	const firstWithErrors = errorCounts ? viewable.find((e) => (errorCounts[e.key] ?? 0) > 0) : null;
	const errorsPath = firstWithErrors ? `${firstWithErrors.path}?status=error` : (viewable[0]?.path ?? "/nginx/proxy");
	const expiring = hostReport?.certificatesExpiring;
	const expired = hostReport?.certificatesExpired;
	return (
		<div>
			<PageHeader title={<T id="dashboard" />} />
			<div className="row row-deck row-cards">
				{/* only while monitoring has anything to show, so the summary is not fetched otherwise */}
				{user?.monitoring ? (
					<HasPermission section={ADMIN} permission={VIEW} hideError>
						<MonitoringRow />
					</HasPermission>
				) : null}
				<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
					<DashboardTile to="/nginx/proxy" icon={IconBolt} color="green">
						<T id="proxy-hosts.count" data={{ count: hostReport?.proxy }} />
					</DashboardTile>
				</HasPermission>
				<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
					<DashboardTile to="/nginx/redirection" icon={IconArrowsCross} color="yellow">
						<T id="redirection-hosts.count" data={{ count: hostReport?.redirection }} />
					</DashboardTile>
				</HasPermission>
				<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
					<DashboardTile to="/nginx/404" icon={IconBoltOff} color="red">
						<T id="dead-hosts.count" data={{ count: hostReport?.dead }} />
					</DashboardTile>
				</HasPermission>
				<HasPermission section={STREAMS} permission={VIEW} hideError>
					<DashboardTile to="/nginx/stream" icon={IconDisc} color="blue">
						<T id="streams.count" data={{ count: hostReport?.stream }} />
					</DashboardTile>
				</HasPermission>
				<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
					<DashboardTile to="/certificates" icon={IconShield} color="teal">
						<T id="certificates.count" data={{ count: hostReport?.certificate }} />
					</DashboardTile>
				</HasPermission>
				<HasPermission section={ACCESS_LISTS} permission={VIEW} hideError>
					<DashboardTile to="/access" icon={IconLock} color="purple">
						<T id="access-lists.count" data={{ count: hostReport?.accessList }} />
					</DashboardTile>
				</HasPermission>
				{viewable.length > 0 ? (
					<DashboardTile to={errorsPath} icon={IconAlertTriangle} color="orange">
						{errorTotal === null ? (
							<span className="text-secondary">-</span>
						) : (
							<span className={errorTotal > 0 ? "badge bg-red-lt text-wrap text-start" : undefined}>
								<T id="dashboard.config-errors" data={{ count: errorTotal }} />
							</span>
						)}
					</DashboardTile>
				) : null}
				<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
					<DashboardTile to="/certificates?expiry=soon" icon={IconShield} color="teal">
						{expiring === undefined || expired === undefined ? (
							<span className="text-secondary">-</span>
						) : (
							<>
								<div className="mb-1">
									<span
										className={expiring > 0 ? "badge bg-orange-lt text-wrap text-start" : undefined}
									>
										<T
											id="dashboard.expiring"
											data={{ count: expiring, days: EXPIRY_WARNING_DAYS }}
										/>
									</span>
								</div>
								<div>
									<span className={expired > 0 ? "badge bg-red-lt text-wrap text-start" : undefined}>
										<T id="dashboard.expired" data={{ count: expired }} />
									</span>
								</div>
							</>
						)}
					</DashboardTile>
				</HasPermission>
				{isAdmin ? (
					<div className="col-12">
						<div className="card">
							<div className="card-header">
								<h3 className="card-title">
									<IconHistory className="icon me-2" aria-hidden="true" />
									<T id="dashboard.recent-changes" />
								</h3>
							</div>
							{recentError ? (
								<div className="card-body">
									<ErrorAlert error={recentError} />
								</div>
							) : recentPending ? (
								<div className="card-body">
									<Loading noLogo />
								</div>
							) : recentLogs?.length ? (
								<div className="list-group list-group-flush">
									{recentLogs.map((row) => (
										<div key={row.id} className="list-group-item">
											<EventFormatter row={row} />
										</div>
									))}
								</div>
							) : (
								<div className="card-body text-secondary">
									<T id="dashboard.recent-changes.empty" />
								</div>
							)}
							<div className="card-footer">
								<Link to="/audit-log" className="link-primary">
									<T id="dashboard.view-all" />
								</Link>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
};

export default Dashboard;
