import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { adminDisableMfa, deleteUser, revokeSessions, toggleUser } from "src/api/backend";
import { Button, ErrorAlert, ListToolbar, LoadingPage } from "src/components";
import { useListFilters, useUser, useUsers } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal, showPermissionsModal, showSetPasswordModal, showUserModal } from "src/modals";
import { activeFilterCount } from "src/modules/ListFilters";
import { showApiError, showObjectSuccess } from "src/notifications";
import { SettingsHeading } from "../Settings/SettingsHeading";
import Table, { useColumns } from "./Table";

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in Table
	const columns = useColumns();
	const { filters, setFilter, clear } = useListFilters();
	const { isFetching, isPending, isError, error, data } = useUsers();
	const { data: currentUser } = useUser("me");

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

	const loaded = !(isPending || isError);

	return (
		<section>
			<SettingsHeading
				titleId="users"
				actions={
					data?.length ? (
						<Button color="primary" size="sm" onClick={() => showUserModal("new")}>
							<Plus data-icon="inline-start" aria-hidden="true" />
							<T id="object.add" tData={{ object: "user" }} />
						</Button>
					) : null
				}
			/>
			<div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
				<div className="border-b px-4 py-3 text-sm text-muted-foreground">
					<T id="users.oidc-hint" />{" "}
					<Link to="/settings/authentication" className="underline underline-offset-4">
						<T id="users.oidc-hint.link" />
					</Link>
				</div>
				{loaded ? (
					<>
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
					</>
				) : isPending ? (
					<LoadingPage noLogo delay={300} />
				) : (
					<div className="p-4">
						<ErrorAlert error={error} />
					</div>
				)}
			</div>
		</section>
	);
}
