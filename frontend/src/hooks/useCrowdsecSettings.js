import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCrowdsecSettings, testCrowdsecSettings, updateCrowdsecSettings } from "src/api/backend";

const useCrowdsecSettings = () =>
	useQuery({
		queryKey: ["crowdsec-settings"],
		queryFn: () => getCrowdsecSettings(),
		staleTime: 60 * 1000,
	});

// a save changes what the Monitoring pages and the current user's Monitoring entry show
const useSaveCrowdsecSettings = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => updateCrowdsecSettings(values),
		onSuccess: () =>
			Promise.all(
				[["crowdsec-settings"], ["monitoring-crowdsec"], ["monitoring-summary"], ["audit-logs"], ["user"]].map(
					(queryKey) => queryClient.invalidateQueries({ queryKey }),
				),
			),
	});
};

const useTestCrowdsecSettings = () => useMutation({ mutationFn: (values) => testCrowdsecSettings(values) });

export { useCrowdsecSettings, useSaveCrowdsecSettings, useTestCrowdsecSettings };
