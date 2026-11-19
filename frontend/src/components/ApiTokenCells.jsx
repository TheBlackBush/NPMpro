import { CalendarX, ChevronDown, ShieldAlert, Trash2 } from "lucide-react";
import { PERMISSION_ROWS } from "src/components/Form/PermissionButtons";
import { StatusBadge } from "src/components/StatusBadge";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { Separator } from "src/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "src/components/ui/sheet";
import { useIsMobile } from "src/hooks/use-mobile";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { formatDateTime } from "src/locale/Utils";
import { permissionSummary, tokenMarks } from "src/modules/ApiTokens";
import { sectionIcon } from "src/shell/useNavItems";

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

const LEVEL_TONES = {
	manage: "border-primary/40 bg-primary/15 text-foreground",
	view: "border-border bg-muted text-foreground",
	hidden: "border-dashed border-border bg-transparent text-muted-foreground",
};

function LevelBadge({ level }) {
	const shown = level === "manage" || level === "view" ? level : "hidden";
	return (
		<Badge variant="outline" className={cn("h-auto py-0.5", LEVEL_TONES[shown])}>
			<T id={`permissions.${shown}`} />
		</Badge>
	);
}

function DetailLine({ label, children }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium">{children}</span>
		</div>
	);
}

/** The six sections with their level, then Item Visibility, Administrator and Allow delete (the popover and sheet body) */
function PermissionDetails({ token }) {
	return (
		<div className="flex flex-col gap-2.5" data-token-permissions-list>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{PERMISSION_ROWS.map(([section, labelId]) => {
					const Icon = sectionIcon(section);
					return (
						<li key={section} className="flex items-center justify-between gap-3">
							<span className="flex min-w-0 items-center gap-2">
								{Icon ? (
									<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
								) : null}
								<T id={labelId} />
							</span>
							<LevelBadge level={token.permissions?.[section]} />
						</li>
					);
				})}
			</ul>
			<Separator />
			<DetailLine label={<T id="permissions.visibility.title" />}>
				<T id={`permissions.visibility.${token.visibility}`} />
			</DetailLine>
			<DetailLine label={<T id="api-tokens.admin" />}>
				<T id={token.admin ? "enabled" : "disabled"} />
			</DetailLine>
			<DetailLine label={<T id="api-tokens.allow-delete" />}>
				<T id={token.allowDelete ? "enabled" : "disabled"} />
			</DetailLine>
		</div>
	);
}

function PermissionsButton({ token, ...rest }) {
	return (
		<Button
			type="button"
			variant="outline"
			size="xs"
			className="self-start"
			aria-label={intl.formatMessage({ id: "api-tokens.permissions-of" }, { name: token.name })}
			{...rest}
		>
			<T id="api-tokens.permissions" />
			<ChevronDown aria-hidden="true" className="size-3" />
		</Button>
	);
}

/** The Permissions button with the details: a popover on a desktop, a bottom sheet on a phone (not the vaul drawer) */
function PermissionsDetails({ token }) {
	const phone = useIsMobile();
	if (phone) {
		return (
			<Sheet>
				<SheetTrigger asChild>
					<PermissionsButton token={token} />
				</SheetTrigger>
				<SheetContent side="bottom" showCloseButton={false} className="gap-3 p-4">
					<SheetHeader className="p-0">
						<SheetTitle className="flex items-center justify-between gap-3">
							<T id="api-tokens.permissions" />
							<span className="break-all font-normal text-muted-foreground text-sm">{token.name}</span>
						</SheetTitle>
					</SheetHeader>
					<PermissionDetails token={token} />
					<SheetClose asChild>
						<Button type="button" variant="outline" className="w-full">
							<T id="action.close" />
						</Button>
					</SheetClose>
				</SheetContent>
			</Sheet>
		);
	}
	return (
		<Popover>
			<PopoverTrigger asChild>
				<PermissionsButton token={token} />
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 gap-3 p-3.5">
				<div className="flex items-center justify-between gap-3 font-semibold">
					<T id="api-tokens.permissions" />
					<span className="break-all font-normal text-muted-foreground text-xs">{token.name}</span>
				</div>
				<PermissionDetails token={token} />
			</PopoverContent>
		</Popover>
	);
}

function SummaryText({ token }) {
	return permissionSummary(token.permissions)
		.map(([key, count]) => intl.formatMessage({ id: `api-tokens.summary.${key}` }, { count }))
		.join(" \u00b7 ");
}

/** One summary line of the six section levels, with Item Visibility under it (visibility) and the Permissions button */
function TokenPermissions({ token, visibility = false }) {
	return (
		<div className="flex flex-col items-start gap-1.5">
			<p className="m-0 font-medium text-sm" data-token-summary>
				<SummaryText token={token} />
			</p>
			{visibility ? (
				<p className="m-0 text-muted-foreground text-xs">
					<T id={`permissions.visibility.${token.visibility}`} />
				</p>
			) : null}
			<PermissionsDetails token={token} />
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
