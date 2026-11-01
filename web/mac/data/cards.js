// 0.4.23 Mac-style GUI: pure data and logic for cards and paths. No DOM, unit tested.

export const PATHS = {
  website: {
    id: "website",
    title: "What kind of website?",
    describePlaceholder: "Tell us about your business in one sentence",
    finish: "Publish site",
    styles: [
      { id: "clean", name: "Clean shop", desc: "Tap to pick. Built from a Pro prompt.", gradient: "g5", prompt: "A clean website for [my bakery]", popular: true },
      { id: "bold", name: "Bold and bright", desc: "Vibrant colors for modern brands.", gradient: "g2", prompt: "A bold and bright website for [my studio]", popular: false },
      { id: "pastel", name: "Soft pastel", desc: "Calm and gentle tones.", gradient: "g8", prompt: "A soft pastel website for [my spa]", popular: false },
      { id: "dark", name: "Dark and modern", desc: "Sleek dark theme with neon accents.", gradient: "g3", prompt: "A dark and modern website for [my tech startup]", popular: false },
      { id: "green", name: "Fresh and green", desc: "Eco friendly and natural feel.", gradient: "g4", prompt: "A fresh and green website for [my organic farm]", popular: false },
      { id: "ocean", name: "Ocean blue", desc: "Deep blue professional layout.", gradient: "g1", prompt: "An ocean blue website for [my consultancy]", popular: false },
      { id: "minimal", name: "Minimal layout", desc: "Clean typography and white space.", gradient: "g7", prompt: "A minimal layout website for [my portfolio]", popular: false }
    ]
  },
  image: {
    id: "image",
    title: "What kind of image?",
    describePlaceholder: "Describe your image in one sentence",
    finish: "Download image",
    styles: [
      { id: "photo", name: "Realistic photo", desc: "High quality photographic render.", gradient: "g1", prompt: "A realistic photo of [a cozy cafe interior]", popular: true },
      { id: "vector", name: "Clean vector", desc: "Flat design and crisp lines.", gradient: "g2", prompt: "A clean vector illustration of [a mountain landscape]", popular: false },
      { id: "oil", name: "Oil painting", desc: "Classic artistic brush strokes.", gradient: "g3", prompt: "An oil painting of [a sailing ship at sunset]", popular: false },
      { id: "3d", name: "3D render", desc: "Glossy modern 3D shapes.", gradient: "g4", prompt: "A 3D render of [futuristic headphones]", popular: false },
      { id: "sketch", name: "Hand sketch", desc: "Detailed pencil drawing.", gradient: "g5", prompt: "A hand sketch of [an architectural facade]", popular: false },
      { id: "watercolor", name: "Watercolor wash", desc: "Soft bleeding color washes.", gradient: "g7", prompt: "A watercolor wash of [blooming spring flowers]", popular: false },
      { id: "cyber", name: "Cyberpunk neon", desc: "Glow effects and dark shadows.", gradient: "g8", prompt: "A cyberpunk neon scene of [a rainy Tokyo street]", popular: false }
    ]
  },
  video: {
    id: "video",
    title: "What kind of video?",
    describePlaceholder: "Describe your video in one sentence",
    finish: "Download video",
    styles: [
      { id: "cinematic", name: "Cinematic film", desc: "Widescreen mood and dramatic lighting.", gradient: "g3", prompt: "A cinematic film shot of [a lone traveler on a cliff]", popular: true },
      { id: "motion", name: "Motion graphics", desc: "Dynamic shapes and smooth transitions.", gradient: "g1", prompt: "Motion graphics showing [data flow animation]", popular: false },
      { id: "doc", name: "Documentary style", desc: "Natural lighting and authentic feel.", gradient: "g4", prompt: "A documentary style video of [artisanal pottery makers]", popular: false },
      { id: "social", name: "Social reel", desc: "Fast paced engaging vertical clip.", gradient: "g2", prompt: "A social reel of [quick cooking tips]", popular: false },
      { id: "retro", name: "Retro VHS", desc: "Vintage tape grain and color bleed.", gradient: "g5", prompt: "A retro VHS home video of [a summer beach party]", popular: false },
      { id: "ambient", name: "Ambient loop", desc: "Relaxing continuous background visual.", gradient: "g7", prompt: "An ambient loop of [gentle forest rain]", popular: false },
      { id: "corporate", name: "Corporate intro", desc: "Professional polished company opening.", gradient: "g8", prompt: "A corporate intro for [a logistics company]", popular: false }
    ]
  },
  campaign: {
    id: "campaign",
    title: "What kind of campaign?",
    describePlaceholder: "Describe your marketing campaign in one sentence",
    finish: "Post campaign",
    styles: [
      { id: "launch", name: "Product launch", desc: "Exciting rollout with social buzz.", gradient: "g4", prompt: "A product launch campaign for [our new smart watch]", popular: true },
      { id: "brand", name: "Brand awareness", desc: "Build lasting community trust.", gradient: "g1", prompt: "A brand awareness campaign for [local artisans]", popular: false },
      { id: "growth", name: "User growth", desc: "Drive signups and active engagement.", gradient: "g2", prompt: "A user growth campaign for [our mobile app]", popular: false },
      { id: "holiday", name: "Holiday special", desc: "Festive offers and seasonal cheer.", gradient: "g3", prompt: "A holiday special campaign for [winter gift boxes]", popular: false },
      { id: "event", name: "Live event", desc: "Promote webinars and conferences.", gradient: "g5", prompt: "A live event promotion for [annual design summit]", popular: false },
      { id: "feedback", name: "Community feedback", desc: "Gather insights and user stories.", gradient: "g7", prompt: "A community feedback campaign for [our beta release]", popular: false },
      { id: "retention", name: "Customer loyalty", desc: "Reward repeat buyers and advocates.", gradient: "g8", prompt: "A customer loyalty campaign for [our coffee club]", popular: false }
    ]
  },
  remix: {
    id: "remix",
    title: "What kind of game mod?",
    describePlaceholder: "Describe your mod or game change in one sentence",
    finish: "Download mod",
    styles: [
      { id: "fantasy", name: "Fantasy realm", desc: "Magical spells and medieval atmosphere.", gradient: "g1", prompt: "A fantasy realm mod adding [custom magical staffs]", popular: true },
      { id: "scifi", name: "Sci-fi universe", desc: "Spaceships and futuristic gear.", gradient: "g3", prompt: "A sci-fi universe mod adding [plasma blasters]", popular: false },
      { id: "survival", name: "Hardcore survival", desc: "Challenging mechanics and scarce resources.", gradient: "g2", prompt: "A hardcore survival mod featuring [temperature and hunger]", popular: false },
      { id: "cozy", name: "Cozy farming", desc: "Relaxing crops and friendly villagers.", gradient: "g4", prompt: "A cozy farming mod adding [giant golden pumpkins]", popular: false },
      { id: "racer", name: "High speed racer", desc: "Custom tracks and tuned vehicles.", gradient: "g5", prompt: "A high speed racer mod featuring [neon stunt tracks]", popular: false },
      { id: "retro", name: "Retro pixel", desc: "Nostalgic 8-bit art and sound.", gradient: "g7", prompt: "A retro pixel mod adding [classic arcade levels]", popular: false },
      { id: "chaos", name: "Sandbox chaos", desc: "Unpredictable fun and physics sandbox.", gradient: "g8", prompt: "A sandbox chaos mod featuring [gravity reversing tools]", popular: false }
    ]
  },
  // 0.4.28: the file paths. Each saves a real file; `ext` picks the kind of file when a style needs another one.
  spreadsheet: {
    id: "spreadsheet",
    title: "What kind of spreadsheet?",
    describePlaceholder: "Say what the sheet is for and what it should add up",
    finish: "Open spreadsheet",
    styles: [
      { id: "budget", name: "Budget", desc: "Money in, money out, and totals that add up.", gradient: "g4", prompt: "A budget for [my house: rent, food, gas]", popular: true },
      { id: "tracker", name: "Tracker", desc: "Track tasks, hours or habits by date.", gradient: "g1", prompt: "A tracker for [my daily workouts]", popular: false },
      { id: "invoice", name: "Invoice", desc: "Items, prices, tax and a total due.", gradient: "g2", prompt: "An invoice for [three hours of lawn care]", popular: false },
      { id: "schedule", name: "Schedule", desc: "Who does what, and when.", gradient: "g9", prompt: "A schedule for [my shop staff this week]", popular: false },
      { id: "sales", name: "Sales report", desc: "Sales by month with totals and averages.", gradient: "g5", prompt: "A sales report for [my bakery this year]", popular: false },
      { id: "inventory", name: "Inventory", desc: "Stock on hand and what to reorder.", gradient: "g7", prompt: "An inventory for [my shop shelves]", popular: false }
    ]
  },
  document: {
    id: "document",
    title: "What kind of document?",
    describePlaceholder: "Say who it is for and what it should say",
    finish: "Open document",
    styles: [
      { id: "letter", name: "Letter", desc: "A clear, polite letter ready to send.", gradient: "g1", prompt: "A letter to [my landlord about a repair]", popular: true },
      { id: "plan", name: "Plan", desc: "Goals, steps and dates on a page or two.", gradient: "g4", prompt: "A plan for [opening a food truck]", popular: false },
      { id: "guide", name: "Guide", desc: "How to do something, step by step.", gradient: "g5", prompt: "A guide to [closing the shop at night]", popular: false },
      { id: "resume", name: "Resume", desc: "Your work and skills on one page.", gradient: "g9", prompt: "A resume for [a store manager job]", popular: false },
      { id: "proposal", name: "Proposal", desc: "An offer with the work and the price.", gradient: "g2", prompt: "A proposal for [cleaning an office every week]", popular: false },
      { id: "notes", name: "Meeting notes", desc: "What was said and who does what next.", gradient: "g7", prompt: "Meeting notes for [our Monday team call]", popular: false }
    ]
  },
  slides: {
    id: "slides",
    title: "What kind of slides?",
    describePlaceholder: "Say what the talk is about and who will watch it",
    finish: "Open slides",
    styles: [
      { id: "pitch", name: "Pitch", desc: "Win someone over in a few slides.", gradient: "g8", prompt: "A pitch for [my bakery to a new investor]", popular: true },
      { id: "training", name: "Training", desc: "Teach a team how to do a job.", gradient: "g4", prompt: "Training on [how to greet customers]", popular: false },
      { id: "update", name: "Update", desc: "Where things stand and what is next.", gradient: "g1", prompt: "An update on [this month at the shop]", popular: false },
      { id: "sales", name: "Sales deck", desc: "What you sell and why it helps.", gradient: "g2", prompt: "A sales deck for [our cleaning service]", popular: false },
      { id: "lesson", name: "Lesson", desc: "A short class with one idea per slide.", gradient: "g5", prompt: "A lesson on [saving money each month]", popular: false },
      { id: "recap", name: "Event recap", desc: "What happened and the numbers.", gradient: "g9", prompt: "A recap of [our open house weekend]", popular: false }
    ]
  },
  script: {
    id: "script",
    title: "What kind of app or script?",
    describePlaceholder: "Say what the tool should do, step by step",
    finish: "Open file",
    styles: [
      { id: "python", name: "Python script", desc: "A small program that runs on your PC.", gradient: "g3", ext: "py", prompt: "A Python script that [renames photos by date]", popular: true },
      { id: "calculator", name: "Web calculator", desc: "One page that works in any browser.", gradient: "g1", ext: "html", prompt: "A web calculator for [tips and splitting the bill]", popular: false },
      { id: "powershell", name: "PowerShell", desc: "Handy jobs on Windows, like moving files.", gradient: "g9", ext: "ps1", prompt: "A PowerShell script that [cleans out my Downloads]", popular: false },
      { id: "sheets", name: "Google Sheets script", desc: "Adds a button or a job to a Google Sheet.", gradient: "g4", ext: "gs", prompt: "A Google Sheets script that [emails me new rows]", popular: false },
      { id: "javascript", name: "JavaScript program", desc: "A small program for Node on your PC.", gradient: "g5", ext: "js", prompt: "A JavaScript program that [checks my links]", popular: false },
      { id: "sql", name: "Database query", desc: "Pull the rows you need from a database.", gradient: "g7", ext: "sql", prompt: "A query that [finds customers who spent the most]", popular: false }
    ]
  },
  data: {
    id: "data",
    title: "What kind of list?",
    describePlaceholder: "Say what the list is about and which columns it needs",
    finish: "Open list",
    styles: [
      { id: "contacts", name: "Contacts", desc: "Names, phones and emails in columns.", gradient: "g1", prompt: "Contacts for [my best customers]", popular: true },
      { id: "products", name: "Products", desc: "Items, prices and how many are left.", gradient: "g2", prompt: "Products in [my shop]", popular: false },
      { id: "leads", name: "Leads", desc: "People to follow up with, and when.", gradient: "g4", prompt: "Leads from [the home show]", popular: false },
      { id: "events", name: "Events", desc: "Dates, places and times.", gradient: "g5", prompt: "Events for [our summer season]", popular: false },
      { id: "tasks", name: "To do list", desc: "Tasks, owners and due dates.", gradient: "g9", prompt: "A to do list for [moving the office]", popular: false },
      { id: "json", name: "Data for an app", desc: "The same list, ready for an app to read.", gradient: "g7", ext: "json", prompt: "Data for an app with [the menu items]", popular: false }
    ]
  }
};

export function pageOf(index, perPage) {
  const pp = perPage && perPage > 0 ? perPage : 1;
  return Math.floor((index || 0) / pp);
}

export function nextIndex(current, dir, count) {
  const c = count || 0;
  if (c <= 0) return 0;
  const next = (current || 0) + (dir || 0);
  return Math.max(0, Math.min(c - 1, next));
}

export function dotsFor(count, perPage) {
  const c = count || 0;
  const pp = perPage && perPage > 0 ? perPage : 1;
  return Math.ceil(c / pp);
}

// Lead integration (0.4.23 merge): the flow part names the Game mod path "mod" and reads styles through stylesFor(path).
export const PATH_ALIAS = { mod: "remix" };
export function pathData(path) { return PATHS[PATH_ALIAS[path] || path] || null; }
export function stylesFor(path) {
  const p = pathData(path);
  // title and style feed the flow's prompt ("Style: realistic photo"); prompt keeps the ready sentence with its [placeholder].
  return p ? p.styles.map((st) => ({ ...st, title: st.name, style: st.name.toLowerCase() })) : [];
}
