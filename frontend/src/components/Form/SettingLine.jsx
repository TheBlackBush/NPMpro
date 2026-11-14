import { cn } from "src/lib/utils";
import { settingLineClass } from "src/modules/SettingLayout";
import { FieldMessage } from "./FieldMessage";

/**
 * One line of a Settings card: the name (with badges beside it) and a hint on the left, the control on the right
 * (inline), the field under the name (block), a switch on the right at every width (switch), or a read-only value
 * (value). Under the lg container width an inline or value line stacks: the text, then the control at full width.
 * The error shows under the control (under the hint for a switch). children go under the line (an editor).
 *
 * @param {Object}   props
 * @param {string}   props.id
 * @param {*}        props.title
 * @param {string}   [props.titleId]     `${id}-label` by default
 * @param {string}   [props.labelFor]    the control's id: the title becomes its <label>
 * @param {Function} [props.onTitleClick]
 * @param {*}        [props.hint]
 * @param {string}   [props.hintId]      `${id}-hint` by default
 * @param {*}        [props.badges]      beside the title, wrapping with it
 * @param {*}        [props.control]
 * @param {string}   [props.controlClassName]  more classes of the control box (a wider control: "@lg:w-auto")
 * @param {*}        [props.aside]       beside the control (a Preview icon, a button)
 * @param {*}        [props.error]
 * @param {string}   [props.errorId]     `${id}-error` by default
 * @param {"inline"|"block"|"switch"|"value"} [props.layout]
 * @param {string}   [props.className]
 * @param {*}        [props.children]    under the line
 */
function SettingLine({
	id,
	title,
	titleId = `${id}-label`,
	labelFor,
	onTitleClick,
	hint,
	hintId = `${id}-hint`,
	badges,
	control,
	controlClassName,
	aside,
	error,
	errorId = `${id}-error`,
	layout = "inline",
	className,
	children,
	...rest
}) {
	const line = settingLineClass(layout);
	const Title = labelFor ? "label" : "p";
	const errorNode = error ? (
		<FieldMessage id={errorId} className="mt-1">
			{error}
		</FieldMessage>
	) : null;
	return (
		<div {...rest} className={cn(line.container, className)} data-setting-line={layout}>
			<div className={line.row}>
				<div className={line.text}>
					<div className={line.titleRow}>
						<Title
							id={titleId}
							className={line.title}
							{...(labelFor ? { htmlFor: labelFor } : {})}
							onClick={onTitleClick}
						>
							{title}
						</Title>
						{badges}
					</div>
					{hint ? (
						<p id={hintId} className={line.hint}>
							{hint}
						</p>
					) : null}
					{layout === "switch" ? errorNode : null}
				</div>
				{control ? (
					<div className={line.wrap}>
						<div className={cn(line.control, controlClassName)}>
							{control}
							{layout === "switch" ? null : errorNode}
						</div>
						{aside ?? null}
					</div>
				) : null}
			</div>
			{children}
		</div>
	);
}

/** The bordered card of setting lines in a window, a hairline between them (in Settings, SettingsCard lines). */
function SettingLines({ className, children }) {
	return <div className={cn("divide-y overflow-hidden rounded-lg border bg-card", className)}>{children}</div>;
}

/** A padded row of a lines body that is not a setting: a note, an alert, a link, the result of an action. */
function SettingLineNote({ className, children, ...props }) {
	return (
		<div {...props} className={cn("px-4 py-3", className)}>
			{children}
		</div>
	);
}

export { SettingLine, SettingLineNote, SettingLines };
