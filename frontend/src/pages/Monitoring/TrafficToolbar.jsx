import { AppSelect } from "src/components/AppSelect";
import { ToggleGroup, ToggleGroupItem } from "src/components/ui/toggle-group";
import { useDeadHosts, useProxyHosts, useRedirectionHosts } from "src/hooks";
import { intl, T } from "src/locale";
import { hostFilterFromSelect, hostGroups, hostSelectValue, OTHER_HOST, rangeOptions } from "src/modules/Monitoring";

export const extraText = (count) => (count > 0 ? intl.formatMessage({ id: "monitoring.host.extra" }, { count }) : "");

const optionText = (option) => [option.label, extraText(option.extra)].filter(Boolean).join(" ");

/**
 * Label of a filter that is not in the host lists (a host from the URL that is gone, or an old host key), so the
 * select still shows what is filtered.
 */
const unknownFilterLabel = (filter) =>
	filter.host ?? intl.formatMessage({ id: "monitoring.host.unknown" }, { id: filter.hostId });

export function Toolbar({ range, filter, onRange, onFilter }) {
	const { data: proxy } = useProxyHosts();
	const { data: redirection } = useRedirectionHosts();
	const { data: dead } = useDeadHosts();
	const groups = hostGroups({ proxy, redirection, dead });
	const value = hostSelectValue(filter);
	const known = value === "" || value === OTHER_HOST || groups.some((g) => g.options.some((o) => o.value === value));

	const options = [
		{ value: "", label: intl.formatMessage({ id: "monitoring.host.all" }) },
		{ value: OTHER_HOST, label: intl.formatMessage({ id: "monitoring.host.other" }) },
		...(known ? [] : [{ value, label: unknownFilterLabel(filter) }]),
		...groups
			.filter((group) => group.options.length > 0)
			.map((group) => ({
				key: group.type,
				label: intl.formatMessage({ id: group.labelKey }),
				options: group.options.map((option) => ({ value: option.value, label: optionText(option) })),
			})),
	];

	return (
		<div className="flex flex-wrap items-center gap-2">
			<ToggleGroup
				type="single"
				variant="outline"
				spacing={0}
				value={range}
				// an empty value is the chosen item pressed again: one range is always chosen
				onValueChange={(next) => next && onRange(next)}
				aria-label={intl.formatMessage({ id: "monitoring.range" })}
			>
				{rangeOptions.map((option) => (
					<ToggleGroupItem key={option.value} value={option.value}>
						<T id={option.labelKey} />
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<AppSelect
				className="w-auto max-w-full"
				aria-label={intl.formatMessage({ id: "monitoring.host" })}
				value={value}
				onValueChange={(next) => onFilter(hostFilterFromSelect(next))}
				options={options}
			/>
		</div>
	);
}
