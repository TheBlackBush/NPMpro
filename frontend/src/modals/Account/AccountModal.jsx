import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, CircleUser, KeyRound, Lock, LogIn, ShieldCheck, User, Users } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getMfaStatus } from "src/api/backend";
import { AppModal, Button, Loading } from "src/components";
import { StatusBadge } from "src/components/StatusBadge";
import { UserAvatar } from "src/components/UserAvatar";
import { Button as UiButton } from "src/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "src/components/ui/tabs";
import { useUser } from "src/hooks";
import { useIsMobile } from "src/hooks/use-mobile";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { askDiscard } from "src/modals/DiscardChangesModal";
import {
	frameState,
	partOf,
	partsFor,
	reportPart,
	startsOnHeading,
	USER_PARTS,
	visitPart,
} from "src/modules/AccountWindow";
import EasyModal from "src/modules/easyModal";
import { AccountContext } from "./AccountPart";
import { ApiTokensPart } from "./ApiTokensPart";
import { PasswordPart } from "./PasswordPart";
import { ProfilePart } from "./ProfilePart";
import { SignInPart } from "./SignInPart";

const ICONS = { profile: User, password: Lock, mfa: ShieldCheck, "api-tokens": KeyRound, "sign-in": LogIn };
// the MFA part and the QR code library are a chunk of their own, loaded on the part's first visit
const MfaPart = lazy(() => import("./MfaPart"));
function MfaView() {
	return (
		<Suspense fallback={<Loading noLogo />}>
			<MfaPart />
		</Suspense>
	);
}
const SELF_VIEWS = { profile: ProfilePart, password: PasswordPart, mfa: MfaView, "api-tokens": ApiTokensPart };
const USER_VIEWS = { profile: ProfilePart, "sign-in": SignInPart };

/** Opens the Account window on a part ("profile", "password", "mfa" or "api-tokens") */
const showAccountModal = (part) => {
	EasyModal.show(AccountModal, { part: partOf(part) });
};

/** Opens another user's window (an administrator, Settings, Users): Profile with the switches, and Sign-in */
const showUserAccountModal = (id, part) => {
	EasyModal.show(AccountModal, { userId: id, part: partOf(part, USER_PARTS) });
};

// the signed-in user's picture, name and email, above the side list and the phone list: plain text, never focusable
function Identity({ user }) {
	return (
		<div className="flex min-w-0 items-center gap-2.5 px-1">
			<UserAvatar user={user} className="size-9" />
			<div className="min-w-0 leading-tight">
				<p className="m-0 truncate font-medium text-sm">{user?.name}</p>
				<p className="m-0 truncate text-muted-foreground text-xs" title={user?.email}>
					{user?.email}
				</p>
			</div>
		</div>
	);
}

// the dot of a part with unsaved changes, with its words for screen readers
function UnsavedDot() {
	return (
		<>
			<span className="ms-auto size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
			<span className="sr-only">
				<T id="account.unsaved" />
			</span>
		</>
	);
}

// the MFA row's state, read when the list shows (the part may have changed it); nothing until it is known
function MfaRowBadge() {
	const { data } = useQuery({ queryKey: ["mfa-status", "me"], queryFn: () => getMfaStatus("me"), gcTime: 0 });
	if (!data) return null;
	return (
		<StatusBadge tone={data.totpEnabled ? "success" : "muted"} className="shrink-0">
			{data.totpEnabled ? <T id="totp.enabled" /> : <T id="totp.disabled" />}
		</StatusBadge>
	);
}

// the phone's first screen: the identity and one row per part, each with its dot; Close in the footer
function PhoneList({ user, parts, frame, onChoose, firstRef, close }) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
				<Identity user={user} />
				<ul className="m-0 mt-4 list-none divide-y rounded-lg border p-0">
					{parts.map((part, index) => {
						const Icon = ICONS[part.id];
						return (
							<li key={part.id}>
								<button
									type="button"
									ref={index === 0 ? firstRef : undefined}
									className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
									onClick={() => onChoose(part.id)}
									data-account-row={part.id}
								>
									<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
									<span className="min-w-0 flex-1 truncate">
										<T id={part.labelId} />
									</span>
									{part.id === "mfa" ? <MfaRowBadge /> : null}
									{frame.dirtyParts.includes(part.id) ? <UnsavedDot /> : null}
									<ChevronRight
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
			<AppModal.Footer>
				<Button onClick={close}>
					<T id="action.close" />
				</Button>
			</AppModal.Footer>
		</div>
	);
}

const AccountModal = EasyModal.create(({ part: opened, userId = "me", visible, remove }) => {
	const isPhone = useIsMobile();
	const self = userId === "me";
	const parts = partsFor(self);
	const views = self ? SELF_VIEWS : USER_VIEWS;
	const { data: user } = useUser(userId);
	const [part, setPart] = useState(opened);
	const [visited, setVisited] = useState([opened]);
	// a phone shows the opened part first; the back arrow shows the list
	const [listOpen, setListOpen] = useState(false);
	const [states, setStates] = useState({});
	const report = useCallback((id, next) => setStates((current) => reportPart(current, id, next)), []);
	const frame = frameState(states, parts);
	// decided once, when the window opens (as AppModal decides its start)
	const [startHeading] = useState(() => (startsOnHeading({ part: opened, isPhone, parts }) ? opened : null));
	const firstRow = useRef(null);
	const moved = useRef(false);

	const close = async () => {
		if (!frame.closable) return;
		if (frame.dirtyParts.length > 0 && !(await askDiscard("unsaved-changes.confirm"))) return;
		remove();
	};
	const choose = (next) => {
		moved.current = true;
		setVisited((current) => visitPart(current, next));
		setPart(next);
		setListOpen(false);
	};
	const showList = () => {
		moved.current = true;
		setListOpen(true);
	};
	// a phone screen that replaced another takes the focus: the first row of the list, or the chosen part's heading
	useEffect(() => {
		if (!(isPhone && moved.current)) return;
		const target = listOpen ? firstRow.current : document.querySelector(`[data-account-part="${part}"] h3`);
		target?.focus({ preventScroll: true });
	}, [isPhone, listOpen, part]);

	const context = { report, close, frame, startHeading, parts };
	const phoneList = isPhone && listOpen;

	return (
		<AccountContext.Provider value={context}>
			<AppModal
				size="lg"
				show={visible}
				onHide={frame.closable ? close : undefined}
				backdrop="static"
				keyboard={frame.closable}
			>
				<AppModal.Header closeButton={frame.closable}>
					<div className="flex min-w-0 items-center gap-1">
						{isPhone && !listOpen && !frame.locked ? (
							<UiButton
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={intl.formatMessage({ id: "account.back" })}
								onClick={showList}
								data-account-back=""
							>
								<ArrowLeft aria-hidden="true" />
							</UiButton>
						) : null}
						<AppModal.Title className="flex items-center gap-2">
							{self ? (
								<>
									<CircleUser className="size-5 shrink-0" aria-hidden="true" />
									<T id="account.title" />
								</>
							) : (
								<>
									<Users className="size-5 shrink-0" aria-hidden="true" />
									<T id="object.edit" tData={{ object: "user" }} />
								</>
							)}
						</AppModal.Title>
					</div>
				</AppModal.Header>
				<AppModal.Body className="flex overflow-hidden p-0 md:min-h-[min(36rem,calc(100dvh-10rem))]">
					<Tabs
						orientation="vertical"
						value={part}
						onValueChange={choose}
						className="min-h-0 min-w-0 flex-1 gap-0"
					>
						<aside
							className={cn(
								"w-[204px] shrink-0 flex-col gap-3 border-e bg-muted/30 p-3",
								isPhone ? "hidden" : "flex",
							)}
						>
							<Identity user={user} />
							<TabsList
								variant="line"
								aria-label={intl.formatMessage({ id: "account.parts" })}
								className="w-full gap-0.5 p-0"
							>
								{parts.map((entry) => {
									const Icon = ICONS[entry.id];
									const dirty = frame.dirtyParts.includes(entry.id);
									return (
										<TabsTrigger
											key={entry.id}
											value={entry.id}
											disabled={frame.locked && entry.id !== part}
											data-account-tab={entry.id}
											{...(dirty ? { "data-dirty": "" } : {})}
											className="h-9 w-full flex-none justify-start rounded-md px-2.5 data-[state=active]:bg-background"
										>
											<Icon aria-hidden="true" />
											<span className="min-w-0 truncate">
												<T id={entry.labelId} />
											</span>
											{dirty ? <UnsavedDot /> : null}
										</TabsTrigger>
									);
								})}
							</TabsList>
						</aside>
						{phoneList ? (
							<PhoneList
								user={user}
								parts={parts}
								frame={frame}
								onChoose={choose}
								firstRef={firstRow}
								close={close}
							/>
						) : null}
						{parts.map((entry) => {
							const View = views[entry.id];
							return (
								<TabsContent
									key={entry.id}
									value={entry.id}
									forceMount
									// out of the tab order: each part has its own heading and fields, and a lazy part (MFA) would
									// otherwise give the window's start focus to the empty panel before its heading exists
									tabIndex={-1}
									// forceMount keeps a visited part mounted (its edits stay); Radix then never sets hidden
									className={cn(
										"min-h-0 min-w-0 flex-1 flex-col data-[state=inactive]:hidden",
										phoneList ? "hidden" : "flex",
									)}
								>
									{visited.includes(entry.id) ? <View userId={userId} /> : null}
								</TabsContent>
							);
						})}
					</Tabs>
				</AppModal.Body>
			</AppModal>
		</AccountContext.Provider>
	);
});

export { showAccountModal, showUserAccountModal };
