import { TrueFalseFormatter } from "src/components";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { T } from "src/locale";

const getSection = (title, items) => {
	if (items.length === 0) {
		return null;
	}
	return (
		<>
			<div>
				<strong>
					<T id={title} />
				</strong>
			</div>
			{items.map((host) => (
				<div key={host.id} className="ml-1">
					{host.domainNames.join(", ")}
				</div>
			))}
		</>
	);
};

const getSectionStream = (items) => {
	if (items.length === 0) {
		return null;
	}
	return (
		<>
			<div>
				<strong>
					<T id="streams" />
				</strong>
			</div>
			{items.map((stream) => (
				<div key={stream.id} className="ml-1">
					{`${stream.forwardingHost}${stream.forwardingPort ? `:${stream.forwardingPort}` : ""}`}
				</div>
			))}
		</>
	);
};

export function CertificateInUseFormatter({ proxyHosts, redirectionHosts, deadHosts, streams }) {
	const totalCount = proxyHosts.length + redirectionHosts.length + deadHosts.length + streams.length;
	if (totalCount === 0) {
		return <TrueFalseFormatter value={false} falseLabel="certificate.not-in-use" falseColor="secondary" />;
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-block rounded-4xl p-0 text-left align-baseline focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<TrueFalseFormatter value trueLabel="certificate.in-use" />
				</button>
			</PopoverTrigger>
			<PopoverContent side="bottom" className="w-auto max-w-sm gap-0">
				{getSection("proxy-hosts", proxyHosts)}
				{getSection("redirection-hosts", redirectionHosts)}
				{getSection("dead-hosts", deadHosts)}
				{getSectionStream(streams)}
			</PopoverContent>
		</Popover>
	);
}
