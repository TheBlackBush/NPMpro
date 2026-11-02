import { QueryClientProvider } from "@tanstack/react-query";
import { RawIntlProvider } from "react-intl";
import { queryClient } from "src/api/backend/base";
import { Toaster } from "src/components/ui/sonner";
import { TooltipProvider } from "src/components/ui/tooltip";
import { AuthProvider, PreferencesProvider, ThemeProvider } from "src/context";
import { intl } from "src/locale";
import EasyModal from "src/modules/easyModal";
import Router from "src/Router.jsx";

function App() {
	return (
		<RawIntlProvider value={intl}>
			<ThemeProvider>
				<QueryClientProvider client={queryClient}>
					<PreferencesProvider>
						<AuthProvider>
							{/* One provider for every Radix Tooltip: pages, both shell layouts and the windows */}
							<TooltipProvider>
								<EasyModal.Provider>
									<Router />
								</EasyModal.Provider>
							</TooltipProvider>
							<Toaster position="top-right" richColors closeButton />
						</AuthProvider>
					</PreferencesProvider>
				</QueryClientProvider>
			</ThemeProvider>
		</RawIntlProvider>
	);
}

export default App;
