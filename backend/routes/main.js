import express from "express";
import internalDeadHost from "../internal/dead-host.js";
import internalProxyHost from "../internal/proxy-host.js";
import internalRedirectionHost from "../internal/redirection-host.js";
import internalStream from "../internal/stream.js";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import hostRouter from "../lib/express/host-router.js";
import requireLogin from "../lib/express/require-login.js";
import { getOidcConfig } from "../lib/oidc-config.js";
import { OIDC_DEFAULTS } from "../lib/oidc-rules.js";
import { isSetup } from "../setup.js";
import auditLogRoutes from "./audit-log.js";
import backupSchedulesRoutes from "./backup-schedules.js";
import backupsRoutes from "./backups.js";
import databaseRoutes from "./database.js";
import docsRoutes from "./docs.js";
import monitoringRoutes from "./monitoring.js";
import accessListsRoutes from "./nginx/access_lists.js";
import certificatesHostsRoutes from "./nginx/certificates.js";
import dnsCredentialsRoutes from "./nginx/dns_credentials.js";
import oidcRoutes from "./oidc.js";
import reportsRoutes from "./reports.js";
import schemaRoutes from "./schema.js";
import settingsRoutes from "./settings.js";
import tokensRoutes from "./tokens.js";
import usersRoutes from "./users.js";
import versionRoutes from "./version.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * Public description of the OIDC login button
 */
const oidcHealth = ({ active, values }) => {
	const { label, color, icon } = values.button;
	return {
		active,
		label,
		color,
		icon:
			icon?.type === "file"
				? { type: "file", url: `/api/oidc/icon?v=${encodeURIComponent(icon.updated_on ?? 0)}` }
				: { type: "builtin", name: icon?.name ?? OIDC_DEFAULTS.button.icon.name },
	};
};

/**
 * Health Check
 * GET /api
 */
router.get(["/api", "/api/"], async (_, res /*, next*/) => {
	const cfg = await getOidcConfig();
	res.status(200).send({
		status: "OK",
		setup: await isSetup(),
		password: !(cfg.active && cfg.values.disable_password),
		oidc: oidcHealth(cfg),
		// every page polls this: the banner, and the move window's sign that the new process answers
		...(maintenance.active() ? { maintenance: "database-move" } : {}),
	});
});

/**
 * Auth Check, used by the nginx auth_request directive
 * GET /api/auth
 */
router.get("/api/auth", requireLogin(), (_, res) => {
	res.sendStatus(200);
});

/**
 * Admin Auth Check, used by the nginx auth_request directive
 * GET /api/auth/admin
 */
router.get("/api/auth/admin", requireLogin(), (_, res) => {
	res.locals.access.canAdmin();
	res.sendStatus(200);
});

router.use("/api/docs", docsRoutes);
router.use("/api/schema", schemaRoutes);
router.use("/api/tokens", tokensRoutes);
router.use("/api/oidc", oidcRoutes);
router.use("/api/users", usersRoutes);
router.use("/api/audit-log", auditLogRoutes);
// before /api/backups, whose /:name would take /schedules
router.use("/api/backups/schedules", backupSchedulesRoutes);
router.use("/api/backups", backupsRoutes);
router.use("/api/database", databaseRoutes);
router.use("/api/reports", reportsRoutes);
router.use("/api/monitoring", monitoringRoutes);
router.use("/api/settings", settingsRoutes);
router.use("/api/version", versionRoutes);
const PLAIN_EXPAND = ["owner", "certificate"];
router.use(
	"/api/nginx/proxy-hosts",
	hostRouter({
		internal: internalProxyHost,
		path: "/nginx/proxy-hosts",
		expandEnum: ["owner", "access_lists", "certificate"],
		idParam: "host_id",
	}),
);
router.use(
	"/api/nginx/redirection-hosts",
	hostRouter({
		internal: internalRedirectionHost,
		path: "/nginx/redirection-hosts",
		expandEnum: PLAIN_EXPAND,
		idParam: "host_id",
	}),
);
router.use(
	"/api/nginx/dead-hosts",
	hostRouter({
		internal: internalDeadHost,
		path: "/nginx/dead-hosts",
		expandEnum: PLAIN_EXPAND,
		idParam: "host_id",
	}),
);
router.use(
	"/api/nginx/streams",
	hostRouter({
		internal: internalStream,
		path: "/nginx/streams",
		expandEnum: PLAIN_EXPAND,
		idParam: "stream_id",
	}),
);
router.use("/api/nginx/access-lists", accessListsRoutes);
router.use("/api/nginx/certificates", certificatesHostsRoutes);
router.use("/api/nginx/dns-credentials", dnsCredentialsRoutes);

/** ALL /api/*: 404 for every other route */
router.all(/(?<path>.+)/u, (req, _, next) => {
	next(new errs.ItemNotFoundError(req.params.path));
});

export default router;
