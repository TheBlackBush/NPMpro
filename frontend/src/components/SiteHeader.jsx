import { Collapse } from "@tabler/core";
import { IconDevicesX, IconLock, IconLogout, IconShieldLock, IconUser } from "@tabler/icons-react";
import { BrandMark, LocalePicker, NavLink, ThemeSwitcher } from "src/components";
import { useAuthState } from "src/context";
import { useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { showChangePasswordModal, showMfaModal, showUserModal } from "src/modals";
import { isAdmin } from "src/modules/Permissions";
import { showApiError } from "src/notifications";

export function SiteHeader() {
	const { data: currentUser } = useUser("me");
	const role = isAdmin(currentUser?.roles) ? "role.admin" : "role.standard-user";
	const { logout, logoutEverywhere } = useAuthState();

	return (
		<header className="navbar navbar-expand-lg d-print-none">
			<div className="container-xl">
				<button
					className="navbar-toggler"
					type="button"
					data-bs-toggle="collapse"
					data-bs-target="#navbar-menu"
					aria-controls="navbar-menu"
					aria-expanded="false"
					aria-label={intl.formatMessage({ id: "aria.toggle-navigation" })}
				>
					<span className="navbar-toggler-icon" />
				</button>
				<h1 className="navbar-brand pe-0 pe-md-3">
					<NavLink to="/">
						<BrandMark variant="horizontal" size={66} alt="NPMpro" />
					</NavLink>
				</h1>
				<div className="navbar-nav flex-row order-md-last">
					<div className="d-none d-md-flex">
						<div className="nav-item">
							<LocalePicker />
						</div>
						<div className="nav-item">
							<ThemeSwitcher />
						</div>
					</div>
					<div className="nav-item d-md-flex">
						<div className="nav-item dropdown">
							<button
								type="button"
								className="nav-link d-flex lh-1 text-reset"
								data-bs-toggle="dropdown"
								onClick={() => {
									// on phones the navigation and the user menu overlap; close the navigation when the menu opens
									const menu = document.querySelector("#navbar-menu");
									if (menu?.classList.contains("show")) {
										Collapse.getOrCreateInstance(menu).hide();
									}
								}}
								aria-label={intl.formatMessage({ id: "aria.user-menu" })}
							>
								<span
									className="avatar avatar-square avatar-sm"
									style={{
										backgroundImage: `url(${currentUser?.avatar || "/images/default-avatar.jpg"})`,
									}}
								/>

								<div className="d-none d-xl-block ps-2">
									<div>{currentUser?.name}</div>
									<div className="mt-1 small text-secondary">
										<T id={role} />
									</div>
								</div>
							</button>
							<div className="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
								<div className="d-md-none">
									<div className="dropdown-header">
										<div>{currentUser?.name}</div>
										<div className="small text-secondary text-nowrap">
											<T id={role} />
										</div>
									</div>
									{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents lint/a11y/noNoninteractiveElementInteractions: onClick only stops propagation so using the theme and language buttons does not close the user menu. */}
									<div
										className="dropdown-item-text d-flex align-items-center gap-2"
										onClick={(e) => e.stopPropagation()}
									>
										<ThemeSwitcher />
										<LocalePicker menuAlign="end" />
									</div>
									<div className="dropdown-divider" />
								</div>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										showUserModal("me");
									}}
								>
									<IconUser className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="user.edit-profile" />
								</button>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										showChangePasswordModal("me");
									}}
								>
									<IconLock className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="user.change-password" />
								</button>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										showMfaModal("me");
									}}
								>
									<IconShieldLock className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="user.mfa" />
								</button>
								<div className="dropdown-divider" />
								<button
									type="button"
									className="dropdown-item"
									onClick={async () => {
										try {
											await logout();
										} catch (err) {
											showApiError(err);
										}
									}}
								>
									<IconLogout className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="user.logout" />
								</button>
								<button
									type="button"
									className="dropdown-item"
									onClick={async () => {
										try {
											await logoutEverywhere();
										} catch (err) {
											showApiError(err);
										}
									}}
								>
									<IconDevicesX className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="user.logout-everywhere" />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</header>
	);
}
