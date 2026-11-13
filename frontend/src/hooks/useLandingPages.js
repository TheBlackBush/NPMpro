import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getLandingPages, updateLandingPages } from "src/api/backend";

const useLandingPages = () =>
	useQuery({ queryKey: ["landing-pages"], queryFn: () => getLandingPages(), staleTime: 60 * 1000 });

const useSaveLandingPages = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => updateLandingPages(values),
		onSuccess: () =>
			Promise.all(
				[["landing-pages"], ["audit-logs"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
			),
	});
};

export { useLandingPages, useSaveLandingPages };
