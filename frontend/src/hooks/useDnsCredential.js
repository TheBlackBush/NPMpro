import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createDnsCredential, getDnsCredential, updateDnsCredential } from "src/api/backend";

const fetchDnsCredential = (id) => {
	if (id === "new") {
		return Promise.resolve({ id: 0, name: "", provider: "", fields: [], iniSet: false, decryptError: false });
	}
	return getDnsCredential(id);
};

const useDnsCredential = (id) =>
	useQuery({
		queryKey: ["dns-credential", id],
		queryFn: () => fetchDnsCredential(id),
		staleTime: 60 * 1000,
	});

const useSetDnsCredential = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => (values.id ? updateDnsCredential(values) : createDnsCredential(values)),
		onSuccess: async ({ id }) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["dns-credential", id] }),
				queryClient.invalidateQueries({ queryKey: ["dns-credentials"] }),
				queryClient.invalidateQueries({ queryKey: ["certificates"] }),
				queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
			]);
		},
	});
};

export { useDnsCredential, useSetDnsCredential };
