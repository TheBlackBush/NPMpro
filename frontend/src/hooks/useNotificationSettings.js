import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getEmailSettings,
	getNotificationSettings,
	sendTestMail,
	updateEmailSettings,
	updateNotificationSettings,
} from "src/api/backend";

const useEmailSettings = () =>
	useQuery({
		queryKey: ["email-settings"],
		queryFn: () => getEmailSettings(),
		staleTime: 60 * 1000,
	});

const useNotificationSettings = () =>
	useQuery({
		queryKey: ["notification-settings"],
		queryFn: () => getNotificationSettings(),
		staleTime: 60 * 1000,
	});

// a save changes the Environment page's locks and the audit log; the mail server also what the other sections offer
const useInvalidateNotifications = () => {
	const queryClient = useQueryClient();
	return () =>
		Promise.all(
			[["email-settings"], ["notification-settings"], ["audit-logs"], ["environment"], ["health"]].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
};

const useSaveEmailSettings = () => {
	const invalidate = useInvalidateNotifications();
	return useMutation({ mutationFn: (values) => updateEmailSettings(values), onSuccess: invalidate });
};

const useSaveNotificationSettings = () => {
	const invalidate = useInvalidateNotifications();
	return useMutation({ mutationFn: (values) => updateNotificationSettings(values), onSuccess: invalidate });
};

const useSendTestMail = () => useMutation({ mutationFn: (to) => sendTestMail(to) });

export {
	useEmailSettings,
	useNotificationSettings,
	useSaveEmailSettings,
	useSaveNotificationSettings,
	useSendTestMail,
};
