// Plain words for the People page (0.4.21, M42).
export function emptyTeamText(tier) {
  return tier === "extreme" || tier === "owner"
    ? "No team space yet. Open Together, make a team space, then invite people. They show up here."
    : "Chat with people you invite. Team spaces are part of Extreme.";
}
export function whoLine(me) {
  return !me || me === "you"
    ? "Your team sees you as \"you\". Sign in with Google or Microsoft in Settings so they see your email."
    : `Your team sees you as ${me}.`;
}

