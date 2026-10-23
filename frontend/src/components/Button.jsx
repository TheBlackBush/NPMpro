import { buttonClassName } from "src/modules/ButtonClasses";

function Button({ children, className, onClick, type, color, outline, size, fullWidth, isLoading, disabled, ...rest }) {
	return (
		<button
			{...rest}
			type={type || "button"}
			className={buttonClassName({ color, outline, size, fullWidth, isLoading, className })}
			onClick={(e) => !isLoading && onClick?.(e)}
			disabled={disabled}
			aria-busy={isLoading || undefined}
		>
			{children}
		</button>
	);
}

export { Button };
