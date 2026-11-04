import { Button } from "src/components/Button";
import { Card, CardContent } from "src/components/ui/card";
import { T } from "src/locale";
import { AuthLayout } from "src/shell/AuthLayout";

export function Unhealthy() {
	return (
		<AuthLayout>
			<Card>
				<CardContent className="flex flex-col items-center gap-3 text-center">
					<img src="/images/unhealthy.svg" alt="" className="size-32" />
					<h1 className="m-0 font-semibold text-xl">
						<T id="unhealthy.title" />
					</h1>
					<p className="m-0 text-muted-foreground text-sm">
						<T id="unhealthy.content" />
					</p>
					<Button
						type="button"
						color="primary"
						size="lg"
						className="mt-2"
						onClick={() => window.location.reload()}
					>
						<T id="unhealthy.reload" />
					</Button>
				</CardContent>
			</Card>
		</AuthLayout>
	);
}
