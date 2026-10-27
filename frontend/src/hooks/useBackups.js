import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createBackup,
	deleteBackup,
	exportPreview,
	getBackups,
	getBackupTypes,
	restoreBackup,
	uploadBackup,
	uploadImport,
} from "src/api/backend";

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
 * What an export of the chosen items would contain: the items, the linked items they need and whether secrets may be
 * included.
 */
const useExportPreview = (kind, ids, enabled = true) =>
	useQuery({
		queryKey: ["backups", "export-preview", kind, ids],
		queryFn: () => exportPreview(kind, ids),
		enabled,
	});

/**
 * Variables: { file, kind, onProgress?, abortController? }. Resolves to { id, summary, encrypted }.
 */
const useImportUpload = () =>
	useMutation({
		mutationFn: ({ kind, file, onProgress, abortController }) =>
			uploadImport(kind, file, onProgress, abortController),
	});

/**
 * Variables: { token, mode?, types, items?, choices?, planHash? }, replace by default. A restore or merge changes the
 * data behind every query.
 */
const useRestoreBackup = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ token, ...options }) => restoreBackup(token, options),
		onSuccess: () => queryClient.invalidateQueries(),
	});
};

export {
	useBackups,
	useBackupTypes,
	useCreateBackup,
	useDeleteBackup,
	useExportPreview,
	useImportUpload,
	useRestoreBackup,
	useUploadBackup,
};
