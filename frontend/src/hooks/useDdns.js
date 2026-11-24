import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	checkDdnsNow,
	createDdnsRecord,
	deleteDdnsRecord,
	getDdnsHistory,
	getDdnsProviders,
	getDdnsRecord,
	getDdnsRecords,
	getDdnsStatus,
	getDdnsSuggestions,
	updateDdnsRecord,
	updateDdnsRecordNow,
} from "src/api/backend";
import { CERTIFICATES, hasPermission, VIEW } from "src/modules/Permissions";
import { useUser } from "./useUser";

// every change of a record (and Update now, Check now) can change the list, the record, the status and the audit log
const DDNS_KEYS = [
	["ddns-records"],
	["ddns-suggestions"],
	["ddns-record"],
	["ddns-status"],
	["ddns-history"],
	["audit-logs"],
];

// the updater works in the background: a mounted list and status page ask again every 30 seconds (the tab strip's
// count passes refetchInterval: false, so only the open Dynamic DNS tab polls)
const POLL_MS = 30_000;

const useDdnsRecords = (expand, options = {}) =>
	useQuery({
		queryKey: ["ddns-records", expand],
		queryFn: () => getDdnsRecords(expand),
		refetchInterval: POLL_MS,
		staleTime: 10 * 1000,
		...options,
	});

const useDdnsRecord = (id, expand, options = {}) =>
	useQuery({
		queryKey: ["ddns-record", id, expand],
		queryFn: () => getDdnsRecord(id, expand),
		enabled: id !== undefined && id !== null,
		staleTime: 10 * 1000,
		...options,
	});

const useDdnsStatus = (options = {}) =>
	useQuery({
		queryKey: ["ddns-status"],
		queryFn: getDdnsStatus,
		refetchInterval: POLL_MS,
		staleTime: 10 * 1000,
		...options,
	});

const useDdnsHistory = (id, options = {}) =>
	useQuery({
		queryKey: ["ddns-history", id],
		queryFn: () => getDdnsHistory(id),
		enabled: id !== undefined && id !== null,
		staleTime: 10 * 1000,
		...options,
	});

// the providers change only with a new version
const useDdnsProviders = (options = {}) =>
	useQuery({
		queryKey: ["ddns-providers"],
		queryFn: getDdnsProviders,
		staleTime: 10 * 60 * 1000,
		...options,
	});

// the host names without a record; input help only (needs Certificates view, like the records)
const useDdnsSuggestions = ({ enabled = true, ...options } = {}) => {
	const { data: user } = useUser("me");
	return useQuery({
		queryKey: ["ddns-suggestions"],
		queryFn: getDdnsSuggestions,
		staleTime: 10 * 1000,
		retry: false,
		...options,
		enabled: enabled && hasPermission(CERTIFICATES, VIEW, user?.permissions, user?.roles),
	});
};

// also after a failure: a refused Update now (cooldown, pause) still stored when the record was last checked
const useDdnsMutation = (mutationFn) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSettled: () => Promise.all(DDNS_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
	});
};

// a credential cannot be deleted while a record uses it, so the credentials lists follow a record's delete too
const useDeleteDdnsRecord = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteDdnsRecord,
		onSuccess: () =>
			Promise.all(
				[...DDNS_KEYS, ["dns-credentials"], ["dns-credential"]].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			),
	});
};

const useSetDdnsRecord = () =>
	useDdnsMutation((values) => (values.id ? updateDdnsRecord(values) : createDdnsRecord(values)));
const useUpdateDdnsRecordNow = () => useDdnsMutation(updateDdnsRecordNow);
const useCheckDdnsNow = () => useDdnsMutation(checkDdnsNow);

export {
	DDNS_KEYS,
	useCheckDdnsNow,
	useDdnsHistory,
	useDdnsProviders,
	useDdnsRecord,
	useDdnsRecords,
	useDdnsStatus,
	useDdnsSuggestions,
	useDeleteDdnsRecord,
	useSetDdnsRecord,
	useUpdateDdnsRecordNow,
};
