/**
 * Prepare mainnet deploy tree under deploy/mainnet-v1/ with package namespace **gnomi**.
 *
 * Copies source from gno.land/{r,p}/gnomemepad/* →
 *   deploy/mainnet-v1/{r,p}/<MAINNET_DEPLOYER>/gnomi/<module>
 *
 * Mainnet rewrites (gnoland-1):
 *   - gnomemepad → gnomi (+ deployer path)
 *   - p/demo/tokens/grc20 → p/nt/grc20/v0
 *   - r/demo/defi/grc20reg → r/nt/grc20reg/v0
 *   - p/gnoswap/{consts,uint256} → …/v1
 *   - pad: gnoswap_list_full.gno → gnoswap_list.gno
 *   - pad params: VirtualUgnot0 + GraduationThreshold for 300k GNOT raise
 *   - strip *_test.gno (smaller deposit)
 *
 * Does NOT broadcast. Human yes required for addpkg.
 *
 * Usage:
 *   node scripts/prepare-mainnet-gnomi.mjs
 *   node scripts/prepare-mainnet-gnomi.mjs --deployer g1n4pl5…
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DEPLOYER = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt";
const NS_FROM = "gnomemepad";
const NS_TO = "gnomi";

/** Max curve raise ≥ 300_000 GNOT with VT0=1_073_000_191, CurveSupply=800e6 */
const MAINNET_VIRTUAL_UGNOT0 = "102_375_071_625"; // ~102_375 GNOT
const MAINNET_GRADUATION = "300_000_000_000"; // 300_000 GNOT
const MAINNET_CREATE_BOND_FALLBACK = "150_000_000"; // 150 GNOT (bond realm owns live)

const REALM_MODULES = [
  "pad",
  "hubv2",
  "profile",
  "meta",
  "pointsv2",
  "bond",
];
// Live mainnet …/gnomi/ammmath is immutable + broken for large k.
// Full-tree prepare still emits …/ammmath from source for docs/history only.
// Upgrade cut (ammmathv2 + padv2) is scripts/prepare-mainnet-padv2.mjs — use that for mainnet fix.
const PURE_MODULES = ["ammmath"];

function parseArgs(argv) {
  let deployer = process.env.MAINNET_DEPLOYER || DEFAULT_DEPLOYER;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--deployer" && argv[i + 1]) deployer = argv[++i];
  }
  return { deployer };
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest, { stripTests = false } = {}) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to, { stripTests });
      continue;
    }
    if (stripTests && /_test\.gno$/i.test(e.name)) continue;
    await fs.copyFile(from, to);
  }
}

function rewriteText(text, deployer) {
  let out = text;
  // Unsigned source paths used in repo
  out = out.replaceAll(`gno.land/r/${NS_FROM}/`, `gno.land/r/${deployer}/${NS_TO}/`);
  out = out.replaceAll(`gno.land/p/${NS_FROM}/`, `gno.land/p/${deployer}/${NS_TO}/`);
  // Any deployer already baked with gnomemepad ns
  out = out.replace(
    new RegExp(`gno\\.land/(r|p)/g1[a-z0-9]+/${NS_FROM}/`, "g"),
    `gno.land/$1/${deployer}/${NS_TO}/`,
  );
  // gnomod.toml module = "…"
  out = out.replace(
    new RegExp(`module = "gno\\.land/(r|p)/[^"]*/${NS_FROM}/`, "g"),
    `module = "gno.land/$1/${deployer}/${NS_TO}/`,
  );

  // Mainnet GRC20 / registry (demo paths absent on gnoland-1)
  out = out.replaceAll(
    "gno.land/p/demo/tokens/grc20",
    "gno.land/p/nt/grc20/v0",
  );
  out = out.replaceAll(
    "gno.land/r/demo/defi/grc20reg",
    "gno.land/r/nt/grc20reg/v0",
  );

  // Gnoswap pures are /v1 on mainnet
  out = out.replaceAll(
    `"gno.land/p/gnoswap/consts"`,
    `"gno.land/p/gnoswap/consts/v1"`,
  );
  out = out.replaceAll(
    `"gno.land/p/gnoswap/uint256"`,
    `"gno.land/p/gnoswap/uint256/v1"`,
  );
  // Alias form: u256 "gno.land/p/gnoswap/uint256"
  out = out.replaceAll(
    "gno.land/p/gnoswap/uint256\"",
    "gno.land/p/gnoswap/uint256/v1\"",
  );
  out = out.replaceAll(
    "gno.land/p/gnoswap/consts\"",
    "gno.land/p/gnoswap/consts/v1\"",
  );

  // Render / comments branding (optional)
  out = out.replace(/# gnomemepad\b/g, "# gnomi");
  out = out.replace(/gnomemepad hubv2/g, "gnomi hubv2");
  out = out.replace(/gnomemepad points/g, "gnomi points");
  out = out.replace(/gnomemepad profiles/g, "gnomi profiles");
  out = out.replace(/gnomemepad create-bond/g, "gnomi create-bond");
  return out;
}

function patchPadParams(text) {
  let out = text;
  out = out.replace(
    /VirtualUgnot0 int64 = 3_500_000_000[^\n]*/,
    `VirtualUgnot0 int64 = ${MAINNET_VIRTUAL_UGNOT0} // mainnet: max raise ≥ 300k GNOT`,
  );
  out = out.replace(
    /GraduationThreshold int64 = 10_000_000_000[^\n]*/,
    `GraduationThreshold int64 = ${MAINNET_GRADUATION} // 300_000 GNOT (SetGraduationThreshold later)`,
  );
  out = out.replace(
    /CreateBondUgnot int64 = 2_000_000/,
    `CreateBondUgnot int64 = ${MAINNET_CREATE_BOND_FALLBACK} // 150 GNOT fallback; live = bond realm`,
  );
  // Comment block above VirtualUgnot0
  out = out.replace(
    /Pearl default: VU0=3\.5e9 \+ VT0≈1\.073e9 => max raise ≈10\.2k GNOT so\n\t\/\/ DefaultGraduationThreshold 10_000 GNOT is reachable before sold-out\./,
    `Mainnet: VU0≈102.375e9 + VT0≈1.073e9 => max raise ≈300k GNOT so\n\t// DefaultGraduationThreshold 300_000 GNOT is reachable before sold-out.`,
  );
  return out;
}

async function rewriteTree(dir, deployer) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await rewriteTree(p, deployer);
      continue;
    }
    if (!/\.(gno|toml|md)$/i.test(e.name)) continue;
    let raw = await fs.readFile(p, "utf8");
    let next = rewriteText(raw, deployer);
    if (e.name === "params.gno" && dir.replace(/\\/g, "/").endsWith("/pad")) {
      next = patchPadParams(next);
    }
    if (next !== raw) await fs.writeFile(p, next, "utf8");
  }
}

async function installFullGnoswapList(padDir, deployer) {
  const fullSrc = path.join(ROOT, "deploy", "templates", "gnoswap_list_full.gno");
  if (!(await exists(fullSrc))) {
    throw new Error(`missing ${fullSrc}`);
  }
  let body = await fs.readFile(fullSrc, "utf8");
  body = rewriteText(body, deployer);
  await fs.writeFile(path.join(padDir, "gnoswap_list.gno"), body, "utf8");
}

async function main() {
  const { deployer } = parseArgs(process.argv.slice(2));
  const outRoot = path.join(ROOT, "deploy", "mainnet-v1");
  if (await exists(outRoot)) {
    await fs.rm(outRoot, { recursive: true, force: true });
  }

  const copied = [];

  // Pure packages (historical …/ammmath only; live upgrade = prepare-mainnet-padv2.mjs)
  for (const name of PURE_MODULES) {
    const src = path.join(ROOT, "gno.land", "p", NS_FROM, name);
    if (!(await exists(src))) continue;
    const dest = path.join(outRoot, "p", deployer, NS_TO, name);
    await copyDir(src, dest, { stripTests: true });
    await rewriteTree(dest, deployer);
    await fs.writeFile(
      path.join(dest, "gnomod.toml"),
      `module = "gno.land/p/${deployer}/${NS_TO}/${name}"\ngno = "0.9"\n`,
      "utf8",
    );
    copied.push(`p/${deployer}/${NS_TO}/${name}`);
  }

  // Realms
  for (const name of REALM_MODULES) {
    const src = path.join(ROOT, "gno.land", "r", NS_FROM, name);
    if (!(await exists(src))) {
      console.warn(`[skip] missing source realm ${name}`);
      continue;
    }
    const dest = path.join(outRoot, "r", deployer, NS_TO, name);
    await copyDir(src, dest, { stripTests: true });
    await rewriteTree(dest, deployer);
    const modFile = path.join(dest, "gnomod.toml");
    await fs.writeFile(
      modFile,
      `module = "gno.land/r/${deployer}/${NS_TO}/${name}"\ngno = "0.9"\n`,
      "utf8",
    );
    if (name === "pad") {
      await installFullGnoswapList(dest, deployer);
      // Re-patch params after full list (already done in rewriteTree)
      const paramsPath = path.join(dest, "params.gno");
      if (await exists(paramsPath)) {
        const raw = await fs.readFile(paramsPath, "utf8");
        const next = patchPadParams(raw);
        if (next !== raw) await fs.writeFile(paramsPath, next, "utf8");
      }
    }
    copied.push(`r/${deployer}/${NS_TO}/${name}`);
  }

  const manifest = {
    at: new Date().toISOString(),
    deployer,
    namespace: NS_TO,
    chainId: "gnoland-1",
    rpc: "https://rpc.onbloc.xyz:443",
    economics: {
      virtualUgnot0: MAINNET_VIRTUAL_UGNOT0,
      graduationUgnot: MAINNET_GRADUATION,
      createBondFallbackUgnot: MAINNET_CREATE_BOND_FALLBACK,
      listFeeGns: "100_000_000",
      defaultVenue: "zdex",
    },
    rewrites: [
      "p/demo/tokens/grc20 → p/nt/grc20/v0",
      "r/demo/defi/grc20reg → r/nt/grc20reg/v0",
      "p/gnoswap/{consts,uint256} → …/v1",
      "gnoswap_list_full → gnoswap_list.gno",
      "strip *_test.gno",
    ],
    packages: copied.map((rel) => ({
      rel,
      pkgpath: `gno.land/${rel.replace(/\\/g, "/")}`,
    })),
    note: "Prepared only — GPAO may park addpkg. No MAINNET_PAD_READY.",
  };
  await fs.writeFile(
    path.join(outRoot, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log(`Prepared ${copied.length} packages under deploy/mainnet-v1/`);
  for (const c of copied) console.log(`  - gno.land/${c.replace(/\\/g, "/")}`);
  console.log(`Deployer: ${deployer}`);
  console.log(`Namespace: ${NS_TO}`);
  console.log(
    `Economics: VU0=${MAINNET_VIRTUAL_UGNOT0} grad=${MAINNET_GRADUATION} bondFallback=${MAINNET_CREATE_BOND_FALLBACK}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
