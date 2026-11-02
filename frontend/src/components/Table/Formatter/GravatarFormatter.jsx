import { Avatar, AvatarFallback, AvatarImage } from "src/components/ui/avatar";
import { cn } from "src/lib/utils";

const defaultImg = "/images/default-avatar.jpg";

// the size names of the old avatar (xs to xl) as square edges; no size is the 40 px default
const sizes = { xs: "size-6", sm: "size-8", md: "size-10", lg: "size-12", xl: "size-16" };

export function GravatarFormatter({ url, name, size, decorative }) {
	return (
		<div className="flex items-center py-1">
			<Avatar
				{...(name && !decorative
					? { role: "img", "aria-label": name, title: name }
					: { "aria-hidden": "true", ...(name ? { title: name } : {}) })}
				className={cn("mr-2 rounded-md after:rounded-md", sizes[size] || "size-10")}
			>
				<AvatarImage src={url || defaultImg} alt="" className="rounded-md" />
				<AvatarFallback className="rounded-md bg-cover">
					<img src={defaultImg} alt="" className="size-full rounded-md object-cover" />
				</AvatarFallback>
			</Avatar>
		</div>
	);
}
