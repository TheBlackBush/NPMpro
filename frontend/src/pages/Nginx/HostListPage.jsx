import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
	Button,
	ErrorAlert,
	HasPermission,
	ImportExportButtons,
	ListPage,
	ListToolbar,
	LoadingPage,
} from "src/components";
import { getDirectory, useDirectorySuggestions, useListFilters, usePaging } from "src/hooks";
import { T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { deleteInvalidations, toggleInvalidations } from "src/modules/HostTypes";
import { activeFilterCount, filterHosts } from "src/modules/ListFilters";
import { MANAGE } from "src/modules/Permissions";
import { getNginxConfigError, showApiError, showNginxConfigError, showObjectSuccess } from "src/notifications";

const FILTERS = ["status", "tls", "group"];

/**
 * The list page of a host type: query, filters, toolbar, import and export, and the row actions. list is the type's
 * config (pages/Nginx/<Type>/listType.jsx).
 */
export function HostListPage({ list }) {
	const queryClient = useQueryClient();
	const [sorting, setSorting] = useState([{ id: "enabled", desc: false }]);
	// only the ids, headers and sortability are read here; the cells render in the table
	const columns = list.useColumns();
	const { isFetching, isPending, isError, error, data } = list.useList(list.expand);
	const groups = useDirectorySuggestions(data);
	const { filters, setFilter, clear } = useListFilters(groups);
	const displayedHosts = filterHosts(data ?? [], filters, {
		searchText: list.searchText,
		getGroup: (item) => getDirectory(item) ?? "",
	});
	// a search, a filter or a new sort starts on the first page
	const paging = usePaging({
		list: list.pagingKey,
		total: displayedHosts.length,
		signature: JSON.stringify([filters, sorting]),
	});

	if (isPending) {
		return <LoadingPage noLogo delay={300} />;
	}

	if (isError) {
		return <ErrorAlert error={error} />;
	}

	const hostOf = (id) => data?.find((item) => item.id === id);
	const { Table, showModal } = list;
	const isFiltered = activeFilterCount(filters, FILTERS) > 0 && Boolean(data?.length);
	const groupingActive = displayedHosts.some(getDirectory);

	// turns the host on or off and says how it went; throws when the request fails
	const toggle = async (id, enabled) => {
		const row = await list.toggle(id, enabled);
		await Promise.all(
			toggleInvalidations(list.type, id).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
		);
		const nginxErr = getNginxConfigError(row);
		if (nginxErr === null) {
			showObjectSuccess(list.object, enabled ? "enabled" : "disabled");
		} else {
			showNginxConfigError(list.object, nginxErr);
		}
	};

	const handleDisableToggle = async (id, enabled) => {
		// a type may ask first (the proxy host that serves this page); the dialog shows a failure itself
		const question = enabled ? null : list.disableQuestion?.(hostOf(id));
		if (question) {
			showDeleteConfirmModal({ ...question, onConfirm: () => toggle(id, false), invalidations: [] });
			return;
		}
		try {
			await toggle(id, enabled);
		} catch (err) {
			showApiError(err);
		}
	};

	const handleDelete = (id) => {
		const host = hostOf(id);
		showDeleteConfirmModal({
			title: <T id="object.delete" tData={{ object: list.object }} />,
			onConfirm: async () => {
				await list.remove(id);
				showObjectSuccess(list.object, "deleted");
			},
			invalidations: deleteInvalidations(list.type, id),
			children: <T id="object.delete.content" tData={{ object: list.object }} />,
			subject: list.deleteSubject(host),
			details: list.deleteDetails?.(host),
			warning: list.deleteWarning?.(host),
		});
	};

	return (
		<ListPage
			title={<T id={list.objects} />}
			section={list.section}
			count={data.length}
			help={list.help}
			actions={
				<>
					<ImportExportButtons
						kind={list.kind}
						permissionSection={list.section}
						hasItems={Boolean(data?.length)}
					/>
					<HasPermission section={list.section} permission={MANAGE} hideError>
						{data?.length ? (
							<Button color="primary" size="sm" onClick={() => showModal("new")}>
								<Plus data-icon="inline-start" aria-hidden="true" />
								<T id="object.add" tData={{ object: list.object }} />
							</Button>
						) : null}
					</HasPermission>
				</>
			}
			toolbar={
				<ListToolbar
					filters={filters}
					setFilter={setFilter}
					clear={clear}
					total={data?.length ?? 0}
					shown={displayedHosts.length}
					kinds={FILTERS}
					groups={groups}
					sorting={{ columns, state: sorting, onChange: setSorting }}
				/>
			}
		>
			<Table
				data={displayedHosts}
				paging={paging}
				groupBy={groupingActive ? getDirectory : undefined}
				renderGroupLabel={(key) => (key === "" ? <T id={list.noDirectory} /> : key)}
				isFiltered={isFiltered}
				onClearFilters={clear}
				isFetching={isFetching}
				sorting={sorting}
				onSortingChange={setSorting}
				onEdit={(id) => showModal(id)}
				onClone={(id) => showModal(id, true)}
				onDelete={handleDelete}
				onDisableToggle={handleDisableToggle}
				onNew={() => showModal("new")}
			/>
		</ListPage>
	);
}
