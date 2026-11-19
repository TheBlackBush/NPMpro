import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { cn } from "src/lib/utils";
import { avatarColor, defaultAvatar, hasNoPicture, initials } from "src/modules/Avatar";

/**
 * A user's round picture: the uploaded or Gravatar picture, else the initials on a colour of the name, else the
 * default picture. Not focusable and without a tooltip (a focused avatar opened its tooltip when a window started).
 *
 * @param {{ user?: Object, className?: string }} props
 */
export function UserAvatar({ user, className }) {
	const letters = initials(user?.name, user?.email);
	return (
		<Avatar className={className}>
			{hasNoPicture(user?.avatar) ? null : <AvatarImage src={user.avatar} alt="" />}
			{letters ? (
				<AvatarFallback className={cn("font-bold", avatarColor(user?.name, user?.email).className)}>
					{letters}
				</AvatarFallback>
			) : (
				<AvatarFallback>
					<img src={defaultAvatar} alt="" className="size-full rounded-full object-cover" />
				</AvatarFallback>
			)}
		</Avatar>
	);
}
