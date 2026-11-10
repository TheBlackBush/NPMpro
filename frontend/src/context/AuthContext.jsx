import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { deleteToken, getToken, refreshToken, revokeSessions, verifyTotp } from "src/api/backend";
import AuthStore from "src/modules/AuthStore";
import { deleteCookie, getCookie } from "src/modules/Cookies";
import { clearOidcError } from "src/modules/Oidc";

const AuthContext = createContext(null);

function AuthProvider({ children, tokenRefreshInterval = 5 * 60 * 1000 }) {
	const queryClient = useQueryClient();
	const [authenticated, setAuthenticated] = useState(AuthStore.hasActiveToken());
	const [totpChallenge, setTotpChallenge] = useState(() => getCookie("__Host-npmpro_oidc_totp_required") === "true");

	const handleTokenUpdate = (response) => {
		clearOidcError();
		AuthStore.set(response);
		setAuthenticated(true);
		setTotpChallenge(false);
	};

	const login = async (identity, secret) => {
		const response = await getToken(identity, secret);
		if (response.requiresTotp) {
			setTotpChallenge(true);
			return;
		}
		handleTokenUpdate(response);
	};

	const submitTotp = async (data) => {
		if (!totpChallenge) {
			throw new Error("No TOTP challenge pending");
		}
		const response = await verifyTotp(data);
		handleTokenUpdate(response);
	};

	const cancelTotp = () => {
		setTotpChallenge(false);
	};

	const logout = async () => {
		await deleteToken();
		clearOidcError();
		AuthStore.clear();
		setAuthenticated(false);
		queryClient.clear();
	};

	const logoutEverywhere = async () => {
		await revokeSessions("me");
		clearOidcError();
		AuthStore.clear();
		setAuthenticated(false);
		queryClient.clear();
	};

	const refresh = async (reload = true) => {
		try {
			const response = await refreshToken(reload);
			handleTokenUpdate(response);
		} catch {
			// do nothing
		}
	};

	useEffect(() => {
		if (!authenticated) {
			if (totpChallenge) {
				deleteCookie("__Host-npmpro_oidc_totp_required");
				return;
			}
			void refresh(false);
		}
	});

	// refreshes the token every tokenRefreshInterval while signed in; the latest render's state is read through a ref
	const refreshTick = useRef(null);
	useEffect(() => {
		refreshTick.current = () => {
			if (authenticated) {
				void refresh();
			}
		};
	});
	useEffect(() => {
		const timer = window.setInterval(() => refreshTick.current?.(), tokenRefreshInterval);
		return () => window.clearInterval(timer);
	}, [tokenRefreshInterval]);

	const value = {
		authenticated,
		totpChallenge,
		login,
		submitTotp,
		cancelTotp,
		logout,
		logoutEverywhere,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthState() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuthState must be used within a AuthProvider");
	}
	return context;
}

export { AuthProvider, useAuthState };
