import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "images");

const tokens = [
  {
    sym: "JAE",
    name: "Jaekwon",
    file: "JAE.jpg",
    mime: "image/jpeg",
    out: "r_g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr_gnomemepad_padv22_jae.svg",
  },
  {
    sym: "GNOMIES",
    name: "Gnomies",
    file: "GNOMIES.jpg",
    mime: "image/jpeg",
    out: "r_g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr_gnomemepad_padv22_gnomies.svg",
  },
  {
    sym: "TARDI",
    name: "Tardi",
    file: "TARDI.jpg",
    mime: "image/jpeg",
    out: "r_g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr_gnomemepad_padv22_tardi.svg",
  },
];

const pkg = "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv22";

for (const t of tokens) {
  const b64 = fs.readFileSync(path.join(dir, t.file)).toString("base64");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${t.sym}">
  <defs>
    <clipPath id="c"><circle cx="64" cy="64" r="64"/></clipPath>
  </defs>
  <circle cx="64" cy="64" r="64" fill="#11141c"/>
  <image href="data:${t.mime};base64,${b64}" x="0" y="0" width="128" height="128" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>
</svg>
`;
  fs.writeFileSync(path.join(dir, t.out), svg);
  console.log("svg", t.out, fs.statSync(path.join(dir, t.out)).size);
}

const basePath = path.join(__dirname, "sapphire-1.base.json");
let base = [];
if (fs.existsSync(basePath)) {
  base = JSON.parse(fs.readFileSync(basePath, "utf8"));
} else {
  // fallback fetch was saved earlier under TEMP — try that
  const alt = path.join(process.env.TEMP || "/tmp", "saph.json");
  if (fs.existsSync(alt)) base = JSON.parse(fs.readFileSync(alt, "utf8"));
}

const add = tokens.map((t) => ({
  name: t.name,
  token_path: `${pkg}.${t.sym}`,
  pkg_path: pkg,
  symbol: t.sym,
  decimals: 0,
  chain_id: "sapphire-1",
  description: `${t.name} ($${t.sym}) launched on gnomemepad (Sapphire testnet).`,
  website_url: "https://gnomemepad-sapphire.netlify.app",
  twitter_url: "",
  discord_url: "",
  docs_url: "",
  image: `/grc20/images/${t.out}`,
}));

const paths = new Set(base.map((x) => x.token_path));
const merged = [...base];
for (const e of add) {
  if (!paths.has(e.token_path)) merged.push(e);
}

fs.writeFileSync(path.join(__dirname, "sapphire-1.json"), JSON.stringify(merged, null, 2) + "\n");
fs.writeFileSync(path.join(__dirname, "entries-only.json"), JSON.stringify(add, null, 2) + "\n");
console.log("merged", merged.length, "added", add.length);
