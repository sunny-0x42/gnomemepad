/**
 * Replace fancy Unicode / mojibake in .gno sources with plain ASCII.
 * Prevents "â€"" / "â†'" on-chain after Windows prepare scripts mangle UTF-8.
 */
import fs from "fs";
import path from "path";

const roots = [
  path.resolve("gno.land/r/gnomemepad/pad"),
  path.resolve("deploy/templates"),
];

const reps = [
  [/\u2014/g, "-"], // em dash
  [/\u2013/g, "-"], // en dash
  [/\u2192/g, "->"], // right arrow
  [/\u2190/g, "<-"], // left arrow
  [/\u00b7/g, " | "], // middle dot
  [/\u2265/g, ">="], // >=
  [/\u2264/g, "<="], // <=
  [/\u2248/g, "~"], // approx
  [/\u00d7/g, "x"], // multiply
  [/\u2260/g, "!="], // not equal
  [/\u2026/g, "..."], // ellipsis
  // UTF-8 bytes of those chars mis-decoded as Windows-1252 / latin1
  [/\u00e2\u20ac\u201d/g, "-"], // â€”
  [/\u00e2\u20ac\u201c/g, "-"], // â€œ (rare)
  [/\u00e2\u20ac\u201c/g, "-"],
  [/\u00e2\u20ac\u2013/g, "-"], // â€“
  [/\u00e2\u20ac\u2122/g, "'"], // â€™
  [/\u00e2\u2020\u2019/g, "->"], // â†’
  [/\u00e2\u2020\u2018/g, "<-"], // â†
  [/\u00c2\u00b7/g, " | "], // Â·
  [/\u00e2\u2030\u00a5/g, ">="], // â‰¥
  [/\u00e2\u2030\u00a4/g, "<="], // â‰¤
  [/\u00e2\u2030\u02c6/g, "~"], // â‰ˆ
  [/\u00c3\u2014/g, "x"], // Ã— (sometimes)
  [/\u00c3\u97/g, "x"],
  [/\u00e2\u20ac\u00a6/g, "..."], // â€¦
];

// Also match common mojibake as UTF-8 source already corrupted (literal sequences)
const lit = [
  ["\u00e2\u0080\u0094", "-"], // â€” in utf8 as three chars e2 80 94
  ["\u00e2\u0080\u0093", "-"],
  ["\u00e2\u0086\u0092", "->"],
  ["\u00e2\u0086\u0090", "<-"],
  ["\u00c2\u00b7", " | "],
  ["\u00e2\u0089\u00a5", ">="],
  ["\u00e2\u0089\u00a4", "<="],
  ["\u00e2\u0089\u0088", "~"],
  ["\u00c3\u0097", "x"],
  ["\u00e2\u0080\u00a6", "..."],
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".gno")) out.push(p);
  }
  return out;
}

const files = roots.flatMap((r) => walk(r));
let changed = 0;
for (const f of files) {
  let c = fs.readFileSync(f, "utf8");
  const orig = c;
  for (const [re, to] of reps) c = c.replace(re, to);
  for (const [from, to] of lit) {
    while (c.includes(from)) c = c.split(from).join(to);
  }
  // Byte-level fix: if file was saved as latin1 mojibake of utf8, re-decode
  // Heuristic: look for classic "Meme launchpad" corruption
  if (c.includes("\u00e2") || c.includes("\u00c2")) {
    try {
      const buf = Buffer.from(c, "latin1");
      const asUtf8 = buf.toString("utf8");
      if (!asUtf8.includes("\uFFFD") && (asUtf8.includes("\u2014") || asUtf8.includes("\u2192"))) {
        c = asUtf8;
        for (const [re, to] of reps) c = c.replace(re, to);
      }
    } catch {
      /* keep */
    }
  }
  if (c !== orig) {
    fs.writeFileSync(f, c, "utf8");
    console.log("fixed", path.relative(process.cwd(), f));
    changed++;
  } else {
    console.log("ok   ", path.relative(process.cwd(), f));
  }
}
console.log("done;", changed, "files changed;", files.length, "scanned");
