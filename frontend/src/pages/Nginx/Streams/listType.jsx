import { deleteStream, toggleStream } from "src/api/backend";
import { getDirectory, useStreams } from "src/hooks";
import { showStreamModal } from "src/modals";
import { HOST_TYPES } from "src/modules/HostTypes";
import Table, { useColumns } from "./Table";

export const streamList = {
	...HOST_TYPES.stream,
	type: "stream",
	useList: useStreams,
	useColumns,
	Table,
	toggle: toggleStream,
	remove: deleteStream,
	showModal: showStreamModal,
	searchText: (item) =>
		`${item.incomingPort} ${item.forwardingHost}:${item.forwardingPort} ${item.npmproDescription ?? ""} ${getDirectory(item) ?? ""}`,
	deleteSubject: (stream) =>
		stream
			? `${stream.incomingPort} → ${stream.forwardingHost}${stream.forwardingPort ? `:${stream.forwardingPort}` : ""}`
			: null,
	deleteDetails: (stream) => stream?.npmproDescription,
};
