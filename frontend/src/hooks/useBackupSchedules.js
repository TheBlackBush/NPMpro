import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBackupSchedule, getBackupSchedules, runBackupSchedule, updateBackupSchedule } from "src/api/backend";

// a schedule change or run can change the stored backups and the dashboard's failed schedules
const INVALIDATED = [["backup-schedules"], ["backups"], ["host-report"]];

const invalidateAll = (queryClient) =>
	Promise.all(INVALIDATED.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

/**
 * The backup schedules; administrators only
 */
const useBackupSchedules = (enabled = true) =>
	useQuery({
		queryKey: ["backup-schedules"],
		queryFn: () => getBackupSchedules(),
		staleTime: 10 * 1000,
		enabled,
	});

/**
 * Variables: { id?, ...data }; creates without an id, else updates
 */
const useSaveBackupSchedule = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...data }) => (id ? updateBackupSchedule(id, data) : createBackupSchedule(data)),
		onSuccess: () => invalidateAll(queryClient),
	});
};

/**
 * Variables: the schedule id; resolves when the backup is finished. A failed run changes the schedule too.
 */
const useRunBackupSchedule = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id) => runBackupSchedule(id),
		onSettled: () => invalidateAll(queryClient),
	});
};

export { useBackupSchedules, useRunBackupSchedule, useSaveBackupSchedule };
