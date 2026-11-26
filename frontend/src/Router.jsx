import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { ErrorNotFound, LoadingPage, Unhealthy } from "src/components";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { adminRedirect } from "src/modules/AdminRoutes";
import { publicPageOf } from "src/modules/ResetPassword";
import { AppShell } from "src/shell";

const ApiReference = lazy(() => import("src/pages/ApiReference"));
const Setup = lazy(() => import("src/pages/Setup"));
const Login = lazy(() => import("src/pages/Login"));
const ForgotPassword = lazy(() => import("src/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("src/pages/ResetPassword"));
const Dashboard = lazy(() => import("src/pages/Dashboard"));
const Settings = lazy(() => import("src/pages/Settings"));
const Certificates = lazy(() => import("src/pages/Certificates"));
const DnsCredentials = lazy(() => import("src/pages/Certificates/DnsCredentials"));
const Domains = lazy(() => import("src/pages/Certificates/Domains"));
const DynamicDns = lazy(() => import("src/pages/Certificates/DynamicDns"));
const Access = lazy(() => import("src/pages/Access"));
const Monitoring = lazy(() => import("src/pages/Monitoring"));
const ProxyHosts = lazy(() => import("src/pages/Nginx/ProxyHosts"));
const RedirectionHosts = lazy(() => import("src/pages/Nginx/RedirectionHosts"));
const DeadHosts = lazy(() => import("src/pages/Nginx/DeadHosts"));
const Streams = lazy(() => import("src/pages/Nginx/Streams"));

// Users and Audit Log are Settings sections now; the old addresses (and their query strings) land there
function MovedToSettings() {
	const { pathname, search } = useLocation();
	return <Navigate to={adminRedirect(pathname, search) ?? "/settings"} replace />;
}

function Router() {
	const health = useHealth();
	const { authenticated } = useAuthState();

	// after two failed tries the health check counts as down (Unhealthy below); retries go on in the background
	if (health.isPending && health.failureCount < 2) {
		return <LoadingPage fullScreen />;
	}

	if (health.isError || health.data?.status !== "OK") {
		return <Unhealthy />;
	}

	if (!health.data?.setup) {
		return (
			<Suspense fallback={<LoadingPage fullScreen />}>
				<Setup />
			</Suspense>
		);
	}

	// the pages of the password reset need no session and none of the signed-in views: they render for anyone (a
	// signed-in user keeps the page and its link), and they call no endpoint that needs a session
	const publicPage = publicPageOf(window.location.pathname);
	if (publicPage) {
		const Page = publicPage === "reset" ? ResetPassword : ForgotPassword;
		return (
			<Suspense fallback={<LoadingPage fullScreen />}>
				<Page />
			</Suspense>
		);
	}

	if (!authenticated) {
		return (
			<Suspense fallback={<LoadingPage fullScreen />}>
				<Login />
			</Suspense>
		);
	}

	return (
		<BrowserRouter>
			<Routes>
				<Route
					path="/api-reference"
					element={
						<Suspense fallback={<LoadingPage fullScreen />}>
							<ApiReference />
						</Suspense>
					}
				/>
				<Route
					path="*"
					element={
						<AppShell>
							<Suspense fallback={<LoadingPage noLogo delay={300} />}>
								<Routes>
									<Route path="*" element={<ErrorNotFound />} />
									<Route path="/certificates" element={<Certificates />} />
									<Route path="/certificates/dns-credentials" element={<DnsCredentials />} />
									<Route path="/certificates/domains" element={<Domains />} />
									<Route path="/certificates/dynamic-dns" element={<DynamicDns />} />
									<Route path="/access" element={<Access />} />
									<Route path="/audit-log" element={<MovedToSettings />} />
									<Route
										path="/settings"
										element={<Navigate to="/settings/landing-pages" replace />}
									/>
									<Route
										path="/settings/default-site"
										element={<Navigate to="/settings/landing-pages" replace />}
									/>
									<Route path="/settings/:section" element={<Settings />} />
									<Route path="/users" element={<MovedToSettings />} />
									<Route path="/monitoring" element={<Navigate to="/monitoring/traffic" replace />} />
									<Route path="/monitoring/:tab" element={<Monitoring />} />
									<Route path="/nginx/proxy" element={<ProxyHosts />} />
									<Route path="/nginx/redirection" element={<RedirectionHosts />} />
									<Route path="/nginx/404" element={<DeadHosts />} />
									<Route path="/nginx/stream" element={<Streams />} />
									<Route path="/login" element={<Navigate to="/" replace />} />
									<Route path="/" element={<Dashboard />} />
								</Routes>
							</Suspense>
						</AppShell>
					}
				/>
			</Routes>
		</BrowserRouter>
	);
}

export default Router;
