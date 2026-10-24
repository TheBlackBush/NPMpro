import { IconSearch } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { adminDisableMfa, deleteUser, revokeSessions, toggleUser } from "src/api/backend";
import { Button, ErrorAlert, LoadingPage } from "src/components";
import { useUser, useUsers } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal, showPermissionsModal, showSetPasswordModal, showUserModal } from "src/modals";
import { showApiError, showObjectSuccess } from "src/notifications";
import Table from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const { isFetching, isPending, isError, error, data } = useUsers();

	useEffect(() => {
		// this can happen if someone deletes the last item while searching
		if (search !== "" && !data?.length) {
			setSearch("");
		}
	});
	const { data: currentUser } = useUser("me");

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const handleDisableToggle = async (id, enabled) => {
		try {
			await toggleUser(id, enabled);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["users"] }),
				queryClient.invalidateQueries({ queryKey: ["user", id] }),
			]);
			showObjectSuccess("user", enabled ? "enabled" : "disabled");
		} catch (err) {
			showApiError(err);
		}
	};

	let filtered = null;
	if (search) {
		filtered = data?.filter((item) => item.name.toLowerCase().includes(search) || item.email.includes(search));
	}

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-orange" />
			<div className="card-table">
				<div className="card-header">
					<h2 className="card-title">
						<T id="users" />
					</h2>
					<div className="card-actions btn-list">
						{data?.length ? (
							<Button size="sm" color="orange" onClick={() => showUserModal("new")}>
								<T id="object.add" tData={{ object: "user" }} />
							</Button>
						) : null}
					</div>
				</div>
				<div className="card-body border-bottom text-secondary">
					<T id="users.oidc-hint" />{" "}
					<Link to="/settings/authentication">
						<T id="users.oidc-hint.link" />
					</Link>
				</div>
				{data?.length ? (
					<div className="card-body border-bottom py-3">
						<div className="row g-2 align-items-center">
							<div className="col-12 col-md">
								<div className="input-group input-group-flat input-group-sm">
									<span className="input-group-text">
										<IconSearch className="icon" aria-hidden="true" />
									</span>
									<input
										type="text"
										className="form-control"
										placeholder={intl.formatMessage({ id: "search" })}
										aria-label={intl.formatMessage({ id: "search" })}
										autoComplete="off"
										onChange={(e) => setSearch(e.target.value.toLowerCase().trim())}
									/>
								</div>
							</div>
						</div>
					</div>
				) : null}
				<Table
					data={filtered ?? data ?? []}
					isFiltered={search}
					isFetching={isFetching}
					currentUserId={currentUser?.id}
					onEditUser={(id) => showUserModal(id)}
					onEditPermissions={(id) => showPermissionsModal(id)}
					onSetPassword={(id) => showSetPasswordModal(id)}
					onResetMfa={(id) => {
						const user = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							tTitle: "user.reset-mfa",
							children: <T id="user.reset-mfa.content" />,
							subject: user?.name,
							details: user?.email,
							onConfirm: async () => {
								await adminDisableMfa(id);
								showObjectSuccess("user", "updated");
							},
							invalidations: [["users"], ["user", id]],
						});
					}}
					onRevokeSessions={(id) => {
						const user = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							tTitle: "user.revoke-sessions",
							children: <T id="user.revoke-sessions.content" />,
							subject: user?.name,
							details: user?.email,
							onConfirm: async () => {
								await revokeSessions(id);
								showObjectSuccess("user", "updated");
							},
							invalidations: [["users"], ["user", id]],
						});
					}}
					onDeleteUser={(id) => {
						const user = data?.find((item) => item.id === id);
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "user" }} />,
							onConfirm: async () => {
								await deleteUser(id);
								showObjectSuccess("user", "deleted");
							},
							invalidations: [["users"], ["user", id]],
							children: <T id="object.delete.content" tData={{ object: "user" }} />,
							subject: user?.name,
							details: user?.email,
						});
					}}
					onDisableToggle={handleDisableToggle}
					onNewUser={() => showUserModal("new")}
				/>
			</div>
		</div>
	);
}
