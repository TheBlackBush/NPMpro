import { ChevronsUpDown, Lock, LogOut, MonitorSmartphone, ShieldCheck, User } from "lucide-react";
import { useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { useAuthState, usePreferences } from "src/context";
import { useUser } from "src/hooks";
import { useIsMobile } from "src/hooks/use-mobile";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { showChangePasswordModal, showMfaModal, showUserModal } from "src/modals";
import { isAdmin } from "src/modules/Permissions";
import { showApiError } from "src/notifications";

function Choice({ label, value, options, onChange }) {
	const isMobile = useIsMobile();
	const group = (
		<DropdownMenuRadioGroup value={value} onValueChange={onChange}>
			{options.map(([optionValue, optionLabel]) => (
				<DropdownMenuRadioItem key={optionValue} value={optionValue}>
					<T id={optionLabel} />
				</DropdownMenuRadioItem>
			))}
		</DropdownMenuRadioGroup>
	);

	// A submenu opens beside the menu and does not fit on a phone: there the choices are listed inline.
	if (isMobile) {
		return (
			<>
				<DropdownMenuLabel className="pt-2 font-normal">
					<T id={label} />
				</DropdownMenuLabel>
				{group}
			</>
		);
	}
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<T id={label} />
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="w-44">{group}</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

/**
 * The signed-in user's menu: profile actions, the Appearance preferences and logout.
 *
 * @param {Object} props
 * @param {"topbar"|"sidebar"} [props.variant]  the sidebar variant has a full width trigger
 */
export function UserMenu({ variant = "topbar" }) {
	const { data: user } = useUser("me");
	const { navLayout, setNavLayout, editorStyle, setEditorStyle } = usePreferences();
	const { logout, logoutEverywhere } = useAuthState();
	const sidebar = variant === "sidebar";
	// The windows are not Radix: they open once the menu has closed and returned focus to its button (in
	// onCloseAutoFocus), so the menu's pointer lock is gone and each window returns focus to the button (as RowActions)
	const pendingWindow = useRef(null);
	const openModal = (show) => () => {
		pendingWindow.current = show;
	};
	const role = isAdmin(user?.roles) ? "role.admin" : "role.standard-user";

	const signOut = (action) => async () => {
		try {
			await action();
		} catch (err) {
			showApiError(err);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={intl.formatMessage({ id: "aria.user-menu" })}
				className={cn(
					"flex items-center gap-2 rounded-lg p-1 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
					sidebar && "w-full",
				)}
			>
				<Avatar>
					<AvatarImage src={user?.avatar || "/images/default-avatar.jpg"} alt="" />
					<AvatarFallback>{user?.name?.trim().charAt(0).toUpperCase()}</AvatarFallback>
				</Avatar>
				<span
					className={cn(
						"min-w-0 flex-col leading-tight",
						sidebar ? "flex flex-1 group-data-[collapsible=icon]:hidden" : "hidden md:flex",
					)}
				>
					<span className="truncate text-sm font-medium">{user?.name}</span>
					<span className="truncate text-xs text-muted-foreground">
						<T id={role} />
					</span>
				</span>
				{sidebar ? (
					<ChevronsUpDown
						className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
						aria-hidden="true"
					/>
				) : null}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={sidebar ? "start" : "end"}
				side={sidebar ? "top" : "bottom"}
				className="w-56"
				onCloseAutoFocus={() => {
					// no preventDefault: Radix focuses the button right after this handler, then the window opens
					const show = pendingWindow.current;
					pendingWindow.current = null;
					if (show) setTimeout(() => show("me"), 0);
				}}
			>
				<DropdownMenuItem onSelect={openModal(showUserModal)}>
					<User aria-hidden="true" />
					<T id="user.edit-profile" />
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={openModal(showChangePasswordModal)}>
					<Lock aria-hidden="true" />
					<T id="user.change-password" />
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={openModal(showMfaModal)}>
					<ShieldCheck aria-hidden="true" />
					<T id="user.mfa" />
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>
					<T id="appearance" />
				</DropdownMenuLabel>
				<Choice
					label="appearance.navigation"
					value={navLayout}
					onChange={setNavLayout}
					options={[
						["top", "appearance.navigation.top"],
						["sidebar", "appearance.navigation.sidebar"],
					]}
				/>
				<Choice
					label="appearance.editor"
					value={editorStyle}
					onChange={setEditorStyle}
					options={[
						["dialog", "appearance.editor.dialog"],
						["sheet", "appearance.editor.sheet"],
					]}
				/>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={signOut(logout)}>
					<LogOut aria-hidden="true" />
					<T id="user.logout" />
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={signOut(logoutEverywhere)}>
					<MonitorSmartphone aria-hidden="true" />
					<T id="user.logout-everywhere" />
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
