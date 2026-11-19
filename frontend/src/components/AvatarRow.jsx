import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { deleteAvatar, uploadAvatar } from "src/api/backend";
import { ApiErrorContent, Button, GravatarFormatter } from "src/components";
import { T } from "src/locale";

/**
 * The picture with Upload avatar and Remove avatar (only for an uploaded picture). The window never starts here: the
 * picture's tooltip would open on a focused avatar.
 *
 * @param {{ id: "me"|number, user: Object, onError: Function }} props  onError(null) clears, onError(node) shows
 */
export function AvatarRow({ id, user, onError }) {
	const queryClient = useQueryClient();
	const fileInput = useRef(null);
	const change = async (request) => {
		onError(null);
		try {
			await request();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["user"] }),
				queryClient.invalidateQueries({ queryKey: ["users"] }),
			]);
		} catch (err) {
			onError(<ApiErrorContent error={err} />);
		}
	};
	return (
		<div className="mb-3 flex items-center gap-2" data-window-start-skip="">
			<GravatarFormatter url={user?.avatar} name={user?.name} email={user?.email} size="lg" />
			<input
				ref={fileInput}
				type="file"
				accept="image/png,image/jpeg,image/gif,image/webp"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					void change(() => uploadAvatar(id, file));
					e.target.value = "";
				}}
			/>
			<Button onClick={() => fileInput.current?.click()}>
				<T id="avatar.upload" />
			</Button>
			{user?.avatar?.startsWith("/images/avatar/") && (
				<Button color="danger" outline onClick={() => change(() => deleteAvatar(id))}>
					<T id="avatar.remove" />
				</Button>
			)}
		</div>
	);
}
