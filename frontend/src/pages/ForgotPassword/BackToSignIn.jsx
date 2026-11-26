import { T } from "src/locale";

// the pages of the reset need no session: a plain link (a full load) works whether or not someone is signed in
export function BackToSignIn() {
	return (
		<a href="/" className="text-center text-sm underline underline-offset-4">
			<T id="forgot-password.back" />
		</a>
	);
}
