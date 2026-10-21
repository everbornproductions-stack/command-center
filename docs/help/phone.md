---
id: phone
title: Phone pairing
summary: Turn on a Wi-Fi link in Settings so a phone on the same network can open Meldmind. Turning it on is Pro.
lastUpdatedVersion: 0.4.4
---

# Phone pairing

Phone pairing uses this PC's Wi-Fi address when you turn it on in Settings, under Phone and other devices. A Wi-Fi address is used ahead of a virtual adapter. Turning phone pairing on is Pro. Turning it off stays free. The QR code opens a short address. The address under the code also works. Both include the pairing code. It stays off until you turn it on.

1. On the PC, open Settings, then Phone and other devices.
2. Turn on Phone pairing. Leave it off if you do not want a phone to connect. While it is off, this PC answers only on this computer.
3. Scan the QR code with the phone camera, or copy the address under the code and open it in the phone's browser.
4. Keep both devices on the same Wi-Fi.

Windows adds an inbound allow rule named "Meldmind phone pairing" for Meldmind.exe on private networks. Public networks stay closed. The installer adds the same rule, and the app tries again the first time you turn pairing on.

If you see "This PC has no private network address", join Wi-Fi and turn phone pairing on again.

If you see "The phone cannot reach this PC", use the same Wi-Fi and allow Meldmind on private networks in Windows Firewall.

If the phone says "This pairing link is not valid", scan the code on the PC again. An old link stops working after you turn pairing off and on.

If the phone says "This phone cannot reach the PC", the phone is not on the same Wi-Fi, pairing is off, or the firewall is blocking Meldmind.

Turn phone pairing off and this PC answers only on this computer again.
