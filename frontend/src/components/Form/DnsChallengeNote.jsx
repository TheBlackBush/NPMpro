import { Button } from "src/components/Button";
import { intl, T } from "src/locale";
import { displayDomain } from "src/modules/DnsDomainForms";
import { NoticeAlert } from "../NoticeAlert";

const list = (items) => intl.formatList(items, { type: "conjunction" });
// domain names are shown as people write them; credential names are shown as they are
const domains = (names) => list(names.map(displayDomain));

function noteText(note) {
	switch (note.kind) {
		case "suggested":
			return intl.formatMessage(
				{ id: "certificates.dns.suggested" },
				{ credential: note.credentialName, zones: domains(note.zones), count: note.count },
			);
		case "not-covered":
			return intl.formatMessage(
				{ id: "certificates.dns.not-covered" },
				{ credential: note.credentialName, names: domains(note.names) },
			);
		case "conflict":
			return intl.formatMessage(
				{ id: "certificates.dns.conflict" },
				{
					names: domains(note.names),
					count: note.names.length,
					credentials: list(
						note.credentials.map((credential) =>
							credential.ownerName
								? intl.formatMessage(
										{ id: "certificates.dns.conflict-credential" },
										{ credential: credential.name, owner: credential.ownerName },
									)
								: credential.name,
						),
					),
				},
			);
		case "spread":
			return intl.formatMessage(
				{ id: "certificates.dns.spread" },
				{
					groups: list(
						note.groups.map((group) =>
							intl.formatMessage(
								{ id: "certificates.dns.spread-group" },
								{ names: domains(group.names), credential: group.credentialName },
							),
						),
					),
				},
			);
		default:
			return intl.formatMessage({ id: "certificates.dns.partial" }, { names: domains(note.names) });
	}
}

/**
 * What the DNS challenge box says about its credential for the window's names (challengeSuggestion): why a
 * credential was preselected, that the chosen one has no domain for a name, or that no single credential fits.
 *
 * @param {Object}   props
 * @param {Object}   props.note           { kind, ... } of challengeSuggestion
 * @param {Function} [props.onUseAnother]  the button of a preselection: the user wants another credential
 * @param {string}   [props.className]
 */
export function DnsChallengeNote({ note, onUseAnother, className }) {
	return (
		<NoticeAlert variant={note.kind === "not-covered" ? "warning" : "info"} className={className}>
			<div data-dns-suggestion={note.kind} className="flex flex-wrap items-center justify-between gap-2">
				<span>{noteText(note)}</span>
				{note.kind === "suggested" && onUseAnother ? (
					<Button size="sm" onClick={onUseAnother}>
						<T id="certificates.dns.use-another" />
					</Button>
				) : null}
			</div>
		</NoticeAlert>
	);
}
