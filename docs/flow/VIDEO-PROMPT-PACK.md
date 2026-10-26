# Meldmind AI video prompt pack: DRAFT (2026-10-24)

Status: draft for Chris. Every prompt below is original ("original" on each one), written from public technique only (see the research file in the same folder). Nothing was copied from any paid classroom.

Pack conventions
- Fields per prompt: id, title, category, industry, when to use, prompt, tool tips, realism notes. Source for all: "Meldmind original", no source_url, added_week 2026-W43 (or the week it ships).
- Prompts use [placeholders] so they pass the pack check in server/prompts/packs.js (max 4000 characters, at least one [placeholder] outside the builders category).
- Category values map to PACK_CATEGORIES: video, images and design, real estate, social media, marketing and ads, creators.
- Defaults to keep in every video prompt: one subject, one action, one camera move, 5 seconds. Set aspect ratio and duration in the tool's own controls, not in the prompt.
- Never ask the tool to render readable text, logos, prices or phone numbers. Add them in the edit.
- Realism house rule (Chris): mouths mostly closed, tiny natural beats (a sigh, a look down, a blink), no exaggerated motion. Edit first in ffmpeg (trim, speed, crop, stabilize, cut on the beat). Retry once at most, then change the first frame, not the wording.

---

## A. Product and business reels (category: video, industry: any)

### A1. Product on a counter, slow push-in (original)
- When to use: hero shot of a product for a reel opener or ad.
- Prompt: Medium close-up of [product] on [surface], softly lit by [light source]. Slow, steady push-in over 5 seconds. Nothing else moves except a faint reflection and drifting dust in the light. Shallow depth of field, natural color, no text.
- Tool tips: Works in Kling, Luma, Runway, Veo. For image-to-video, drop the first sentence and only describe the move.
- Realism: Keep the push-in slow. If the product wobbles, crop in the edit instead of regenerating.

### A2. Hands using the product (original)
- When to use: show use without showing a face.
- Prompt: Close-up of a pair of [adult, plain hands, no jewelry] using [product] at [location]. One simple action: [action]. Camera static, slightly above eye level. Window light from the left, soft shadows.
- Tool tips: Hands are the usual failure. Generate 2 to 3 takes at the fast setting before any quality render.
- Realism: Frame so fingers stay mostly out of frame or in simple poses. Start from a real photo of hands when you can.

### A3. Unboxing, one reveal (original)
- When to use: new product, gift, subscription box.
- Prompt: Top-down shot of a [box type] on a [table surface]. A hand lifts the lid slowly, revealing [product]. Static camera. Soft overhead light, calm pace, 5 seconds.
- Tool tips: Say "static camera" so the model does not add a move.
- Realism: One lid lift, nothing more. Cut away before anything else has to move.

### A4. Business owner at work, B-roll (original)
- When to use: about-us or trust reel where the owner is not speaking.
- Prompt: Medium shot of [owner description, age, clothing] at [workplace], looking down at [task object], then glancing up toward the window. Mouth closed, relaxed face. Handheld feel, very slight, natural daylight.
- Tool tips: Use Kling or Veo. Use a real portrait as the first frame for identity.
- Realism: The glance up is the only beat. No smiling at camera, no talking, no gestures.

### A5. Before and after reveal by wipe (original)
- When to use: cleaning, remodel, makeover, organization.
- Prompt: Static wide shot of [space] in [before state]. Natural light does not change. Hold still for 5 seconds. (Generate the after shot separately with the same framing: [space] in [after state].)
- Tool tips: Make two clips from two matching first frames, then do the wipe in ffmpeg or the editor. Do not ask the model to do the transformation.
- Realism: Matching framing sells it. Lock the camera in both prompts.

### A6. Packaged goods in motion, steam or pour (original)
- When to use: food, drink, candles, skincare.
- Prompt: Close-up of [liquid or product] being poured into [container] on a [surface]. Thin steam rising. Static camera, warm side light, tiny natural ripples, 5 seconds.
- Tool tips: Physical details like steam, pour and condensation render well and read as real.
- Realism: Avoid fast pours. Slow it down in ffmpeg if needed (setpts) rather than prompting "slow motion" for the whole clip.

---

## B. Real estate (category: real estate, industry: real estate)

### B1. Exterior establishing shot (original)
- When to use: listing opener.
- Prompt: Wide establishing shot of a [home style] home in [neighborhood type], [time of day] light. Slow forward drone-style push-in toward the front door over 5 seconds. Lawn and trees move only slightly in a light breeze. No people, no cars, no text.
- Tool tips: Use the real listing photo as the first frame; the prompt then describes only the move.
- Realism: Remove people and cars from the first frame. Keep house lines straight; reject clips where walls bend.

### B2. Kitchen slow pan (original)
- When to use: feature the kitchen.
- Prompt: Interior of a [kitchen style] kitchen with [counter material] counters and [cabinet color] cabinets. Slow pan left to right across the island over 5 seconds. Morning window light, clean and uncluttered, no people.
- Tool tips: Keep it to one pan. Runway and Kling hold interiors well from a real photo.
- Realism: Do not add steam, people or food; they invite errors. Keep it empty and calm.

### B3. Living room with natural light shift (original)
- When to use: show warmth and space.
- Prompt: Wide shot of a [style] living room with [furniture detail]. Static camera. Sunlight moves gently across the floor as a cloud passes, curtains stir very slightly. 5 seconds.
- Tool tips: "Static camera" plus one light change is easy for models.
- Realism: Small light changes read as real. Skip any moving person.

### B4. Backyard or view reveal (original)
- When to use: yard, patio, pool, skyline.
- Prompt: Medium shot from inside through [door or window] toward [backyard feature]. Slow dolly forward through the opening, ending on a wide view of [view]. Soft late-afternoon light.
- Tool tips: Dolly through an opening is a strong reveal, but it can warp edges. Use the fast model first.
- Realism: If the frame edges warp, crop 5 percent in the edit.

### B5. Agent walk-in teaser, no dialogue (original)
- When to use: agent intro reel; voiceover added later.
- Prompt: Medium shot of [agent description] standing at the front door of a [home type], looking at the house number, then turning toward camera with a small closed-mouth smile. Static camera, eye level, daylight.
- Tool tips: Use a real headshot as the first frame. Add voiceover and captions in the edit.
- Realism: Closed-mouth smile only. Never prompt the agent to speak; lip errors show most on real people.

---

## C. Local service (category: video, industry: local service)

### C1. Plumber, HVAC or electrician at work (original)
- When to use: trust reel for a trade business.
- Prompt: Medium shot of a [trade] technician in [uniform color] kneeling to work on [equipment] in [location]. Head down, focused, mouth closed. Static camera, natural light with a work lamp fill. One small action: [turning a wrench / checking a gauge].
- Tool tips: Pick a prop with a simple, repeating action.
- Realism: No tool-in-hand gymnastics. Keep hands low in frame.

### C2. Landscaper or cleaner finished-result shot (original)
- When to use: proof of results.
- Prompt: Wide shot of a freshly [mowed lawn / cleaned room] at [place]. Slow push-in over 5 seconds. Light breeze, golden hour, nothing else moves.
- Tool tips: Start from a real after photo and animate only the push-in.
- Realism: Real photo first, so no invented results are shown.

### C3. Storefront open-sign morning (original)
- When to use: restaurant, salon, shop opener.
- Prompt: Wide shot of the front of a small [business type] at [time of day], door glass reflecting the street. Static camera. A person's silhouette inside turns on the lights; the interior glows warm. No readable text.
- Tool tips: Add the real name and hours as overlay text later.
- Realism: Silhouette only, no face.

### C4. Customer reaction, quiet (original)
- When to use: testimonial B-roll behind a voiceover.
- Prompt: Medium close-up of a [customer description] seated at [place], looking down at [phone or paper], then lifting their eyes with a slight, closed-mouth nod and a quiet exhale. Soft window light, static camera.
- Tool tips: Use Kling or Veo with a real or licensed first frame. Do not pass off as a real customer; label as dramatization where needed.
- Realism: The exhale and nod are the whole performance. Do not add laughing or big smiles.

### C5. Service van arrival (original)
- When to use: dispatch, "on the way" reel.
- Prompt: Wide shot of a plain, unmarked [van color] service van pulling to a stop in front of a [home type] on a quiet street, [time of day]. Camera static from across the street. Leaves move slightly. No visible text on the van.
- Tool tips: Add logo and lettering as a decal overlay afterward; models garble it.
- Realism: Slow, short vehicle motion only.

---

## D. Music video shots (category: video, industry: creators; works with the ai-music-video builder)

### D1. Artist walking, tracking from the side (original)
- When to use: verse visual.
- Prompt: Medium tracking shot following [artist description] walking along [location] at [time of day], side view. Camera moves at walking pace. Mouth closed, eyes forward. Mood: [mood]. Natural motion only.
- Tool tips: Use a real photo of the artist as frame 1 for identity. Keep to 5 seconds so each shot can be cut on a beat.
- Realism: Side or back angles hide lip-sync issues. Add singing in a separate lip-sync step.

### D2. Close-up listening beat (original)
- When to use: quiet line, bridge.
- Prompt: Close-up of [artist description] looking down, then slowly raising their eyes toward the light. Mouth closed. One slow blink. Static camera, [lighting]. 4 seconds.
- Tool tips: Kling is good for faces from a real first frame.
- Realism: Slow, tiny. This is the "sigh and look down" family.

### D3. Lip-sync performance shot (original)
- When to use: chorus close-up.
- Prompt: Medium close-up of [artist description] facing camera in [location]. Neutral face, mouth closed, slight head still. Static camera, [lighting]. (Generate silent, then run a lip-sync tool on the result with the audio clip.)
- Tool tips: Generate the clip silent with a closed mouth, then apply a lip-sync tool such as Sync.so. Cut lip-sync shots to 2 to 3 seconds.
- Realism: Do not prompt mouth movement. Lip-sync models do it better and more naturally from a closed-mouth start.

### D4. Instrument detail (original)
- When to use: fill shot, between vocal shots.
- Prompt: Extreme close-up of [instrument] strings or keys at [location]. One finger presses [string or key] once. Static camera, shallow depth of field, [lighting].
- Tool tips: Pair with a drum hit or note in the track and cut on it.
- Realism: One press only. Fast playing breaks easily.

### D5. Crowd or city bokeh cutaway (original)
- When to use: transition filler.
- Prompt: Wide shot of [city street / venue] at night, out-of-focus lights drifting slowly. Static camera, rain on the lens optional, [color palette] tones. No identifiable faces.
- Tool tips: Out-of-focus shots hide AI errors and cut easily.
- Realism: Keep faces blurred or absent.

### D6. Beat cutting plan (original)
- When to use: assemble clips to a song in ffmpeg.
- Prompt: I have [number] clips of about [seconds] seconds each and a song at [bpm] BPM, length [song length]. Write an ffmpeg-friendly cut list that cuts on every [1 / 2 / 4] beats, alternates close and wide shots, places lip-sync shots on the chorus, and lists start and end times in seconds. Output a table: cut number, clip, in, out.
- Tool tips: This one goes to a text AI, not a video tool. Give it the clip list first.
- Realism: Cutting on the beat hides small flaws; shorter shots mean fewer retries.

---

## E. Social hooks (category: social media, industry: creators)

### E1. Three-second opener, bold visual (original)
- When to use: first beat of any reel.
- Prompt: Extreme close-up of [striking object tied to the topic: e.g., a key, a cracked phone, a single coffee bean] in [setting]. Quick push-in over 3 seconds, high contrast light, no text. Ends on a clean frame where I can place a headline.
- Tool tips: Leave empty space on the frame for a caption.
- Realism: Object, not person. Safe and attention-grabbing.

### E2. Pattern interrupt, one odd detail (original)
- When to use: stop the scroll.
- Prompt: Static medium shot of [ordinary scene]. One small unexpected thing happens: [a paper plane crosses the frame / a light flickers on]. Everything else is still. 4 seconds.
- Tool tips: One odd event, nothing else.
- Realism: No chaos. A quiet surprise reads as real.

### E3. Problem shot (original)
- When to use: first beat of a problem-solution reel.
- Prompt: Medium shot of [person from behind] standing at [location with the problem], shoulders dropping slightly as they exhale. Static camera, cool dim light. No face visible.
- Tool tips: Face hidden avoids the uncanny look.
- Realism: The exhale is the beat.

### E4. Solution shot (original)
- When to use: second beat of the same reel.
- Prompt: Same location as the problem shot, now [bright / tidy / fixed]. Medium shot, static camera, warm light. A hand places [object] into the scene. 4 seconds.
- Tool tips: Reuse the same first frame style as E3 for visual continuity.
- Realism: One hand action.

### E5. Loop-friendly ending (original)
- When to use: last beat so the reel replays.
- Prompt: Wide shot of [scene], a slow pull-back over 4 seconds ending on the same composition as the first frame of the reel. Gentle ambient movement only.
- Tool tips: Match the last frame to the opener for a clean loop.
- Realism: Slow pull-back, nothing that can fail.

---

## F. First-frame image prompts (category: images and design)
These make the still that starts an image-to-video clip. The image fixes look, light and identity; the video prompt then describes only motion.

### F1. Product hero still (original)
- When to use: before A1 to A6.
- Prompt: Photograph of [product] on [surface], 50mm lens, soft key light from [direction], gentle shadow, clean background of [color], natural color, sharp focus on the product, room left on the [left/right] for a headline. No text, no logo overlay.

### F2. Portrait, closed-mouth, neutral (original)
- When to use: before D1 to D3 and C4.
- Prompt: Photograph of [person description] at [location], 85mm lens, eye-level, soft window light, relaxed neutral face, mouth closed, natural skin texture with small imperfections, hands out of frame.
- Realism: Natural skin texture and small imperfections matter; over-smoothed skin gives the AI look.

### F3. Interior listing still (original)
- When to use: before B2, B3.
- Prompt: Photograph of a [room type] interior, wide 24mm lens, straight verticals, daylight, clean and uncluttered, no people, no text.

### F4. Exterior with open space for the move (original)
- When to use: before B1, C5.
- Prompt: Photograph of a [building type] exterior at [time of day], wide 28mm lens, eye level, leaving open space around the building so a push-in has room. No people, no cars, no signage text.

### F5. Over-the-shoulder working shot (original)
- When to use: before C1, A4.
- Prompt: Over-the-shoulder photograph of [worker] working on [task] in [location], 35mm lens, natural light, face turned away, hands in simple poses.

### F6. Character reference sheet for consistency (original)
- When to use: when one person appears in several shots.
- Prompt: One image with three views of the same [person description]: front, three-quarter, side. Same clothes ([clothing]), plain [color] background, even lighting, neutral mouth-closed expression.
- Tool tips: Reuse this sheet as the reference image in tools that accept references (Kling, Seedance, Runway).

---

## G. Camera movement library (category: video; paste one into any prompt)
Use exactly one per clip. Name the speed.

### G1. Slow push-in (original)
- Prompt line: Slow, steady push-in toward [subject] over [seconds] seconds. The rest of the frame stays still.

### G2. Slow pull-back (original)
- Prompt line: Slow pull-back from [subject], revealing [wider context]. Smooth and steady.

### G3. Pan (original)
- Prompt line: Slow pan [left/right] across [scene] at walking pace. Camera stays at the same height.

### G4. Tracking shot (original)
- Prompt line: Smooth tracking shot following [subject] from the side at their walking pace, keeping the subject centered.

### G5. Orbit (original)
- Prompt line: Slow orbit a quarter turn around [subject], keeping it in the center of the frame.
- Tool tips: Orbits are harder; keep the subject simple, like an object.

### G6. Static locked-off (original)
- Prompt line: Static camera, locked on a tripod. Only [one small detail] moves.
- Tool tips: Best default when motion keeps failing.

---

## H. Lighting and mood library (category: images and design; paste one into any prompt)

### H1. Soft window light (original)
- Prompt line: Soft daylight from a large window on the left, gentle shadows, natural color.

### H2. Golden hour (original)
- Prompt line: Low warm sun, long soft shadows, gentle glow on edges.

### H3. Overcast softbox (original)
- Prompt line: Even overcast light, no hard shadows, true-to-life color.

### H4. Night neon (original)
- Prompt line: Night scene lit by [color] neon signs, wet pavement reflections, deep shadows, restrained contrast.

### H5. Warm practical lamps (original)
- Prompt line: Warm lamp light in the room, soft falloff, cozy and low-key.

---

## I. Negative prompt set (category: video)
Use the tool's negative prompt field if it has one. Where there is none (Runway advises against negative phrasing), describe what you want instead (for example "mouth closed, calm face" in place of "no talking").

### I1. General cleanup (original)
- Prompt: text, watermark, logo, extra fingers, extra limbs, warped hands, distorted face, melted objects, flicker, sudden jump cuts, morphing.

### I2. People realism (original)
- Prompt: talking, open mouth, big smile, exaggerated expression, fast head turns, sliding feet, plastic skin, glowing eyes.

### I3. Interiors and products (original)
- Prompt: bending walls, shifting furniture, changing colors, extra objects appearing, warped edges, readable text, brand names.

---

## J. Realism checklist (category: video; use as a QA prompt for a text AI or as a manual check)

### J1. Before you generate (original)
- Prompt: Review my plan for [clip description]. Check each item and say pass or fix: one subject, one action, one camera move, first frame is clean and sharp, mouth closed unless lip-sync is added later, one tiny natural beat included ([beat]), no text or logos requested, aspect ratio and duration set in the tool. Give a corrected prompt if any item fails.

### J2. After you generate (original)
- Prompt: I will describe a finished clip: [what I see]. Judge it for the AI look: face or hand drift, sliding feet, plastic skin, rubber motion, flicker, warped edges, shadows that change. For each problem, say whether I should fix it in ffmpeg (trim, crop, speed change, stabilize, cut around it) or regenerate. Prefer the edit. Allow at most one retry.

### J3. ffmpeg fix suggestions (original)
- Prompt: Write ffmpeg commands for Windows to fix [problem] in [file]: options include trimming the bad seconds, a 5 percent crop to remove warped edges, slowing to [speed] with setpts and atempo, light stabilization, and cutting on the beat at [bpm]. Show each command once with a one-line explanation. Save to a new file; do not overwrite the original.
- Tool tips: Text AI task, not a video tool.

---

Count: A6, B5, C5, D6, E5, F6, G6, H5, I3, J3 = 50 prompts.

Open items for Chris: (1) confirm categories and that real estate and local service prompts go into the existing "real estate" and "video" categories; (2) decide the week tag; (3) conversion to JSON in server/prompts/packs/ is a mechanical step and was not done here; (4) label dramatized "customer" or "agent" footage honestly where rules require it.
