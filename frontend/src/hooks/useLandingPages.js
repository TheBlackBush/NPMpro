import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getLandingPages, updateLandingPages } from "src/api/backend";

const useLandingPages = () =>
	useQuery({ queryKey: ["landing-pages"], queryFn: () => getLandingPages(), staleTime: 60 * 1000 });

// the Default page is the default-site setting too
const useSaveLandingPages = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => updateLandingPages(values),
		onSuccess: () =>
			Promise.all(
				[["landing-pages"], ["setting", "default-site"], ["audit-logs"]].map((queryKey) =>
					queryClient.invalidateQueries({ queryKey }),
				),
			),
	});
};

export { useLandingPages, useSaveLandingPages };
