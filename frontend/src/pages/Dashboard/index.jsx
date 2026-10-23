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
import { useNavigate } from "react-router";
import { EventFormatter, HasPermission } from "src/components";
import { useHostReport, useRecentAuditLogs, useUser } from "src/hooks";
import { T } from "src/locale";
import { EXPIRY_WARNING_DAYS } from "src/modules/Expiry";
import {
	ACCESS_LISTS,
	CERTIFICATES,
	DEAD_HOSTS,
	hasPermission,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	STREAMS,
	VIEW,
} from "src/modules/Permissions";

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
	const navigate = useNavigate();
	const isAdmin = Boolean(user?.roles?.includes("admin"));
	const { data: recentLogs, isError: recentError } = useRecentAuditLogs(isAdmin);

	const viewable = ERROR_SECTIONS.filter((e) => hasPermission(e.section, VIEW, user?.permissions, user?.roles));
	const errorCounts = hostReport?.errors;
	const errorTotal = errorCounts ? viewable.reduce((sum, e) => sum + (errorCounts[e.key] ?? 0), 0) : null;
	const firstWithErrors = errorCounts ? viewable.find((e) => (errorCounts[e.key] ?? 0) > 0) : null;
	const errorsPath = firstWithErrors ? `${firstWithErrors.path}?status=error` : (viewable[0]?.path ?? "/nginx/proxy");
	const expiring = hostReport?.certificatesExpiring;
	const expired = hostReport?.certificatesExpired;
	const go = (path) => (e) => {
		e.preventDefault();
		void navigate(path);
	};

	return (
		<div>
			<h2>
				<T id="dashboard" />
			</h2>
			<div className="row row-deck row-cards">
				<div className="col-12 my-4">
					<div className="row row-cards">
						<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/nginx/proxy"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/nginx/proxy");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-green text-white avatar avatar-square">
													<IconBolt />
												</span>
											</div>
											<div className="col">
												<div className="font-weight-medium">
													<T id="proxy-hosts.count" data={{ count: hostReport?.proxy }} />
												</div>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/nginx/redirection"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/nginx/redirection");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-yellow text-white avatar avatar-square">
													<IconArrowsCross />
												</span>
											</div>
											<div className="col">
												<T
													id="redirection-hosts.count"
													data={{ count: hostReport?.redirection }}
												/>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/nginx/404"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/nginx/404");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-red text-white avatar avatar-square">
													<IconBoltOff />
												</span>
											</div>
											<div className="col">
												<T id="dead-hosts.count" data={{ count: hostReport?.dead }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={STREAMS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/nginx/stream"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/nginx/stream");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-blue text-white avatar avatar-square">
													<IconDisc />
												</span>
											</div>
											<div className="col">
												<T id="streams.count" data={{ count: hostReport?.stream }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/certificates"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/certificates");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-teal text-white avatar avatar-square">
													<IconShield />
												</span>
											</div>
											<div className="col">
												<T id="certificates.count" data={{ count: hostReport?.certificate }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={ACCESS_LISTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/access"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										void navigate("/access");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-purple text-white avatar avatar-square">
													<IconLock />
												</span>
											</div>
											<div className="col">
												<T id="access-lists.count" data={{ count: hostReport?.accessList }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
					</div>
				</div>
				<div className="col-12 mb-4">
					<div className="row row-cards">
						{viewable.length > 0 ? (
							<div className="col-sm-6 col-lg-4">
								<a
									href={errorsPath}
									className="card card-sm card-link card-link-pop"
									onClick={go(errorsPath)}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-orange text-white avatar avatar-square">
													<IconAlertTriangle />
												</span>
											</div>
											<div className="col">
												{errorTotal === null ? (
													"-"
												) : (
													<span className={errorTotal > 0 ? "text-danger" : undefined}>
														<T id="dashboard.config-errors" data={{ count: errorTotal }} />
													</span>
												)}
											</div>
										</div>
									</div>
								</a>
							</div>
						) : null}
						<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-4">
								<a
									href="/certificates?expiry=soon"
									className="card card-sm card-link card-link-pop"
									onClick={go("/certificates?expiry=soon")}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-teal text-white avatar avatar-square">
													<IconShield />
												</span>
											</div>
											<div className="col">
												{expiring === undefined || expired === undefined ? (
													"-"
												) : (
													<>
														<div className={expiring > 0 ? "text-warning" : undefined}>
															<T
																id="dashboard.expiring"
																data={{ count: expiring, days: EXPIRY_WARNING_DAYS }}
															/>
														</div>
														<div className={expired > 0 ? "text-danger" : undefined}>
															<T id="dashboard.expired" data={{ count: expired }} />
														</div>
													</>
												)}
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						{isAdmin ? (
							<div className="col-12 col-lg-4">
								<div className="card">
									<div className="card-header">
										<h3 className="card-title">
											<IconHistory size={18} className="me-1" />
											<T id="dashboard.recent-changes" />
										</h3>
									</div>
									<div className="list-group list-group-flush">
										{recentError ? (
											<div className="list-group-item">-</div>
										) : (
											recentLogs?.map((row) => (
												<div key={row.id} className="list-group-item">
													<EventFormatter row={row} />
												</div>
											))
										)}
									</div>
									<div className="card-footer">
										<a href="/audit-log" onClick={go("/audit-log")}>
											<T id="dashboard.view-all" />
										</a>
									</div>
								</div>
							</div>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
};

export default Dashboard;
