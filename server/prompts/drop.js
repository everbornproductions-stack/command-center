// The Prompts dropdown (flag_promptdrop, 0.4.19). Pure: no I/O, so the tests need no server.
// Groups for one creation box: Saved, Stage, From sources, Video. Recent is kept in the browser.
// The video tips and the realism checklist are original wording (Meldmind), written from public
// technique. Nothing here is sent anywhere.

export const GROUP_ORDER = ["recent", "saved", "stage", "sources", "video"];
export const GROUP_LABEL = { recent: "Recent", saved: "Saved", stage: "Stage", sources: "From sources", video: "Video" };
export const LIMITS = { saved: 6, stage: 6, sources: 6, video: 8, videoAll: 50 };

// Which pack categories fit each creation box (the box id is the stage). videoGroup: show the Video group.
export const STAGES = {
  orders: { label: "Marching orders", cats: [], videoGroup: true },
  "im-prompt": { label: "Images", cats: ["images and design"], videoGroup: false },
  "md-prompt": { label: "Media", cats: ["video", "images and design"], videoGroup: true, videoAll: true },
  "remix-idea": { label: "Remix", cats: ["creators", "social media", "video"], videoGroup: true },
  "remix-looks": { label: "Remix", cats: ["creators", "social media", "video"], videoGroup: true },
  "builders-need": { label: "Builders", cats: ["builders"], videoGroup: false },
  "bd-notice": { label: "Web builders", cats: ["social media", "marketing and ads", "video"], videoGroup: true },
};

export function stageFor(id) {
  const key = String(id || "").trim();
  return STAGES[key] ? key : "orders";
}

export const isVideoPack = (row) => row?.group === "video";

const keep = (row) => ({
  id: row.id,
  title: row.title || row.name || "",
  prompt: row.prompt || row.text || row.title || row.name || "",
  category: row.category || "",
  tag: row.tag || "",
  tips: row.tips || "",
  realism: row.realism || "",
  source_name: row.source_name || "",
  source_url: row.source_url || "",
  fresh: !!row.fresh,
});

// weekly: ranked pack rows (video pack included when the flag is on). saved: the person's own prompts.
export function buildDrop({ stage, weekly = [], saved = [], videoOn = true } = {}) {
  const key = stageFor(stage);
  const spec = STAGES[key];
  const pool = (weekly || []).filter(Boolean);
  const groups = [];
  const savedRows = (saved || []).slice(0, LIMITS.saved).map((r) => keep({ ...r, tag: "Saved" }));
  if (savedRows.length) groups.push({ id: "saved", label: GROUP_LABEL.saved, items: savedRows });

  const stageRows = pool
    .filter((r) => !isVideoPack(r) && (spec.cats.length ? spec.cats.includes(r.category) : true))
    .slice(0, LIMITS.stage).map((r) => keep({ ...r, tag: spec.label }));
  if (stageRows.length) groups.push({ id: "stage", label: GROUP_LABEL.stage, items: stageRows });

  // Prompts that name where they came from. Meldmind's own rows have no link, so they are not listed here.
  const sourceRows = pool
    .filter((r) => !isVideoPack(r) && r.source_url && (!spec.cats.length || spec.cats.includes(r.category)))
    .filter((r) => !stageRows.some((s) => s.id === r.id))
    .slice(0, LIMITS.sources).map((r) => keep({ ...r, tag: r.source_name || "Source" }));
  if (sourceRows.length) groups.push({ id: "sources", label: GROUP_LABEL.sources, items: sourceRows });

  if (videoOn && spec.videoGroup) {
    const vids = pool.filter(isVideoPack).slice(0, spec.videoAll ? LIMITS.videoAll : LIMITS.video).map((r) => keep({ ...r, tag: "Video" }));
    if (vids.length) groups.push({ id: "video", label: GROUP_LABEL.video, items: vids });
  }
  return { stage: key, groups };
}

// Per-tool tips for the video, reel and music-video builders. Short, plain, original.
export const VIDEO_TOOLS = [
  { id: "kling", name: "Kling", tips: [
    "Start from a real photo as the first frame. It keeps the face and the place right.",
    "Good for faces and people. Ask for one action and one camera move.",
    "Try the fast setting 2 or 3 times before you pay for a quality render.",
  ] },
  { id: "veo", name: "Veo", tips: [
    "Write one scene in plain sentences: who, where, one action, one camera move.",
    "Add the sound you want in a short line. Leave out words people must say.",
    "Keep clips short. Cut several short clips together instead of one long one.",
  ] },
  { id: "runway", name: "Runway", tips: [
    "Say what you want, not what to avoid. Write \"calm face, mouth closed\" instead of \"no talking\".",
    "Works well from a still image. Describe only the move, not the picture again.",
    "Interiors and products hold their shape best with a slow push-in or a slow pan.",
  ] },
  { id: "luma", name: "Luma", tips: [
    "Slow, simple camera moves read as real. Orbits are harder, so keep the subject simple.",
    "Use a clean first frame with room around the subject for the move.",
    "If an edge bends, crop in a little in the edit instead of making it again.",
  ] },
  { id: "lipsync", name: "Lip sync (Sync.so or similar)", tips: [
    "Make the clip silent with a closed mouth, then add the voice or song in the lip sync step.",
    "Use 2 to 3 second shots. Side and back angles hide small mouth errors.",
    "Cut lip sync shots to the chorus or the line, not the whole song.",
  ] },
];

// The realism checklist (Chris's house rules). Same list for every video builder.
export const REALISM_CHECKLIST = [
  "One subject, one action, one camera move.",
  "Mouth mostly closed. Add singing or talking in a separate step.",
  "One tiny natural beat: a blink, a sigh, a look down.",
  "No exaggerated motion, no big smiles, no fast turns.",
  "No text, logos, prices or phone numbers in the prompt. Add them in the edit.",
  "Set the shape and length in the tool, not in the prompt.",
  "Fix it in the edit first: trim, crop, speed, cut on the beat.",
  "Try again once at most. Then change the first frame, not the words.",
  "Label made-up customers or agents as a dramatization where the rules need it.",
];

export function videoTips() {
  return { tools: VIDEO_TOOLS, checklist: REALISM_CHECKLIST };
}
