import {
	ArrowLeftRightIcon,
	CalendarXIcon,
	Disc3Icon,
	HistoryIcon,
	LockIcon,
	ShieldAlertIcon,
	ShieldCheckIcon,
	TriangleAlertIcon,
	UnplugIcon,
	ZapIcon,
} from "lucide-react";
import { Link } from "react-router";
import { ErrorAlert, EventFormatter, HasPermission, Loading, PageHeader, StatusBadge } from "src/components";
import { Button } from "src/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "src/components/ui/card";
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
	const failedSchedules = hostReport?.backupSchedulesFailed ?? [];
	const wrap = "h-auto whitespace-normal text-left";
	return (
		<div>
			<PageHeader title={<T id="dashboard" />} />
			<div className="@container flex flex-col gap-4">
				{/* only while monitoring has anything to show, so the summary is not fetched otherwise */}
				{user?.monitoring ? (
					<HasPermission section={ADMIN} permission={VIEW} hideError>
						<MonitoringRow />
					</HasPermission>
				) : null}
				<div className="grid gap-4 @lg:grid-cols-2 @4xl:grid-cols-4">
					<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
						<DashboardTile to="/nginx/proxy" icon={ZapIcon} section="proxyHosts">
							<T id="proxy-hosts.count" data={{ count: hostReport?.proxy }} />
						</DashboardTile>
					</HasPermission>
					<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
						<DashboardTile to="/nginx/redirection" icon={ArrowLeftRightIcon} section="redirectionHosts">
							<T id="redirection-hosts.count" data={{ count: hostReport?.redirection }} />
						</DashboardTile>
					</HasPermission>
					<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
						<DashboardTile to="/nginx/404" icon={UnplugIcon} section="deadHosts">
							<T id="dead-hosts.count" data={{ count: hostReport?.dead }} />
						</DashboardTile>
					</HasPermission>
					<HasPermission section={STREAMS} permission={VIEW} hideError>
						<DashboardTile to="/nginx/stream" icon={Disc3Icon} section="streams">
							<T id="streams.count" data={{ count: hostReport?.stream }} />
						</DashboardTile>
					</HasPermission>
					<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
						<DashboardTile to="/certificates" icon={ShieldCheckIcon} section="certificates">
							<T id="certificates.count" data={{ count: hostReport?.certificate }} />
						</DashboardTile>
					</HasPermission>
					<HasPermission section={ACCESS_LISTS} permission={VIEW} hideError>
						<DashboardTile to="/access" icon={LockIcon} section="accessLists">
							<T id="access-lists.count" data={{ count: hostReport?.accessList }} />
						</DashboardTile>
					</HasPermission>
					{viewable.length > 0 ? (
						<DashboardTile to={errorsPath} icon={TriangleAlertIcon}>
							{errorTotal === null ? (
								<span className="text-muted-foreground">-</span>
							) : errorTotal > 0 ? (
								<StatusBadge tone="destructive" dot={false} className={wrap}>
									<T id="dashboard.config-errors" data={{ count: errorTotal }} />
								</StatusBadge>
							) : (
								<T id="dashboard.config-errors" data={{ count: errorTotal }} />
							)}
						</DashboardTile>
					) : null}
					<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
						<DashboardTile to="/certificates?expiry=soon" icon={ShieldAlertIcon} section="certificates">
							{expiring === undefined || expired === undefined ? (
								<span className="text-muted-foreground">-</span>
							) : (
								<div className="flex flex-col items-start gap-1">
									{expiring > 0 ? (
										<StatusBadge tone="warning" dot={false} className={wrap}>
											<T
												id="dashboard.expiring"
												data={{ count: expiring, days: EXPIRY_WARNING_DAYS }}
											/>
										</StatusBadge>
									) : (
										<span>
											<T
												id="dashboard.expiring"
												data={{ count: expiring, days: EXPIRY_WARNING_DAYS }}
											/>
										</span>
									)}
									{expired > 0 ? (
										<StatusBadge tone="destructive" dot={false} className={wrap}>
											<T id="dashboard.expired" data={{ count: expired }} />
										</StatusBadge>
									) : (
										<span>
											<T id="dashboard.expired" data={{ count: expired }} />
										</span>
									)}
								</div>
							)}
						</DashboardTile>
					</HasPermission>
					{failedSchedules.length > 0 ? (
						<HasPermission section={ADMIN} permission={VIEW} hideError>
							<DashboardTile to="/settings/backup" icon={CalendarXIcon}>
								<StatusBadge tone="destructive" dot={false} className={wrap}>
									{failedSchedules.length === 1 ? (
										<T id="dashboard.schedule-failed" data={{ name: failedSchedules[0].name }} />
									) : (
										<T id="dashboard.schedules-failed" data={{ count: failedSchedules.length }} />
									)}
								</StatusBadge>
							</DashboardTile>
						</HasPermission>
					) : null}
				</div>
				{isAdmin ? (
					<Card>
						<CardHeader>
							<CardTitle role="heading" aria-level={2} className="flex items-center gap-2">
								<HistoryIcon className="size-4" aria-hidden="true" />
								<T id="dashboard.recent-changes" />
							</CardTitle>
						</CardHeader>
						{recentError ? (
							<CardContent>
								<ErrorAlert error={recentError} />
							</CardContent>
						) : recentPending ? (
							<CardContent>
								<Loading noLogo />
							</CardContent>
						) : recentLogs?.length ? (
							<div className="divide-y border-t">
								{recentLogs.map((row) => (
									<div key={row.id} className="px-(--card-spacing) py-2">
										<EventFormatter row={row} />
									</div>
								))}
							</div>
						) : (
							<CardContent className="text-muted-foreground">
								<T id="dashboard.recent-changes.empty" />
							</CardContent>
						)}
						<CardFooter className="border-t">
							<Button asChild variant="link" className="px-0">
								<Link to="/settings/audit-log">
									<T id="dashboard.view-all" />
								</Link>
							</Button>
						</CardFooter>
					</Card>
				) : null}
			</div>
		</div>
	);
};

export default Dashboard;
