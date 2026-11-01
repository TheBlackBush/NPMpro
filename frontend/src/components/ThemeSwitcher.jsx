import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import cn from "clsx";
import { useThemeState } from "src/context";
import { intl } from "src/locale";

// the choices in the menu's order: the stored value, its name and its icon
const CHOICES = [
	{ value: "light", labelId: "theme.light", Icon: IconSun },
	{ value: "dark", labelId: "theme.dark", Icon: IconMoon },
	{ value: "auto", labelId: "theme.system", Icon: IconDeviceDesktop },
];

/**
 * The theme menu: Light, Dark or System (follows the operating system). The button shows the chosen one's icon; the
 * menu opens to the left, as the switch sits at the right edge of the header, the login and the setup page.
 *
 * @param {Object} props
 * @param {string} [props.className]
 */
function ThemeSwitcher({ className }) {
	const { preference, setPreference } = useThemeState();
	const current = CHOICES.find((choice) => choice.value === preference) ?? CHOICES[2];
	const label = intl.formatMessage({ id: "theme.label" }, { theme: intl.formatMessage({ id: current.labelId }) });

	return (
		<div className={cn("dropdown d-print-none d-inline-block", className)}>
			<button
				type="button"
				className="btn dropdown-toggle btn-sm btn-ghost"
				data-bs-toggle="dropdown"
				title={label}
				aria-label={label}
			>
				<current.Icon className="icon" aria-hidden="true" />
			</button>
			<div className="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
				{CHOICES.map(({ value, labelId, Icon }) => (
					<button
						type="button"
						key={value}
						className={cn("dropdown-item", { active: value === preference })}
						aria-current={value === preference ? "true" : undefined}
						onClick={() => setPreference(value)}
					>
						<Icon className="icon dropdown-item-icon" aria-hidden="true" />
						{intl.formatMessage({ id: labelId })}
					</button>
				))}
			</div>
		</div>
	);
}

export { ThemeSwitcher };
