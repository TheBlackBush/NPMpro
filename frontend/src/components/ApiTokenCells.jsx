import { PERMISSION_ROWS } from "src/components/Form/PermissionButtons";
import { StatusBadge } from "src/components/StatusBadge";
import { intl, T } from "src/locale";
import { permissionSummary, tokenState } from "src/modules/ApiTokens";

const PERMISSION_LABELS = Object.fromEntries(PERMISSION_ROWS);

const formatDate = (value) => new Intl.DateTimeFormat(intl.locale, { dateStyle: "medium" }).format(new Date(value));

/** The Administrator and Expired badges of a token, beside its name */
function TokenBadges({ token, now }) {
	return (
		<>
			{token.admin ? (
				<StatusBadge tone="warning">
					<T id="api-tokens.admin" />
				</StatusBadge>
			) : null}
			{tokenState(token, now) === "expired" ? (
				<StatusBadge tone="destructive">
					<T id="api-tokens.expired" />
				</StatusBadge>
			) : null}
		</>
	);
}

/** One badge per section the token can use, with its level */
function TokenPermissions({ token }) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{permissionSummary(token).map(([section, level]) => (
				<StatusBadge key={section} tone="muted">
					<T id={PERMISSION_LABELS[section]} />: <T id={`permissions.${level}`} />
				</StatusBadge>
			))}
		</div>
	);
}

function TokenExpiry({ token }) {
	return token.expiresOn ? formatDate(token.expiresOn) : <T id="api-tokens.no-expiry" />;
}

function TokenLastUsed({ token }) {
	return token.lastUsedOn ? formatDate(token.lastUsedOn) : <T id="api-tokens.not-used" />;
}

function TokenCreated({ token }) {
	return token.createdOn ? formatDate(token.createdOn) : null;
}

export { TokenBadges, TokenCreated, TokenExpiry, TokenLastUsed, TokenPermissions };
