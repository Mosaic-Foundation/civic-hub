// Every stylesheet of the hub app, imported here first, in the order they
// reached the one bundle before pages loaded lazily (the module order of
// 957fede; frontend pass, 2026-10-24). Rules of equal specificity in two files
// resolve by that order (App.css's ".page h1" over a page's own h1 rule, for
// one), so the hub looks as it did: the page code is split, its CSS is not.
//
// One web font, Inter, bundled as "Inter Variable" and @imported by theme.css,
// whose tokens name that family (design pass, 2026-10-29; it settles the
// Inter / Libre Franklin mismatch left from HANDOFF 2026-10-25).
//
// The kit (kit/kit.css) loads last: one control set on every page (design
// pass, 2026-10-29).
//
// A new stylesheet goes in this list too (src/styles/hubStyles.test.ts fails
// otherwise), where its rules should rank: later wins.

import "./theme.css";
// The space type's palette colours (config/spacePalette.css; kernel step 4).
import "../../../config/spacePalette.css";
import "../index.css";
import "../components/Modal.css";
import "../components/IntroPopup.css";
import "../components/ProcessPicker.css";
import "../components/WaitlistForm.css";
import "../components/ProcessLinkPicker.css";
import "../components/SampleBadge.css";
import "../components/Creator.css";
import "../components/SourceLinks.css";
import "../components/RichText.css";
import "../components/MarkdownTextarea.css";
import "../components/ShareButton.css";
import "../components/RelatedProcesses.css";
import "../components/DetailActions.css";
import "../components/CloseEarly.css";
import "../components/AdminArchiveButton.css";
import "../components/ProcessHeader.css";
import "../components/EditHistory.css";
import "../components/AssistantPanel.css";
import "../components/DraftShell.css";
import "../components/CocFindings.css";
import "../pages/ProposeDraft.css";
import "../pages/ProposeDraftVote.css";
import "../pages/ProjectDraft.css";
import "../components/DraftingForm.css";
import "../components/VoteDraftingForm.css";
import "../components/ProcessLinkField.css";
import "../components/HelpButton.css";
import "../components/PostImagePicker.css";
import "../components/PostFeaturedImage.css";
import "../components/LinkPreviewCard.css";
import "../components/AdminRail.css";
import "../components/AdminDrawer.css";
import "../components/AdminPublicationReview.css";
import "../components/AdminSticky.css";
import "../components/FeedFilter.css";
import "../components/ShareBanner.css";
import "../components/AdminMenu.css";
import "../components/SharePanel.css";
import "../../../features/search/ui/SearchBar.css";
import "../components/Nav.css";
import "../components/NavItemList.css";
import "../components/Sidebar.css";
import "../components/MoreSheet.css";
import "../components/BottomBar.css";
import "../components/FeedVotesTabs.css";
import "../components/WelcomeBanner.css";
import "../components/AdminSetupCard.css";
import "../pages/settings/document/DocumentEditor.css";
import "../components/HomeShareRow.css";
import "../../../features/members/ui/MemberCount.css";
import "../components/Feed.css";
import "../components/LegalPage.css";
import "../../../features/search/ui/Search.css";
import "../../../features/members/ui/Members.css";
import "../pages/AdminSettings.css";
import "../pages/settings/GettingStartedSection.css";
import "../pages/Settings.css";
import "../pages/Feedback.css";
import "../pages/Welcome.css";
import "../pages/AdminArchived.css";
import "../pages/AdminEdits.css";
import "../pages/AdminReviews.css";
import "../components/SubmissionPreview.css";
import "../pages/MySubmissions.css";
import "../components/SharePrompt.css";
import "../components/BetaBanner.css";
import "../components/BetaWelcomeDialog.css";
// The three-column layout's right column (ADR-019); its rules are its own.
import "../aside/aside.css";
// The kit's page patterns (Events 3): the section page's head, groups, list
// card, chips and filter pills, where App.css and Feed.css ranked them.
import "../kit/patterns.css";
// Districts and demographics (2026-11-16): About you, and the results' breakdown tables.
import "../components/AboutYouForm.css";
import "../components/ResultsBreakdown.css";
import "../App.css";
import "../kit/kit.css";
