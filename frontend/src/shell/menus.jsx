import { CircleHelp, KeyRound, Languages, LogOut, Monitor, MonitorX, Moon, ShieldCheck, Sun, User } from "lucide-react";
import { useAuthState, useThemeState } from "src/context";
import { changeLocale, currentLocale, intl, localeOptions } from "src/locale";
import { showChangePasswordModal, showHelpModal, showMfaModal, showUserModal } from "src/modals";
import { isAdmin } from "src/modules/Permissions";
import { showApiError } from "src/notifications";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "src/ui/dropdown-menu";
import localeList from "translations/lang-list.json" with { type: "json" };

// the theme choices in the menu's order (modules/Theme.js values)
const THEMES = [
	{ value: "light", labelId: "theme.light", Icon: Sun },
	{ value: "dark", labelId: "theme.dark", Icon: Moon },
	{ value: "auto", labelId: "theme.system", Icon: Monitor },
];

const text = (id, values) => intl.formatMessage({ id }, values);

/** The theme choice as the button and the menu name it: "Theme: System", with its icon */
export function useThemeChoice() {
	const { preference, setPreference } = useThemeState();
	const current = THEMES.find((theme) => theme.value === preference) ?? THEMES[2];
	return {
		preference,
		setPreference,
		Icon: current.Icon,
		label: text("theme.label", { theme: text(current.labelId) }),
	};
}

/** Light, Dark, System as radio items; the chosen one is checked */
export function ThemeItems() {
	const { preference, setPreference } = useThemeChoice();
	return (
		<DropdownMenuRadioGroup value={preference} onValueChange={setPreference}>
			{THEMES.map(({ value, labelId, Icon }) => (
				<DropdownMenuRadioItem key={value} value={value}>
					<Icon aria-hidden="true" />
					{text(labelId)}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	);
}

/** Every language by its own name; choosing one reloads the app in it */
export function LanguageItems() {
	return (
		<DropdownMenuRadioGroup value={currentLocale} onValueChange={changeLocale}>
			{localeOptions.map((code) => (
				<DropdownMenuRadioItem key={code} value={code} lang={code}>
					{localeList[code].name}
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	);
}

/** The signed-in user: name and role, as the menu's label */
export function UserLabel({ user }) {
	return (
		<DropdownMenuLabel className="tw:font-normal">
			<div className="tw:truncate tw:font-medium tw:text-foreground">{user?.name}</div>
			<div className="tw:truncate tw:text-xs tw:text-muted-foreground">
				{text(isAdmin(user?.roles) ? "role.admin" : "role.standard-user")}
			</div>
		</DropdownMenuLabel>
	);
}

/** Edit Profile, Change Password, MFA, then Logout and Logout everywhere */
export function UserItems() {
	const { logout, logoutEverywhere } = useAuthState();
	const run = (action) => async () => {
		try {
			await action();
		} catch (err) {
			showApiError(err);
		}
	};
	return (
		<>
			<DropdownMenuGroup>
				<DropdownMenuItem onSelect={() => showUserModal("me")}>
					<User aria-hidden="true" />
					{text("user.edit-profile")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => showChangePasswordModal("me")}>
					<KeyRound aria-hidden="true" />
					{text("user.change-password")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => showMfaModal("me")}>
					<ShieldCheck aria-hidden="true" />
					{text("user.mfa")}
				</DropdownMenuItem>
			</DropdownMenuGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={run(logout)}>
				<LogOut aria-hidden="true" />
				{text("user.logout")}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={run(logoutEverywhere)}>
				<MonitorX aria-hidden="true" />
				{text("user.logout-everywhere")}
			</DropdownMenuItem>
		</>
	);
}

/**
 * The phone's avatar menu adds what the rail holds on a desktop: the page's help, the theme and the language
 *
 * @param {Object} props
 * @param {string|null} props.helpDoc  the current page's help document
 */
export function PhoneExtraItems({ helpDoc }) {
	const { Icon, label } = useThemeChoice();
	return (
		<>
			<DropdownMenuItem disabled={!helpDoc} onSelect={() => showHelpModal(helpDoc)}>
				<CircleHelp aria-hidden="true" />
				{text(helpDoc ? "help" : "nav.help-none")}
			</DropdownMenuItem>
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					<Icon aria-hidden="true" />
					{label}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent>
					<ThemeItems />
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					<Languages aria-hidden="true" />
					{text("nav.language")}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="tw:max-h-[60vh]">
					<LanguageItems />
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			<DropdownMenuSeparator />
		</>
	);
}
