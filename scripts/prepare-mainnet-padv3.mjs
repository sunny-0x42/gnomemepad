/**
 * Prepare mainnet upgrade cut: fixed ammmathv2 + padv3 under deploy/mainnet-v1.
 *
 * Why v2: live `â€¦/gnomi/ammmath` and `â€¦/gnomi/pad` are immutable and broken for
 * mainnet-scale k (VU0â‰ˆ102e9 Ã— VT0â‰ˆ1.073e9 â†’ Mul64 overflow). New creates go to
 * padv3 after hub SetModule("pad", padv3). GNOME 0000001 on old pad stays stuck.
 *
 * Copies:
 *   gno.land/p/gnomemepad/ammmath â†’ deploy/mainnet-v1/p/<deployer>/gnomi/ammmathv2
 *   gno.land/r/gnomemepad/pad     â†’ deploy/mainnet-v1/r/<deployer>/gnomi/padv3
 *
 * Rewrites (gnoland-1):
 *   - package ammmath â†’ ammmathv2; pad â†’ padv3
 *   - pad imports ammmath aliased to â€¦/gnomi/ammmathv2
 *   - gnomemepad â†’ gnomi (+ deployer path) for bond/pointsv2 refs
 *   - p/demo/tokens/grc20 â†’ p/nt/grc20/v0
 *   - r/demo/defi/grc20reg â†’ r/nt/grc20reg/v0
 *   - p/gnoswap/{consts,uint256} â†’ â€¦/v1
 *   - gnoswap_list_full.gno â†’ gnoswap_list.gno
 *   - VirtualUgnot0 + GraduationThreshold for 300k GNOT raise
 *   - strip *_test.gno
 *
 * Does NOT wipe other mainnet-v1 packages. Does NOT broadcast.
 *
 * Usage:
 *   node scripts/prepare-mainnet-padv3.mjs
 *   node scripts/prepare-mainnet-padv3.mjs --deployer g1n4pl5â€¦
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DEPLOYER = "g1n4pl5uc4yt5r96m9w6fmdznx3x0jyg8l6arhmt";
const NS_FROM = "gnomemepad";
const NS_TO = "gnomi";

const MAINNET_VIRTUAL_UGNOT0 = "102_375_071_625"; // ~102_375 GNOT
const MAINNET_GRADUATION = "300_000_000_000"; // 300_000 GNOT
const MAINNET_CREATE_BOND_FALLBACK = "150_000_000"; // 150 GNOT fallback

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

function rewriteCommon(text, deployer) {
  let out = text;
  out = out.replaceAll(`gno.land/r/${NS_FROM}/`, `gno.land/r/${deployer}/${NS_TO}/`);
  out = out.replaceAll(`gno.land/p/${NS_FROM}/`, `gno.land/p/${deployer}/${NS_TO}/`);
  out = out.replace(
    new RegExp(`gno\\.land/(r|p)/g1[a-z0-9]+/${NS_FROM}/`, "g"),
    `gno.land/$1/${deployer}/${NS_TO}/`,
  );
  out = out.replace(
    new RegExp(`module = "gno\\.land/(r|p)/[^"]*/${NS_FROM}/`, "g"),
    `module = "gno.land/$1/${deployer}/${NS_TO}/`,
  );

  out = out.replaceAll(
    "gno.land/p/demo/tokens/grc20",
    "gno.land/p/nt/grc20/v0",
  );
  out = out.replaceAll(
    "gno.land/r/demo/defi/grc20reg",
    "gno.land/r/nt/grc20reg/v0",
  );

  out = out.replaceAll(
    `"gno.land/p/gnoswap/consts"`,
    `"gno.land/p/gnoswap/consts/v1"`,
  );
  out = out.replaceAll(
    `"gno.land/p/gnoswap/uint256"`,
    `"gno.land/p/gnoswap/uint256/v1"`,
  );
  out = out.replaceAll(
    "gno.land/p/gnoswap/uint256\"",
    "gno.land/p/gnoswap/uint256/v1\"",
  );
  out = out.replaceAll(
    "gno.land/p/gnoswap/consts\"",
    "gno.land/p/gnoswap/consts/v1\"",
  );

  out = out.replace(/# gnomemepad\b/g, "# gnomi");
  return out;
}

function patchPadParams(text) {
  let out = text;
  out = out.replace(
    /VirtualUgnot0 int64 = 3_500_000_000[^\n]*/,
    `VirtualUgnot0 int64 = ${MAINNET_VIRTUAL_UGNOT0} // mainnet: max raise â‰¥ 300k GNOT`,
  );
  out = out.replace(
    /GraduationThreshold int64 = 10_000_000_000[^\n]*/,
    `GraduationThreshold int64 = ${MAINNET_GRADUATION} // 300_000 GNOT (SetGraduationThreshold later)`,
  );
  out = out.replace(
    /CreateBondUgnot int64 = 2_000_000/,
    `CreateBondUgnot int64 = ${MAINNET_CREATE_BOND_FALLBACK} // 150 GNOT fallback; live = bond realm`,
  );
  // Comment above VirtualUgnot0 (â‰ˆ may be ASCII or unicode)
  out = out.replace(
    /(?:Pearl default|Mainnet): VU0[^\n]*\n\t\/\/ DefaultGraduationThreshold[^\n]*/,
    `Mainnet: VU0â‰ˆ102.375e9 + VT0â‰ˆ1.073e9 => max raise â‰ˆ300k GNOT so\n\t// DefaultGraduationThreshold 300_000 GNOT is reachable before sold-out.`,
  );
  return out;
}

function rewriteAmmmathv2File(text) {
  let out = text;
  out = out.replace(/^package ammmath\b/m, "package ammmathv2");
  // Keep panic strings stable for ops ("ammmath: â€¦") â€” no change required.
  return out;
}

function rewritepadv3File(text, deployer) {
  const ammPath = `gno.land/p/${deployer}/${NS_TO}/ammmathv2`;
  let out = text;
  out = out.replace(/^package pad\b/m, "package padv3");
  // Alias import so call sites stay ammmath.X while package path is ammmathv2.
  // Use (?!v2) so we never rewrite â€¦/ammmathv2 â†’ â€¦/ammmathv2v2.
  out = out.replace(
    new RegExp(`"gno\\.land/p/${NS_FROM}/ammmath"(?!v)`, "g"),
    `ammmath "${ammPath}"`,
  );
  out = out.replace(
    new RegExp(`"gno\\.land/p/${deployer}/${NS_TO}/ammmath"(?!v)`, "g"),
    `ammmath "${ammPath}"`,
  );
  // Bare path leftovers (comments) â€” only exact â€¦/ammmath not followed by v2
  out = out.replace(
    new RegExp(`gno\\.land/p/${NS_FROM}/ammmath(?!v2)`, "g"),
    ammPath,
  );
  out = out.replace(
    new RegExp(`gno\\.land/p/${deployer}/${NS_TO}/ammmath(?!v2)`, "g"),
    ammPath,
  );
  out = rewriteCommon(out, deployer);
  // rewriteCommon maps gnomemepad/ammmath â†’ â€¦/gnomi/ammmath; fix again if needed
  out = out.replace(
    new RegExp(`"gno\\.land/p/${deployer}/${NS_TO}/ammmath"(?!v)`, "g"),
    `ammmath "${ammPath}"`,
  );
  out = out.replace(
    new RegExp(`gno\\.land/p/${deployer}/${NS_TO}/ammmath(?!v2)`, "g"),
    ammPath,
  );
  return out;
}

async function rewriteTree(dir, rewriter) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await rewriteTree(p, rewriter);
      continue;
    }
    if (!/\.(gno|toml|md)$/i.test(e.name)) continue;
    const raw = await fs.readFile(p, "utf8");
    const next = rewriter(raw, e.name, dir);
    if (next !== raw) await fs.writeFile(p, next, "utf8");
  }
}

async function installFullGnoswapList(padDir, deployer) {
  const fullSrc = path.join(ROOT, "deploy", "templates", "gnoswap_list_full.gno");
  if (!(await exists(fullSrc))) {
    throw new Error(`missing ${fullSrc}`);
  }
  let body = await fs.readFile(fullSrc, "utf8");
  body = rewritepadv3File(body, deployer);
  await fs.writeFile(path.join(padDir, "gnoswap_list.gno"), body, "utf8");
}

async function main() {
  const { deployer } = parseArgs(process.argv.slice(2));
  const outRoot = path.join(ROOT, "deploy", "mainnet-v1");
  await fs.mkdir(outRoot, { recursive: true });

  const ammSrc = path.join(ROOT, "gno.land", "p", NS_FROM, "ammmath");
  const padSrc = path.join(ROOT, "gno.land", "r", NS_FROM, "pad");
  if (!(await exists(ammSrc))) throw new Error(`missing ${ammSrc}`);
  if (!(await exists(padSrc))) throw new Error(`missing ${padSrc}`);

  const ammDest = path.join(outRoot, "p", deployer, NS_TO, "ammmathv2");
  const padDest = path.join(outRoot, "r", deployer, NS_TO, "padv3");

  if (await exists(ammDest)) await fs.rm(ammDest, { recursive: true, force: true });
  if (await exists(padDest)) await fs.rm(padDest, { recursive: true, force: true });

  await copyDir(ammSrc, ammDest, { stripTests: true });
  await rewriteTree(ammDest, (raw) => rewriteAmmmathv2File(raw));
  await fs.writeFile(
    path.join(ammDest, "gnomod.toml"),
    `module = "gno.land/p/${deployer}/${NS_TO}/ammmathv2"\ngno = "0.9"\n`,
    "utf8",
  );

  await copyDir(padSrc, padDest, { stripTests: true });
  await rewriteTree(padDest, (raw, name, dir) => {
    let next = rewritepadv3File(raw, deployer);
    if (name === "params.gno" && dir.replace(/\\/g, "/").endsWith("/padv3")) {
      next = patchPadParams(next);
    }
    return next;
  });
  await fs.writeFile(
    path.join(padDest, "gnomod.toml"),
    `module = "gno.land/r/${deployer}/${NS_TO}/padv3"\ngno = "0.9"\n`,
    "utf8",
  );
  await installFullGnoswapList(padDest, deployer);
  // Re-patch params after list install
  const paramsPath = path.join(padDest, "params.gno");
  {
    const raw = await fs.readFile(paramsPath, "utf8");
    const next = patchPadParams(raw);
    if (next !== raw) await fs.writeFile(paramsPath, next, "utf8");
  }

  // Sanity checks
  const ammBody = await fs.readFile(path.join(ammDest, "ammmath.gno"), "utf8");
  if (!ammBody.includes("package ammmathv2")) {
    throw new Error("ammmathv2 package clause missing");
  }
  if (!ammBody.includes("func MulDiv(")) {
    throw new Error("ammmathv2 missing MulDiv");
  }
  if (ammBody.includes("overflow.Mul64(virtualUgnot, virtualToken)")) {
    throw new Error("ammmathv2 still computes k via overflow.Mul64");
  }

  const memepad = await fs.readFile(path.join(padDest, "memepad.gno"), "utf8");
  if (!memepad.includes("package padv3")) {
    throw new Error("padv3 package clause missing");
  }
  if (!memepad.includes(`ammmath "gno.land/p/${deployer}/${NS_TO}/ammmathv2"`)) {
    throw new Error("padv3 must import ammmath aliased to ammmathv2");
  }
  if (memepad.includes(`/${NS_TO}/ammmath"`) && !memepad.includes("ammmathv2")) {
    throw new Error("padv3 still imports old ammmath path");
  }

  const params = await fs.readFile(paramsPath, "utf8");
  if (!params.includes(MAINNET_VIRTUAL_UGNOT0)) {
    throw new Error("padv3 params missing mainnet VirtualUgnot0");
  }
  if (!params.includes(MAINNET_GRADUATION)) {
    throw new Error("padv3 params missing mainnet GraduationThreshold");
  }

  const list = await fs.readFile(path.join(padDest, "gnoswap_list.gno"), "utf8");
  if (!list.includes("CreatePool(cross(cur),")) {
    throw new Error("padv3 gnoswap_list missing CreatePool");
  }
  if (!list.includes("gnoswap/consts/v1") && !list.includes("gnoswap/uint256/v1")) {
    // template may use either; warn soft if neither after rewrite
  }

  const packages = [
    {
      rel: `p/${deployer}/${NS_TO}/ammmathv2`,
      pkgpath: `gno.land/p/${deployer}/${NS_TO}/ammmathv2`,
    },
    {
      rel: `r/${deployer}/${NS_TO}/padv3`,
      pkgpath: `gno.land/r/${deployer}/${NS_TO}/padv3`,
    },
  ];

  const manifest = {
    at: new Date().toISOString(),
    cut: "padv3-ammmathv2",
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
    packages,
    note:
      "Upgrade cut only. Old â€¦/gnomi/ammmath + â€¦/gnomi/pad stay live but broken for large k. " +
      "GNOME 0000001 on old pad stays stuck. After addpkg: hub SetModule(\"pad\", padv3) with human yes. " +
      "No MAINNET_PAD_READY / no broadcast from this script.",
  };
  await fs.writeFile(
    path.join(outRoot, "MANIFEST_padv3.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log("Prepared mainnet padv3 upgrade cut under deploy/mainnet-v1/");
  for (const p of packages) console.log(`  - ${p.pkgpath}`);
  console.log(`Deployer: ${deployer}`);
  console.log(
    `Economics: VU0=${MAINNET_VIRTUAL_UGNOT0} grad=${MAINNET_GRADUATION}`,
  );
  console.log(
    "NOTE: GNOME 0000001 on old pad stays stuck; new creates go to padv3 after hub SetModule.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
