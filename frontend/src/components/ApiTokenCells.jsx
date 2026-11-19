import { CalendarX, ShieldAlert, Trash2 } from "lucide-react";
import { PERMISSION_ROWS } from "src/components/Form/PermissionButtons";
import { StatusBadge } from "src/components/StatusBadge";
import { intl, T } from "src/locale";
import { formatDateTime } from "src/locale/Utils";
import { permissionSummary, tokenMarks } from "src/modules/ApiTokens";

const PERMISSION_LABELS = Object.fromEntries(PERMISSION_ROWS);

const formatDate = (value) => new Intl.DateTimeFormat(intl.locale, { dateStyle: "medium" }).format(new Date(value));

const MARKS = {
	admin: { id: "api-tokens.admin", tone: "warning", Icon: ShieldAlert },
	allowDelete: { id: "api-tokens.allow-delete", tone: "destructive", Icon: Trash2 },
	expired: { id: "api-tokens.expired", tone: "destructive", Icon: CalendarX },
};

/** One badge with an icon per mark of a token (Administrator, Allow delete, Expired); the caller lays them out */
function TokenBadges({ token, now }) {
	return (
		<>
			{tokenMarks(token, now).map((mark) => {
				const { id, tone, Icon } = MARKS[mark];
				return (
					<StatusBadge key={mark} tone={tone} dot={false}>
						<Icon aria-hidden="true" className="size-3" />
						<T id={id} />
					</StatusBadge>
				);
			})}
		</>
	);
}

/** One "Section | Level" chip per section the token can use, and with visibility the Item Visibility line */
function TokenPermissions({ token, visibility = false }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap gap-1.5">
				{permissionSummary(token).map(([section, level]) => (
					<StatusBadge key={section} tone="muted" dot={false}>
						<T id={PERMISSION_LABELS[section]} />
						<span className="sr-only">: </span>
						<span aria-hidden="true" className="h-3 border-l" />
						<span className="font-normal text-muted-foreground">
							<T id={`permissions.${level}`} />
						</span>
					</StatusBadge>
				))}
			</div>
			{visibility ? (
				<p className="m-0 text-muted-foreground text-xs">
					<T id={`permissions.visibility.${token.visibility}`} />
				</p>
			) : null}
		</div>
	);
}

function TokenExpiry({ token }) {
	return token.expiresOn ? formatDate(token.expiresOn) : <T id="api-tokens.no-expiry" />;
}

function TokenLastUsed({ token }) {
	return token.lastUsedOn ? formatDateTime(token.lastUsedOn) : <T id="api-tokens.not-used" />;
}

function TokenCreated({ token }) {
	return token.createdOn ? formatDate(token.createdOn) : null;
}

function Fact({ label, children }) {
	return (
		<div className="flex flex-col">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="m-0 whitespace-nowrap text-sm">{children}</dd>
		</div>
	);
}

/** Expires, Last used and (unless created is false) Created, each a small label over its value */
function TokenFacts({ token, created = true }) {
	return (
		<dl className="m-0 flex flex-wrap gap-x-7 gap-y-2">
			<Fact label={<T id="api-tokens.expires" />}>
				<TokenExpiry token={token} />
			</Fact>
			<Fact label={<T id="api-tokens.last-used" />}>
				<TokenLastUsed token={token} />
			</Fact>
			{created ? (
				<Fact label={<T id="api-tokens.created" />}>
					<TokenCreated token={token} />
				</Fact>
			) : null}
		</dl>
	);
}

export { TokenBadges, TokenCreated, TokenExpiry, TokenFacts, TokenLastUsed, TokenPermissions };
