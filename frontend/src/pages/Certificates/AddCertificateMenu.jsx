import { ChevronDown, Cloud, Globe, Plus, ShieldCheck, Upload } from "lucide-react";
import { useRef } from "react";
import { HasPermission } from "src/components";
import { Button } from "src/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { T } from "src/locale";
import { showCustomCertificateModal, showDNSCertificateModal, showHTTPCertificateModal } from "src/modals";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";

/**
 * The "Add Certificate" menu: Let's Encrypt via HTTP or DNS, an uploaded certificate, an mTLS client CA.
 *
 * @param {Object} props
 * @param {"sm"|"default"} [props.size]  button size
 */
export function AddCertificateMenu({ size = "default" }) {
	// The windows are not Radix: they open once the menu has closed and returned focus to its button (as UserMenu), so
	// the menu's pointer lock is gone and each window returns focus to this button
	const pendingWindow = useRef(null);
	const choose = (show) => () => {
		pendingWindow.current = show;
	};
	return (
		<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button type="button" color="primary" size={size}>
						<Plus data-icon="inline-start" aria-hidden="true" />
						<T id="object.add" tData={{ object: "certificate" }} />
						<ChevronDown data-icon="inline-end" aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-56"
					collisionPadding={8}
					onCloseAutoFocus={() => {
						const show = pendingWindow.current;
						pendingWindow.current = null;
						if (show) setTimeout(show, 0);
					}}
				>
					<DropdownMenuItem onSelect={choose(() => showHTTPCertificateModal())}>
						<Globe aria-hidden="true" />
						<T id="lets-encrypt-via-http" />
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={choose(() => showDNSCertificateModal())}>
						<Cloud aria-hidden="true" />
						<T id="lets-encrypt-via-dns" />
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={choose(() => showCustomCertificateModal())}>
						<Upload aria-hidden="true" />
						<T id="certificates.custom" />
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={choose(() => showCustomCertificateModal(undefined, "mtls"))}>
						<ShieldCheck aria-hidden="true" />
						<T id="certificates.mtls" />
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</HasPermission>
	);
}
