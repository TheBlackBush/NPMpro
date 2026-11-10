import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { cn } from "src/lib/utils";
import { avatarColor, defaultAvatar, hasNoPicture, initials } from "src/modules/Avatar";

// the avatar size names (xs to xl) as square edges and initials sizes; no size is the 40 px default
const sizes = { xs: "size-5", sm: "size-8", md: "size-12", lg: "size-20", xl: "size-28" };
const initialsSizes = { xs: "text-[8px]", sm: "text-xs", md: "text-base", lg: "text-2xl", xl: "text-4xl" };

/**
 * The avatar of a user: the picture, or the initials on a brand colour when there is no real picture (or it fails)
 *
 * @param {Object} props
 * @param {string} [props.url]
 * @param {string} [props.name]
 * @param {string} [props.email]  the initials when there is no name
 */
export function GravatarFormatter({ url, name, email, size, decorative }) {
	const letters = initials(name, email);
	const color = avatarColor(name, email);
	return (
		<div className="flex items-center py-1">
			<Avatar
				{...(name && !decorative
					? { role: "img", "aria-label": name, title: name }
					: { "aria-hidden": "true", ...(name ? { title: name } : {}) })}
				className={cn("mr-2 rounded-md after:rounded-md", sizes[size] || "size-10")}
			>
				{hasNoPicture(url) ? null : <AvatarImage src={url} alt="" className="rounded-md" />}
				{letters ? (
					<AvatarFallback
						className={cn("rounded-md font-medium", color.className, initialsSizes[size] || "text-sm")}
					>
						<span aria-hidden="true">{letters}</span>
					</AvatarFallback>
				) : (
					<AvatarFallback className="rounded-md bg-cover">
						<img src={defaultAvatar} alt="" className="size-full rounded-md object-cover" />
					</AvatarFallback>
				)}
			</Avatar>
		</div>
	);
}
