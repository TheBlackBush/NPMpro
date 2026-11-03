import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { ErrorNotFound, LoadingPage, Unhealthy } from "src/components";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { adminRedirect } from "src/modules/AdminRoutes";
import { AppShell } from "src/shell";

const Setup = lazy(() => import("src/pages/Setup"));
const Login = lazy(() => import("src/pages/Login"));
const Dashboard = lazy(() => import("src/pages/Dashboard"));
const Settings = lazy(() => import("src/pages/Settings"));
const Certificates = lazy(() => import("src/pages/Certificates"));
const DnsCredentials = lazy(() => import("src/pages/Certificates/DnsCredentials"));
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

	if (health.isPending) {
		return <LoadingPage fullScreen />;
	}

	if (health.isError || health.data?.status !== "OK") {
		return <Unhealthy />;
	}

	if (!health.data?.setup) {
		return <Setup />;
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
			<AppShell>
				<Suspense fallback={<LoadingPage noLogo delay={300} />}>
					<Routes>
						<Route path="*" element={<ErrorNotFound />} />
						<Route path="/certificates" element={<Certificates />} />
						<Route path="/certificates/dns-credentials" element={<DnsCredentials />} />
						<Route path="/access" element={<Access />} />
						<Route path="/audit-log" element={<MovedToSettings />} />
						<Route path="/settings" element={<Navigate to="/settings/default-site" replace />} />
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
		</BrowserRouter>
	);
}

export default Router;
