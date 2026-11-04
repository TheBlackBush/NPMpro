import { useCheckVersion } from "src/hooks";
import { intl, T } from "src/locale";
import { Credits } from "./Credits";

const repoUrl = "https://github.com/TheBlackBush/NPMpro";
// release builds are "<MAJOR.MINOR.PATCH>-<commit>", beta and develop builds end with "-<commit>"
const releaseBuildPattern = /^(?<release>\d+\.\d+\.\d+)-[0-9a-f]+$/u;
const commitPattern = /-(?<commit>[0-9a-f]+)$/u;
const LINK = "underline-offset-4 hover:text-foreground hover:underline";

// lucide-react dropped brand icons, so the GitHub mark is drawn here (24x24 path from Simple Icons, CC0)
function GithubMark({ className }) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	);
}

function ExternalA({ href, className = LINK, children, ...props }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" className={className} {...props}>
			{children}
		</a>
	);
}

/** Credits, copyright, version (with the update notice) and the repository link */
export function AppFooter() {
	const { data: versionData } = useCheckVersion();

	const version = versionData?.current || "";
	const release = releaseBuildPattern.exec(version)?.groups.release;
	const commit = commitPattern.exec(version)?.groups.commit;
	const versionUrl = release ? `${repoUrl}/releases/tag/v${release}` : commit ? `${repoUrl}/tree/${commit}` : repoUrl;

	return (
		<footer className="border-t print:hidden">
			<div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-3 py-4 text-xs text-muted-foreground sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
				<Credits className="flex-col gap-1 lg:flex-row lg:items-center lg:gap-x-4" />
				<div className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4">
					<span>&copy; {new Date().getFullYear()} AGPL-3.0 (and MIT)</span>
					{version ? <ExternalA href={versionUrl}>{version}</ExternalA> : null}
					{versionData?.updateAvailable ? (
						<ExternalA
							href={`${repoUrl}/releases/tag/${versionData.latest}`}
							className="font-medium text-primary underline-offset-4 hover:underline"
							title={intl.formatMessage(
								{ id: "update-available" },
								{ latestVersion: versionData.latest },
							)}
						>
							<T id="update-available" data={{ latestVersion: versionData.latest }} />
						</ExternalA>
					) : null}
					<ExternalA href={repoUrl} className={`inline-flex items-center gap-1.5 ${LINK}`}>
						<GithubMark className="size-3.5" aria-hidden="true" />
						<T id="footer.github" />
					</ExternalA>
				</div>
			</div>
		</footer>
	);
}
