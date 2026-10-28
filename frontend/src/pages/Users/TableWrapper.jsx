import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { adminDisableMfa, deleteUser, revokeSessions, toggleUser } from "src/api/backend";
import { Button, ErrorAlert, ListToolbar, LoadingPage } from "src/components";
import { useListFilters, useUser, useUsers } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal, showPermissionsModal, showSetPasswordModal, showUserModal } from "src/modals";
import { activeFilterCount } from "src/modules/ListFilters";
import { showApiError, showObjectSuccess } from "src/notifications";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useUsers();
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

	const needle = filters.q.trim().toLowerCase();
	const displayed = (data ?? []).filter(
		(item) =>
			needle === "" || item.name.toLowerCase().includes(needle) || item.email.toLowerCase().includes(needle),
	);
	const isFiltered = activeFilterCount(filters, []) > 0 && Boolean(data?.length);

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-orange" />
			<div className="card-table">
				<div className="card-header flex-wrap gap-2">
					<h2 className="card-title text-nowrap">
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
				<ListToolbar
					filters={filters}
					setFilter={setFilter}
					clear={clear}
					total={data?.length ?? 0}
					shown={displayed.length}
					kinds={[]}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
				<Table
					data={displayed}
					isFiltered={isFiltered}
					sorting={sorting}
					onSortingChange={setSorting}
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
