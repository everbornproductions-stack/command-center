// Instagram publishing through the Meta Graph API (Instagram Content Publishing).
// Needs: a long-lived Page access token with instagram_basic + instagram_content_publish, and the IG user id.
// Media must be a public URL (image JPEG, or MP4 for reels). Two steps: create container → publish.
export const id = "instagram";
export const name = "Instagram";
const G = "https://graph.facebook.com/v21.0";

export function ready(secret) { return !!(secret?.key && secret?.igUserId); }

export function preview({ text, mediaUrl, mediaType }) {
  const problems = [];
  if (!mediaUrl) problems.push("Instagram needs a public image or video URL");
  if (mediaUrl && !/^https:\/\//.test(mediaUrl)) problems.push("Media URL must be https and publicly reachable");
  if ((text || "").length > 2200) problems.push("Caption over 2,200 characters");
  const tags = (text.match(/#\w+/g) || []).length; if (tags > 30) problems.push("More than 30 hashtags");
  return { channel: id, summary: `${mediaType === "video" ? "Reel" : "Photo"} to Instagram with a ${(text || "").length}-character caption`, problems };
}

export async function post(secret, { text, mediaUrl, mediaType }) {
  const base = `${G}/${secret.igUserId}`;
  const params = new URLSearchParams({ access_token: secret.key, caption: text || "" });
  if (mediaType === "video") { params.set("media_type", "REELS"); params.set("video_url", mediaUrl); } else params.set("image_url", mediaUrl);
  let r = await fetch(`${base}/media`, { method: "POST", body: params });
  let j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`Instagram container: ${j.error?.message || r.status}`);
  const creation = j.id;
  // videos need processing time; poll the container status
  if (mediaType === "video") {
    for (let i = 0; i < 40; i++) {
      await new Promise((s) => setTimeout(s, 5000));
      const st = await fetch(`${G}/${creation}?fields=status_code&access_token=${encodeURIComponent(secret.key)}`).then((x) => x.json()).catch(() => ({}));
      if (st.status_code === "FINISHED") break;
      if (st.status_code === "ERROR") throw new Error("Instagram could not process the video");
    }
  }
  r = await fetch(`${base}/media_publish`, { method: "POST", body: new URLSearchParams({ access_token: secret.key, creation_id: creation }) });
  j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error(`Instagram publish: ${j.error?.message || r.status}`);
  return { id: j.id, url: `https://www.instagram.com/p/${j.id}/` };
}
