# Bumps Meldmind to a new version: package.json, package-lock.json, the version pins in tests, the help catalog,
# a What's new entry and one help article section. Usage:
#   python tools/bump-version.py OLD NEW notes.json
# notes.json: {"bullets": [...], "article": "docs/help/<file>.md", "heading": "...", "body": "..."}
import io, json, re, sys

old, new, notes_file = sys.argv[1], sys.argv[2], sys.argv[3]
notes = json.load(io.open(notes_file, encoding="utf-8"))

def rw(p, f):
    s = io.open(p, encoding="utf-8").read()
    io.open(p, "w", encoding="utf-8", newline="").write(f(s))

rw("package.json", lambda s: s.replace(f'"version": "{old}"', f'"version": "{new}"', 1))
rw("package-lock.json", lambda s: re.sub(r'("name": "[^"]+",\s*"version": )"' + re.escape(old) + '"', r'\1"' + new + '"', s, count=2))
for t in ["app-drivers", "apps", "getdone", "performance", "smarter-control", "workstream-d", "workstream-e"]:
    rw(f"test/{t}.test.js", lambda s: re.sub(r'(assert\.equal\([^\n]*?(?:version|lastUpdatedVersion)[^\n]*?)"' + re.escape(old) + '"', r'\1"' + new + '"', s))
rw("docs/help/catalog.json", lambda s: s.replace(f'"{old}"', f'"{new}"'))

news = json.load(io.open("docs/WHATS-NEW.json", encoding="utf-8"))
out = {new: {"title": "What's new in Meldmind", "bullets": notes["bullets"]}}
out.update(news)
io.open("docs/WHATS-NEW.json", "w", encoding="utf-8", newline="\n").write(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

p = notes["article"]
s = io.open(p, encoding="utf-8").read()
s = re.sub(r"lastUpdatedVersion: [0-9.]+", "lastUpdatedVersion: " + new, s, count=1).rstrip("\n")
s += "\n\n## " + notes["heading"] + " (" + new + ")\n\n" + notes["body"].strip() + "\n"
io.open(p, "w", encoding="utf-8", newline="").write(s)
print("bumped", old, "->", new)
