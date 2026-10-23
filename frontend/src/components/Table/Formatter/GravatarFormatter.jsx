import cn from "clsx";

const defaultImg = "/images/default-avatar.jpg";

export function GravatarFormatter({ url, name, size, decorative }) {
	return (
		<div className="d-flex py-1 align-items-center">
			<span
				{...(name && !decorative
					? { role: "img", "aria-label": name, title: name }
					: { "aria-hidden": "true", ...(name ? { title: name } : {}) })}
				className={cn("avatar avatar-square me-2", size && `avatar-${size}`)}
				style={{
					backgroundImage: `url(${url || defaultImg})`,
				}}
			/>
		</div>
	);
}
