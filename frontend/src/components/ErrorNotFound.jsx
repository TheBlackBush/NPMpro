import { useNavigate } from "react-router";
import { Button } from "src/components";
import { T } from "src/locale";

export function ErrorNotFound() {
	const navigate = useNavigate();
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="m-0 font-semibold text-6xl text-muted-foreground tabular-nums">404</p>
			<p className="m-0 font-semibold text-lg">
				<T id="notfound.title" />
			</p>
			<p className="m-0 max-w-md text-muted-foreground text-sm">
				<T id="notfound.content" />
			</p>
			<Button type="button" color="primary" className="mt-2" onClick={() => navigate("/")}>
				<T id="notfound.action" />
			</Button>
		</div>
	);
}
