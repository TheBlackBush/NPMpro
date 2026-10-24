import { currentLocale, intl } from "src/locale";
import { formatCount, shareBar } from "src/modules/Monitoring";

const percentFormat = new Intl.NumberFormat(currentLocale, { style: "percent", maximumFractionDigits: 1 });

/**
 * Ranked top list card: rank, name, count and a share bar per row
 * (https://docs.tabler.io/ui/components/list-group.md, https://docs.tabler.io/ui/components/progress.md).
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.title
 * @param {{ key: string, label: import("react").ReactNode, title?: string, value: number }[]} props.items
 *        rows in display order; `title` is the plain text for the native tooltip of a truncated name
 * @param {number} [props.total]        the 100 % for the share bar and percentage, default the sum of the values
 * @param {(n: number) => string} [props.formatValue]  count text, default formatCount
 * @param {string} [props.color]        Tabler colour name of the share bar, default "primary" (CrowdSec uses "red")
 * @param {import("react").ReactNode} [props.empty]   text when there are no rows
 * @param {string} [props.className]    classes for the column wrapper
 */
function TopList({
	title,
	items,
	total,
	formatValue = formatCount,
	color = "primary",
	empty,
	className = "col-md-6 col-xl-4",
}) {
	const sum = total ?? items.reduce((acc, item) => acc + (Number(item.value) || 0), 0);
	return (
		<div className={className}>
			<div className="card">
				<div className="card-header">
					<h3 className="card-title">{title}</h3>
				</div>
				{items.length ? (
					<div className="list-group list-group-flush">
						{items.map((item, idx) => {
							const width = shareBar(item.value, sum);
							const share = percentFormat.format(width / 100);
							return (
								<div key={item.key} className="list-group-item">
									<div className="row g-2 align-items-center">
										<div className="col-auto">
											{/* fixed width so ranks 1 to 20 line up; no utility gives a 2em width */}
											<span className="badge bg-secondary-lt" style={{ minWidth: "2em" }}>
												{idx + 1}
											</span>
										</div>
										<div className="col text-truncate">
											<div className="d-flex align-items-center gap-2">
												<div className="text-truncate" title={item.title}>
													{item.label}
												</div>
												<div className="ms-auto text-nowrap">
													<span className="fw-medium">{formatValue(item.value)}</span>
													<span className="text-secondary small ms-2">{share}</span>
												</div>
											</div>
											<div
												className="progress progress-sm mt-1"
												role="progressbar"
												aria-valuenow={Math.round(width)}
												aria-valuemin={0}
												aria-valuemax={100}
												aria-label={intl.formatMessage(
													{ id: "monitoring.share" },
													{ share, name: item.title ?? item.key },
												)}
											>
												{/* width is the data value: Tabler sets progress bar widths inline, no utility covers any percentage */}
												<div
													className={`progress-bar bg-${color}`}
													style={{ width: `${width}%` }}
												/>
											</div>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<div className="card-body text-secondary">{empty}</div>
				)}
			</div>
		</div>
	);
}

export { TopList };
