import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBackup, deleteBackup, getBackups, getBackupTypes, restoreBackup, uploadBackup } from "src/api/backend";

const useBackupTypes = () =>
	useQuery({
		queryKey: ["backup-types"],
		queryFn: () => getBackupTypes(),
		staleTime: 60 * 1000,
	});

const useBackups = () =>
	useQuery({
		queryKey: ["backups"],
		queryFn: () => getBackups(),
		staleTime: 10 * 1000,
	});

const useCreateBackup = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data) => createBackup(data),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
	});
};

const useDeleteBackup = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name) => deleteBackup(name),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
	});
};

/**
 * Variables: { file, onProgress?, abortController? }
 */
const useUploadBackup = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ file, onProgress, abortController }) => uploadBackup(file, onProgress, abortController),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
	});
};

/**
 * Variables: { token, types }. A restore changes the data behind every query.
 */
const useRestoreBackup = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ token, types }) => restoreBackup(token, types),
		onSuccess: () => queryClient.invalidateQueries(),
	});
};

export { useBackups, useBackupTypes, useCreateBackup, useDeleteBackup, useRestoreBackup, useUploadBackup };
