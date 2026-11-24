import { NoticeAlert } from "src/components/NoticeAlert";
import { useAcmeServers, useCaaCheck, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { acmeServerLabel } from "src/modules/AcmeAccount";
import { defaultCa } from "src/modules/AcmeServers";
import { caaLines, caaRequest, worstCaa } from "src/modules/Caa";
import { CERTIFICATES, hasPermission, VIEW } from "src/modules/Permissions";

// the CA's name as the select shows it: a preset's name or the host of its directory
const caText = (server) => {
	if (!server) return "";
	const { labelId, text } = acmeServerLabel(server);
	return labelId ? intl.formatMessage({ id: labelId }) : text;
};

/**
 * What the CAA records of the window's names say about the CA that would issue them, 800 ms after the names or the CA
 * last changed: refused (red, with the record and where it was found), limited and unknown (amber), a CA that names no
 * CAA identity (blue); nothing for allowed names. It reads only and never blocks the request. The live region stays
 * mounted, so a note that appears is announced.
 *
 * @param {Object}   props
 * @param {string[]} props.names          the form's domain names
 * @param {string}   [props.server]       the chosen CA (empty: the instance CA)
 * @param {boolean}  [props.dnsChallenge] the certificate uses the DNS challenge
 * @param {boolean}  [props.needsServer]  no check until a CA is chosen (a re-issue)
 * @param {string}   [props.className]    of the note
 */
export function CaaNote({ names, server, dnsChallenge, needsServer, className }) {
	const { data: servers } = useAcmeServers();
	const { data: user } = useUser("me");
	// the check needs certificates:view: without it no request is sent
	const mayCheck = hasPermission(CERTIFICATES, VIEW, user?.permissions, user?.roles);
	const request = mayCheck ? caaRequest({ names, server, dnsChallenge, needsServer }) : null;
	const checked = useCaaCheck(request);
	const worst = worstCaa(checked?.names);
	const ca = caText(server || defaultCa(servers));
	const { lines, more } = worst ? caaLines(worst.results) : { lines: [], more: 0 };
	// the names are named when the check holds more than one
	const named = (request?.domainNames.length ?? 0) > 1;
	return (
		<div role="status" aria-live="polite">
			{worst ? (
				<NoticeAlert variant={worst.tone} role="none" className={className} data-caa={worst.state}>
					<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
						{lines.map(({ name, line }) => (
							<li key={name} className="wrap-anywhere">
								{named && line.state !== "no-identity" ? (
									<>
										<span className="font-mono">{name}</span>:{" "}
									</>
								) : null}
								<T id={line.messageId} data={{ ...line.values, ca }} />
								{line.reasonId ? (
									<span className="block text-muted-foreground">
										<T id={line.reasonId} />
									</span>
								) : null}
							</li>
						))}
						{more > 0 ? (
							<li>
								<T id="certificates.caa.more" data={{ count: more }} />
							</li>
						) : null}
					</ul>
				</NoticeAlert>
			) : null}
		</div>
	);
}
