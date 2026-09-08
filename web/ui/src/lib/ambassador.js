/**
 * Ambassador Season 1: Signal Builders — static catalog (Option A).
 * Content submit open now; prize pool settles after mainnet Month-1.
 */

export const AMBASSADOR_S1 = {
  id: "amb-s1",
  nameEn: "Ambassador Season 1: Signal Builders",
  nameVi: "Ambassador Season 1: Signal Builders",
  taglineEn: "Teach the loop. Compete for a discretionary prize pool.",
  taglineVi: "Dạy vòng đời. Cạnh tranh prize pool discretionary.",
  /** ISO date — content / apply open from this day (UTC). */
  submitOpenDate: "2026-09-08",
  /** Prizes settle after mainnet Month-1 (Option A), not during Sapphire testnet. */
  prizeTimingEn: "Prize pool is calculated after gno.land mainnet launches (Month-1 ProtocolFeeAccrued).",
  prizeTimingVi:
    "Phân thưởng tính sau khi gno.land mainnet khởi chạy (ProtocolFeeAccrued Tháng 1).",
  metricEn: "Option A: PrizePool = 10% × ProtocolFeeAccrued (protocol’s 40% share of 1.20% curve fees on the active pad).",
  metricVi:
    "Option A: PrizePool = 10% × ProtocolFeeAccrued (phần protocol 40% của phí curve 1.20% trên pad active).",
};

export const AMBASSADOR_SPLIT = [
  { rank: 1, pct: 40 },
  { rank: 2, pct: 25 },
  { rank: 3, pct: 15 },
  { rank: 4, pct: 10 },
  { rank: 5, pct: 10 },
];

export const AMBASSADOR_RUBRIC = [
  { id: "content", en: "Content quality", vi: "Chất lượng nội dung", pct: 45 },
  { id: "referrals", en: "On-chain referrals (SetReferrer)", vi: "Referral on-chain (SetReferrer)", pct: 25 },
  {
    id: "volume",
    en: "Qualified curve volume brought (mainnet only)",
    vi: "Volume curve hợp lệ mang về (chỉ mainnet)",
    pct: 15,
  },
  { id: "quests", en: "Quests / consistency", vi: "Quest / duy trì", pct: 10 },
  { id: "community", en: "Community signal", vi: "Tín hiệu cộng đồng", pct: 5 },
];

/** Content pillar weight used when folding admin scores into leaderboard. */
export const CONTENT_WEIGHT = 45;

export function ambassadorRulesBlocks(vi) {
  if (vi) {
    return {
      nature: {
        title: "Bản chất chương trình",
        items: [
          "Contest discretionary của Gnomi Labs — không phải lương, APR, dividend hay sản phẩm đầu tư.",
          "Prize pool (Option A) = 10% × ProtocolFeeAccrued trong cửa sổ Month-1 trên mainnet (nếu có). Pool có thể = 0.",
          "Nộp đơn + submit bài viết / nội dung: mở từ hôm nay. Phân thưởng chỉ sau khi mainnet khởi chạy.",
          "Season 0 Points tách biệt — không đổi Points ra tiền.",
        ],
      },
      scoring: {
        title: "Cách chấm",
        items: [
          "Nội dung dạy loop: Create → curve → graduate → locked LP / Gnoswap (đúng facts).",
          "Referral on-chain: referee SetReferrer tới g1 của bạn + hoạt động curve thật.",
          "Trụ volume (15%): chỉ tính curve volume trên mainnet Month-1 — Sapphire testnet không tính.",
          "ExactIn Gnoswap sau list không tính volume Ambassador.",
          "Wash / sybil / hứa lợi nhuận = loại.",
        ],
      },
      payout: {
        title: "Giải thưởng",
        items: [
          "Top 5 chia pool: 40% / 25% / 15% / 10% / 10%.",
          "Chỉ Ambassadors đã approve + có ≥1 hành động scored trong cửa sổ mainnet Month-1.",
          "Có thể yêu cầu KYC / giới hạn địa lý trước khi trả giải.",
        ],
      },
    };
  }
  return {
    nature: {
      title: "What this is",
      items: [
        "A discretionary Gnomi Labs contest — not salary, APR, dividend, or an investment product.",
        "Prize pool (Option A) = 10% × ProtocolFeeAccrued in mainnet Month-1 (if any). Pool may be zero.",
        "Applications + content submissions open from today. Prizes settle only after mainnet launches.",
        "Season 0 Points stay separate — Points are not cash.",
      ],
    },
    scoring: {
      title: "How scoring works",
      items: [
        "Content that teaches Create → curve → graduate → locked LP / Gnoswap (correct facts).",
        "On-chain referrals: referee SetReferrer to your g1 + real curve activity.",
        "Volume pillar (15%): mainnet Month-1 curve volume only — Sapphire testnet does not count.",
        "Post-list Gnoswap ExactIn does not count toward Ambassador volume.",
        "Wash / sybil / promised profits = disqualification.",
      ],
    },
    payout: {
      title: "Prizes",
      items: [
        "Top 5 split of the pool: 40% / 25% / 15% / 10% / 10%.",
        "Only approved Ambassadors with ≥1 scored action in the mainnet Month-1 window.",
        "KYC / geography checks may apply before payout.",
      ],
    },
  };
}

export const G1_RE = /^g1[a-z0-9]{38,}$/i;

export function isSubmitOpen(now = Date.now()) {
  const start = Date.parse(`${AMBASSADOR_S1.submitOpenDate}T00:00:00Z`);
  if (!Number.isFinite(start)) return true;
  return now >= start;
}
