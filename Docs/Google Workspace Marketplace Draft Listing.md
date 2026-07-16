# Google Workspace Marketplace Draft Listing

> **Purpose:** Exercise Airboard's Google Meet installation exactly as a customer would, without granting test users access to the Google Cloud project.  
> **Status:** Public Trader App Configuration saved; Store Listing populated but not saved pending four native file-picker uploads.  
> **Last updated:** 2026-07-16

## Distribution decision

Airboard's Google Cloud project and Meet deployment are centrally owned by the publisher. Customers and draft testers must never receive Google Cloud IAM roles, use `gcloud`, or install the HTTP deployment through the developer API.

The PF-002 real-user test path is a **public Marketplace draft** with individual and administrator installation enabled. `mj.nigam28@gmail.com` is added centrally as a draft tester and installs Airboard from its Marketplace listing. A public listing is required because Airboard is intended for users outside one Google Workspace organization. Publishing or submitting the listing for Google review is not part of PF-002 and must not occur until the later Marketplace, identity, security, and legal gates are complete.

## Proposed App Configuration

| Field | Proposed value | State |
| --- | --- | --- |
| Google Cloud project | `project-1217dd57-9cac-491d-b8d` (`634900453473`) | Ready |
| App visibility | Public | Saved |
| Installation settings | Individual + Admin Install | Saved |
| Integration | Google Workspace add-on, HTTP deployment | Saved |
| HTTP deployment | `projects/634900453473/deployments/airboard-pilot-pf002` | Saved |
| Pilot name | Airboard Pilot | Ready for draft; production naming remains a GMEET-010 decision |
| Pilot web origin | `https://airboard-pilot-web-634900453473.asia-south1.run.app` | Ready for non-customer-data testing |
| OAuth scopes | Default `userinfo.email` and `userinfo.profile` | Saved for the pilot; AUTH-003 and GMEET-003 must still approve the verified identity design before public review |
| Developer name | Airboard | Saved |
| Developer website | Pilot Cloud Run web origin | Saved; replace with the approved production website before review |
| Developer contact email | `hellosigmascience@gmail.com` | Saved |
| Trader status and mailing address | Trader | Saved; the address remains console-only and is intentionally not stored in this repository |

## Proposed Store Listing

| Field | Proposed value | State |
| --- | --- | --- |
| Language | English | Entered |
| Application name | Airboard Pilot | Entered |
| Short description | Intent-driven collaborative diagrams inside Google Meet. | Entered |
| Detailed description | Truthful public-beta copy describing shared typed/pointer diagrams, pilot limitations, Google Meet-owned media controls, and the in-memory/non-sensitive-data restriction | Entered but must be refreshed in the console before Save Draft to remove the earlier experimental-media wording |
| Pricing | Free of charge | Selected |
| Category | Creative Tools | Selected |
| Distribution | All Regions | Selected |
| Draft tester | `mj.nigam28@gmail.com` | Entered centrally; tester receives no project access; not persisted until Save Draft succeeds |
| Draft tester opt-out URL | `/pilot/draft-opt-out` on the pilot web origin | Deployed, returned 200, and entered |
| Application icon 32×32 | `apps/web/public/marketplace/airboard-icon-32.png` | Prepared and dimension-verified; native file-picker selection required |
| Application icon 128×128 | `apps/web/public/marketplace/airboard-icon-128.png` | Prepared and dimension-verified; native file-picker selection required |
| Card banner 220×140 | `apps/web/public/marketplace/airboard-card-banner.png` | Prepared and dimension-verified; native file-picker selection required |
| Screenshot 1280×800 | `apps/web/public/marketplace/airboard-meet-main-stage-1280x800.jpg` | Truthful real Meet main-stage capture prepared and dimension-verified; native file-picker selection required |
| Optional icons 48×48 and 96×96 | `apps/web/public/marketplace/airboard-icon-48.png`, `apps/web/public/marketplace/airboard-icon-96.png` | Prepared; optional uploads |
| Support URL | `/pilot/support` on the pilot web origin | Deployed, returned 200, and entered |
| Setup/Admin/Help URLs | `/pilot/setup` on the pilot web origin | Deployed, returned 200, and entered |
| Report issue URL | `/pilot/support` on the pilot web origin | Deployed, returned 200, and entered |
| Privacy policy URL | `/pilot/privacy` on the pilot web origin | Deployed, returned 200, and entered; pilot-only copy still requires legal approval before review |
| Terms URL | `/pilot/terms` on the pilot web origin | Deployed, returned 200, and entered; pilot-only copy still requires legal approval before review |

## Real-user installation test

1. The project owner opens Google Workspace Marketplace SDK in the central project.
2. The owner selects the HTTP deployment and saves a public, Individual + Admin Install draft.
3. The owner completes the required listing fields and adds `mj.nigam28@gmail.com` as a draft tester.
4. The tester opens the draft Marketplace listing while signed in as `mj.nigam28@gmail.com`.
5. The tester clicks Install and completes only the consent Google presents for the declared scopes.
6. The tester starts a Meet meeting, opens **Meeting tools > Add-ons**, and launches Airboard.
7. PF-002 records discovery, installation, side-panel, main-stage, denied-media, reconnect, and uninstall evidence.

The tester never opens Cloud Console, receives IAM, or runs a deployment command. This is the onboarding behavior the public beta must preserve, subject to a customer's Workspace administrator policies.

## Remaining console and review blockers

- Use Google's native file pickers to select the four required prepared files: 32×32 icon, 128×128 icon, 220×140 card banner, and 1280×800 screenshot.
- Click **Save Draft** only. Do not click **Submit for review** during PF-002.
- Confirm the draft tester persisted, then install through Marketplace as that tester and execute the real-user path.
- Obtain legal approval or replace the pilot privacy/terms copy before GMEET-010/GMEET-011 review submission.
- Approve the minimum OAuth scopes after the verified Google identity design is complete.

## Official references

- [Configure the Marketplace SDK](https://developers.google.com/workspace/marketplace/enable-configure-sdk)
- [Create a Marketplace store listing](https://developers.google.com/workspace/marketplace/create-listing)
- [Test a Marketplace draft with draft testers](https://developers.google.com/workspace/marketplace/manage-app-listing#test_your_draft)
- [Publish a Meet add-on](https://developers.google.com/workspace/meet/add-ons/guides/publish)
