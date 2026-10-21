# Phone version: Play Store and App Store plan (2026-10-18)

Status, 2026-10-21: phone apps and store listings are Later in docs/BUILD-PLAN.md (Phase 95 and store listings). They are not part of 0.4.9, 0.4.10, or 0.4.11. The phone-sized web layout that already ships is not the native app. The plan price for Pro is $18.99 a month. The live Square checkout is still $15.99 until Chris changes it.

## What exists now

The web app is a **Progressive Web App**: phone layout (bottom navigation, stacked panels, swipeable council columns), install manifest, icons, offline shell. On Android, Chrome offers "Install app"; on iPhone, Safari → Share → Add to Home Screen. It runs full-screen like a native app. This is the shell the store builds wrap.

## The decision that comes first: where does the brain run?

The orchestration (router, council, missions, ledger) runs on the PC today and the API keys are sealed there. A phone needs to reach a brain somewhere. Two options; they can coexist.

| | A. Phone as remote control of your PC | B. Hosted hub (we run the server) |
|---|---|---|
| How | Cloudflare Tunnel or Tailscale exposes the PC's port 4747 privately; the phone app points at that address. Keys stay on the PC. | Each subscriber gets a hub in the cloud (a container per account). Phone and desktop both talk to it. Keys encrypted server-side (KMS). |
| Works when the PC is off | No | Yes |
| Cost to us | Nothing | Hosting per user (small: the hub is idle most of the time) |
| Privacy pitch | Strongest ("your keys never leave your PC") | Standard SaaS; needs a clear policy |
| Fits the Pro plan | Yes for power users. People already paying stay at $15.99 a month. New Pro is $18.99 a month. | Yes, and it is what most buyers expect from a subscription |
| Build effort | Days: an address field in the app, a QR pairing screen, the tunnel instructions | Weeks: multi-tenant server, accounts, encrypted vault, billing-linked provisioning |

Recommendation: ship **A first** (it needs only a settings screen and a pairing QR code), and build **B** as the subscription matures, because B is also what solves licensing, updates and "works anywhere". The phone app is the same build either way; only the hub address changes.

## Store builds (Capacitor)

Capacitor wraps the existing web app into native shells with no rewrite:

```
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
npx cap init "Meldmind" com.everborn.command --web-dir web
npx cap add android && npx cap add ios
npx cap sync
```

The native app loads the UI from the hub address (configured at first launch or by scanning a QR code shown on the desktop), so the app in the store is thin and updates come from the hub, not from store releases. Native extras worth adding through Capacitor plugins: push notifications (amber/red light, renewal in 3 days, mission finished), biometric lock, share-sheet ("send this to Meldmind").

Requirements:

- **Google Play**: $25 one-time developer account; Android build can be made on this PC (Android Studio). Review takes days. Data-safety form: declare that API keys are stored on device/hub and that browsing history scanning is local and opt-in.
- **Apple App Store**: $99/year developer account; an iOS build needs a Mac with Xcode, or a cloud builder (Codemagic, Bitrise, Expo EAS for Capacitor) which costs about $30–100/month while you ship. Review is stricter: the app must do something useful before sign-in, and must not look like a bare web wrapper (the live ops graph, status strip and push alerts cover that).
- **Payments in-app**: digital subscriptions bought *inside* the iOS app must use Apple In-App Purchase (30%, 15% under the Small Business Program). Since the 2025 US court ruling, Apple must allow a link out to an external checkout in the US, so the Square link can be offered from inside the app with Apple's required disclosure. Google Play has a similar "user choice billing" route. Simplest launch: sell on the website with the Square link, let the app sign in with the account that bought it, and add IAP later if store conversion matters.
- **Listing assets**: name, 512 px icon (done: `web/icons/icon-512.png`), feature graphic 1024×500, 4–8 screenshots per platform (phone and tablet), privacy policy URL, support email.

## Order of work

1. PWA polish (done today) and a QR pairing screen on the desktop that encodes the hub address.
2. Cloudflare Tunnel recipe for your own PC (`cloudflared tunnel --url http://localhost:4747` with Cloudflare Access in front, so only your Google login can open it).
3. Capacitor Android build and internal testing track on Play.
4. Hosted hub (option B), accounts tied to the Square subscription.
5. iOS build through a cloud builder, TestFlight, then App Store.
