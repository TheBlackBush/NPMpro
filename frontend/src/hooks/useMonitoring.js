import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getGeoipSettings,
	getMonitoringCrowdsec,
	getMonitoringSettings,
	getMonitoringSummary,
	getMonitoringTraffic,
	updateGeoipNow,
	updateGeoipSettings,
	updateMonitoringSettings,
} from "src/api/backend";

const POLL = {
	refetchInterval: 60 * 1000,
	refetchIntervalInBackground: false,
	staleTime: 30 * 1000,
	// one retry: the page refreshes every minute anyway, so an error shows soon instead of after three retries
	retry: 1,
};

const useMonitoringTraffic = (range = "24h", host = "") =>
	useQuery({
		queryKey: ["monitoring-traffic", range, host],
		queryFn: () => getMonitoringTraffic(range, host),
		...POLL,
		// keep showing the last range or host while the next one loads, so the chart and map stay mounted
		placeholderData: keepPreviousData,
	});

const useMonitoringCrowdsec = () =>
	useQuery({
		queryKey: ["monitoring-crowdsec"],
		queryFn: () => getMonitoringCrowdsec(),
		...POLL,
	});

const useMonitoringSummary = () =>
	useQuery({
		queryKey: ["monitoring-summary"],
		queryFn: () => getMonitoringSummary(),
		...POLL,
	});

const useMonitoringSettings = () =>
	useQuery({
		queryKey: ["monitoring-settings"],
		queryFn: () => getMonitoringSettings(),
		staleTime: 60 * 1000,
	});

const useGeoipSettings = () =>
	useQuery({
		queryKey: ["geoip-settings"],
		queryFn: () => getGeoipSettings(),
		staleTime: 60 * 1000,
	});

const useSaveMonitoringSettings = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => updateMonitoringSettings(values),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: ["monitoring-settings"] }),
				queryClient.invalidateQueries({ queryKey: ["monitoring-traffic"] }),
				queryClient.invalidateQueries({ queryKey: ["monitoring-summary"] }),
				queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
			]),
	});
};

const useSaveGeoipSettings = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (values) => updateGeoipSettings(values),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: ["geoip-settings"] }),
				queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
			]),
	});
};

const useUpdateGeoipNow = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => updateGeoipNow(),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: ["geoip-settings"] }),
				queryClient.invalidateQueries({ queryKey: ["monitoring-traffic"] }),
			]),
	});
};

export {
	useGeoipSettings,
	useMonitoringCrowdsec,
	useMonitoringSettings,
	useMonitoringSummary,
	useMonitoringTraffic,
	useSaveGeoipSettings,
	useSaveMonitoringSettings,
	useUpdateGeoipNow,
};
