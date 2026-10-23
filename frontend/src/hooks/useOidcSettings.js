import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	deleteOidcIcon,
	downloadOidcIcon,
	getOidcSettings,
	testOidcSettings,
	updateOidcSettings,
	uploadOidcIcon,
} from "src/api/backend";

const useOidcSettings = () => {
	return useQuery({
		queryKey: ["oidc-settings"],
		queryFn: () => getOidcSettings(),
		staleTime: 60 * 1000, // 1 minute
	});
};

const useInvalidateOidc = () => {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["oidc-settings"] }),
			queryClient.invalidateQueries({ queryKey: ["health"] }),
			queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
		]);
};

const useSaveOidcSettings = () => {
	const invalidate = useInvalidateOidc();
	return useMutation({
		mutationFn: (values) => updateOidcSettings(values),
		onSuccess: invalidate,
	});
};

const useTestOidcSettings = () => useMutation({ mutationFn: (values) => testOidcSettings(values) });

const useUploadOidcIcon = () => {
	const invalidate = useInvalidateOidc();
	return useMutation({
		mutationFn: (file) => uploadOidcIcon(file),
		onSuccess: invalidate,
	});
};

const useDownloadOidcIcon = () => {
	const invalidate = useInvalidateOidc();
	return useMutation({
		mutationFn: (url) => downloadOidcIcon(url),
		onSuccess: invalidate,
	});
};

const useDeleteOidcIcon = () => {
	const invalidate = useInvalidateOidc();
	return useMutation({
		mutationFn: () => deleteOidcIcon(),
		onSuccess: invalidate,
	});
};

export {
	useDeleteOidcIcon,
	useDownloadOidcIcon,
	useOidcSettings,
	useSaveOidcSettings,
	useTestOidcSettings,
	useUploadOidcIcon,
};
