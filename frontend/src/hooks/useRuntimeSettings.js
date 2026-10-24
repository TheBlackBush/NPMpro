import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getEnvironment, getRuntimeSettings, updateRuntimeSettings } from "src/api/backend";

const useRuntimeSettings = (group) =>
	useQuery({
		queryKey: ["runtime-settings", group],
		queryFn: () => getRuntimeSettings(group),
		staleTime: 60 * 1000,
	});

/**
 * Saves a group. The caller builds the payload with runtimeSettingsPayload.
 */
const useSaveRuntimeSettings = (group) => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (payload) => updateRuntimeSettings(group, payload),
		onSuccess: () => {
			const keys = [["runtime-settings", group], ["environment"], ["audit-logs"]];
			// Write log files lives next to the traffic statistics: its lock state feeds the monitoring settings
			if (group === "logs") keys.push(["monitoring-settings"]);
			return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
		},
	});
};

const useEnvironment = () =>
	useQuery({
		queryKey: ["environment"],
		queryFn: () => getEnvironment(),
		staleTime: 60 * 1000,
	});

export { useEnvironment, useRuntimeSettings, useSaveRuntimeSettings };
