# Privacy

Meldmind is an Everborn product by Everborn Productions. This note says what stays on your computer, what leaves it, where it goes, and what the three levels of learning and sharing may use. It describes Meldmind 0.4.22, and it matches what versions 0.4.19 and later actually send, except where the History section below says a version differed. The same list is shown inside the app in Settings > Privacy.

## Your keys, files, and chats

Your API keys stay on your computer and are only sent to the AI company they belong to. The app keeps your history, ledger, files, and settings in your own data. Nothing is posted, emailed, or published unless you click to confirm that action.

The learning router on your computer (Level 1: on-device learning) is on by default with no ask. It keeps scores, cost, speed, and the type of each task locally on this PC. Nothing leaves your computer. It does not keep your prompts, answers, or keys. You can turn that local learning off in Settings > Privacy or on **Who's best** by clearing **Learn from every job**. Export and delete travel with the rest of your data.

## Who gets what

Meldmind has no advertising code and no third-party analytics or crash-reporting service. Here is everything the app can send to an outside address. Like any web request, each of these lets the receiving server see your IP address.

| What | Where it goes | When | Can you turn it off |
|---|---|---|---|
| Your prompts, the chat so far, files you attach, and your key | The AI company that key belongs to. The supported ones are Anthropic (Claude), OpenAI, Google (Gemini), xAI (Grok), Perplexity, OpenRouter, DeepSeek, Groq, Mistral, plus media makers such as Kling, ElevenLabs, Replicate and fal.ai. An OpenRouter key sends the request to OpenRouter, which passes it to the model you picked. | When you send a chat, a council, a mission, or a job to that AI. Model lists, health checks, model watch, and credit balances use the same key, only at that company's own address. | Remove the key in Settings. Private mode keeps a chat out of the learning record, but the AI still has to receive it to answer. |
| Voice and tap to talk | The recording goes to the first speech provider you have a key for: OpenAI, Groq, ElevenLabs, or Google Gemini. Spoken replies and two-way voice use your OpenAI or ElevenLabs key. | Only when you use the microphone or ask for a spoken reply. | Do not use voice, or remove those keys. |
| License check | Everborn's license server (Supabase): your license key, a random device id, this computer's name, the operating system, and the app version. If you signed in with Google or Microsoft to unlock a plan, the confirmed email from that sign-in is also checked. | When you add a license key, then about every 12 hours while a key is saved. | Do not add a license key (the app runs on Free), or remove this computer from the license in Settings. |
| Update checks | GitHub, the public command-center-releases page. The request carries nothing about you or your work. | On launch and about every hour in the desktop app. Nothing downloads until you click to install. A browser copy asks Everborn's website for a small version file instead. | There is no switch. |
| Fonts | Google Fonts (fonts.googleapis.com and fonts.gstatic.com), which supplies the Inter and JetBrains Mono fonts. Google sees your IP address and browser details, as for any web font. | When the app page opens. | There is no switch. The app still works if the request fails. |
| Model price list | OpenRouter's public models list. Nothing about you is sent. | At most once a day. | There is no switch. |
| AI status pages | The public status page of each AI company you connected (for example status.openai.com). | When the app starts and when it checks the health lights for a key you saved. | Remove the key for that company. |
| Anonymous usage counts | Everborn's hub (hub.meldmind.ai). See Anonymous usage counts below for exactly what is sent. | Once a day, only while the switch is on. | Yes, in Settings. |
| Web search | The search service you choose: DuckDuckGo (no key), Tavily, Brave, Serper or Exa (with your key), or your own SearXNG. Meldmind may also open the pages that come back so it can read them. | Only when web search is turned on for single, council, or mission runs. It is off until you turn it on. | Turn it off in Settings. |
| Apps you sign in to | The service you signed in to (Google, Microsoft, HighLevel, Meta, Notion, Slack, Zapier, Make, Netlify, Vercel, and the like). | Only after you sign in or add that key. A send, post, or change waits for your click. | Disconnect it in Settings > Connect your apps, or remove the key. |
| Community chat and AI News | Everborn's community server (Supabase): a message or reaction you post, your public username, and your email only if you join the AI News list. | When you post, react, join the list, or open Community (opening reads the latest messages). | Do not post. Leave the AI News list in Settings. |
| Chat sync between devices | Everborn's sync server, or your own Supabase if you set one. Your chats are sealed with a key made from your passphrase, so the server only sees scrambled data. | Only after you turn on sync. | Off until you turn it on. |
| Handing a job to another AI agent | The address of the agent you set up (for example Grok Bot or a webhook), and Everborn's hub only if a report-back address is set up. It carries the job text and a one-time return link. | Only when you hand off a job. | Do not set up an outside agent, or remove it in Settings. |
| Email and phone alerts | The email service or phone push service you set up. | Only after you turn on an alert and add where it goes. | Turn the alert off in Settings. |
| Share links | This computer, or the https address you saved under Share. | Only when you click Share. | Do not share, or delete the link. |
| Phone pairing | Your own phone, on the same Wi-Fi. Not the internet. | Only after you turn on phone pairing. | Off until you turn it on. |

Things that stay on this computer: your suggestions typed into the suggestion box are saved here and are not sent anywhere in this version.

## Shared learning

Shared learning (Level 2: anonymous quality signals) is a separate choice. On the welcome screen and in Settings, Meldmind shows an up-front notice: **Helping Meldmind get smarter: anonymous results only, never your text**. It is on by default with that notice, except in consent-first regions (such as the EU and the UK, chosen from the OS locale and region) where it defaults off and asks. Existing installs see the notice once and keep their current choice unless they never made one. For now these anonymous results are kept on this computer and are not sent anywhere: the sending itself is switched off in the app until our receiving service is live. When it goes live, this page and the notice in the app will say so first.

Meldmind learns from every job you run. Anonymous track records help it pick the best AI for everyone.

## What we share

We share only anonymous track records: the task type, which AI, and the score (counts only: provider, task type, thumbs up/down or retry/accept, cost and latency bucket, app version, and a random install id). We never share prompts, content, or keys (no prompts, answers, file names, emails, keys, or identifying ids). We do not use your name, your account, or the text of a chat.

While the box is clear, this note appears: Meldmind learns from the community. With this off, your jobs won't help make it smarter for everyone, but you'll still benefit from what others share.

You can change this any time in Settings. On **Who's best**, tick or clear **I am willing to share anonymous track records**.

**Show what would be shared** lists the anonymous totals on this computer. This version does not send them.

## Content sharing for our own-AI program

Level 3 (**Share real prompts and answers for our own-AI program**, source-tagged, with closed-AI outputs excluded) stays explicit opt-in and is never pre-checked in any region. Nothing collects prompts or answers without your clear yes.

The same words are in docs/legal/shared-learning.md.

## Anonymous usage counts

Settings includes **Share anonymous usage counts to help improve Meldmind**. It is on by default with the up-front notice, and off until you turn it on in consent-first regions such as the EU and the UK. Existing installs keep their choice.

Once a day, if this is on, Meldmind sends a random install id, the app version, the operating system, your plan, and how many times each feature was used. It does not send prompts, answers, chats, file names, emails, keys, or identifying ids. The counts go to Everborn's hub at hub.meldmind.ai. Feature names that look like content (such as email, prompt, file, key, or text) are refused before anything is sent, and Everborn's report on these counts shows totals.

You can change this any time in Settings. Clear the switch and the daily ping stops.

## History

- Version 0.4.19 tried to send the anonymous quality signals described above to the hub once a day while the switch was on. Version 0.4.20 and later switched that sending off in the app until the receiving service is live. The anonymous usage counts have been sent once a day, while their switch is on, in every version covered here.
- Versions before 0.4.18 turned usage counts off on new installs. Version 0.4.18 and later turn them on by default outside the EU, EEA, UK and Switzerland, with the up-front notice.

## Questions

Write to Everborn Productions at everbornproductions@gmail.com.
