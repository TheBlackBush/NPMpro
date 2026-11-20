import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getAcmeProfiles,
	getAcmeSettings,
	registerAcmeAccount,
	replaceAcmeAccount,
	updateAcmeSettings,
} from "src/api/backend";

const useAcmeSettings = () =>
	useQuery({
		queryKey: ["acme-settings"],
		queryFn: () => getAcmeSettings(),
		staleTime: 60 * 1000,
	});

const useAcmeProfiles = (server, { enabled = true } = {}) =>
	useQuery({
		queryKey: ["acme-profiles", server],
		queryFn: () => getAcmeProfiles(server),
		staleTime: 5 * 60 * 1000,
		retry: false,
		enabled,
	});

const useInvalidateAcme = () => {
	const queryClient = useQueryClient();
	return () =>
		Promise.all(
			[["acme-settings"], ["acme-profiles"], ["runtime-settings", "certificates"], ["audit-logs"]].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
};

const useSaveAcmeSettings = () => {
	const invalidate = useInvalidateAcme();
	return useMutation({ mutationFn: (values) => updateAcmeSettings(values), onSettled: invalidate });
};

const useRegisterAcmeAccount = () => {
	const invalidate = useInvalidateAcme();
	return useMutation({ mutationFn: (server) => registerAcmeAccount(server), onSettled: invalidate });
};

const useReplaceAcmeAccount = () => {
	const invalidate = useInvalidateAcme();
	return useMutation({ mutationFn: (values) => replaceAcmeAccount(values), onSuccess: invalidate });
};

export { useAcmeProfiles, useAcmeSettings, useRegisterAcmeAccount, useReplaceAcmeAccount, useSaveAcmeSettings };
