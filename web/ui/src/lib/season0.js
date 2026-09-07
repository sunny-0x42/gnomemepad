/**
 * Season 0: Curve Camp — static catalog (quests, badges, rules).
 * Live progress comes from /api/season0 + /api/points.
 * Points are discretionary scores — not cash, not investment returns.
 */

export const SEASON0 = {
  id: "s0",
  nameEn: "Season 0: Curve Camp",
  nameVi: "Season 0: Trại curve",
  taglineEn: "Learn the loop. Leave the hype.",
  taglineVi: "Học vòng đời. Bỏ hype.",
  network: "sapphire",
  /** Set when ops enables points; null = “starts when points go live”. */
  startHeight: null,
  endHeight: null,
  startLabelEn: "Starts when points are enabled on Sapphire",
  startLabelVi: "Bắt đầu khi bật points trên Sapphire",
};

/** On-chain pointsv2 defaults (overridden by API params when present). */
export const POINT_TABLE = [
  {
    id: "checkin",
    en: "Check-in",
    vi: "Check-in",
    pts: "+5",
    noteEn: "Every ~100 heights",
    noteVi: "Mỗi ~100 height",
  },
  {
    id: "referrer",
    en: "Referrer bonus",
    vi: "Thưởng người giới thiệu",
    pts: "+50",
    noteEn: "Once per referee",
    noteVi: "Một lần / referee",
  },
  {
    id: "referee",
    en: "Referee bonus",
    vi: "Thưởng người được giới thiệu",
    pts: "+25",
    noteEn: "When you set a referrer",
    noteVi: "Khi set referrer",
  },
  {
    id: "create",
    en: "Create launch",
    vi: "Tạo launch",
    pts: "+30",
    noteEn: "Pad hook · shares height cap",
    noteVi: "Pad hook · chung height cap",
  },
  {
    id: "buy",
    en: "Curve Buy",
    vi: "Buy trên curve",
    pts: "+2 + 10×GNOT",
    noteEn: "≤200 pts / height",
    noteVi: "≤200 pts / height",
  },
  {
    id: "sell",
    en: "Curve Sell",
    vi: "Sell trên curve",
    pts: "+1 + 3×GNOT",
    noteEn: "Buy weighs more than sell",
    noteVi: "Buy nặng điểm hơn Sell",
  },
];

export const QUESTS = [
  {
    id: "wallet_wake",
    kind: "ui",
    titleEn: "Wallet Wake",
    titleVi: "Đánh thức ví",
    descEn: "Connect Adena on Sapphire. You’re in Curve Camp.",
    descVi: "Kết nối Adena trên Sapphire. Bạn đã vào Trại curve.",
    action: "connect",
    badgeId: "adena_awake",
    target: 1,
    comingSoon: false,
  },
  {
    id: "first_dip",
    kind: "trade",
    titleEn: "First Dip",
    titleVi: "Nhấp curve đầu",
    descEn: "Make a curve Buy (≥ 0.5 GNOT) with WUGNOT via Adena.",
    descVi: "Buy trên curve (≥ 0.5 GNOT) bằng WUGNOT qua Adena.",
    action: "link",
    href: "/",
    badgeId: "curve_sip",
    target: 1,
    comingSoon: false,
  },
  {
    id: "two_way",
    kind: "trade",
    titleEn: "Two-Way Street",
    titleVi: "Hai chiều",
    descEn: "Complete a curve Sell back to WUGNOT.",
    descVi: "Sell trên curve về WUGNOT.",
    action: "link",
    href: "/",
    badgeId: "both_sides",
    target: 1,
    comingSoon: false,
  },
  {
    id: "first_5_markets",
    kind: "trade",
    titleEn: "Market Hopper",
    titleVi: "Nhảy 5 market",
    descEn: "Buy ≥ 0.5 GNOT on 5 different curve launches.",
    descVi: "Buy ≥ 0.5 GNOT trên 5 launch curve khác nhau.",
    action: "link",
    href: "/",
    badgeId: "market_hopper",
    target: 5,
    bonusPts: 100,
    comingSoon: false,
  },
  {
    id: "check_in",
    kind: "onchain",
    titleEn: "Daily Check-in",
    titleVi: "Check-in ngày",
    descEn: "Call CheckIn on the points realm (about every 100 heights).",
    descVi: "Gọi CheckIn trên points realm (khoảng mỗi 100 height).",
    action: "checkIn",
    badgeId: null,
    target: 1,
    comingSoon: false,
  },
  {
    id: "streak_7",
    kind: "onchain",
    titleEn: "Streak 7",
    titleVi: "Chuỗi 7",
    descEn: "Seven valid check-ins spaced ≥ 100 heights apart during the season.",
    descVi: "7 check-in hợp lệ, cách nhau ≥ 100 height trong season.",
    action: "checkIn",
    badgeId: "streaker",
    target: 7,
    bonusPts: 40,
    comingSoon: false,
  },
  {
    id: "set_referrer",
    kind: "onchain",
    titleEn: "Set a referrer",
    titleVi: "Gắn referrer",
    descEn: "One-time: set a friend’s g1… as referrer (+25 you / +50 them).",
    descVi: "Một lần: set g1… bạn bè làm referrer (+25 bạn / +50 họ).",
    action: "setReferrer",
    badgeId: "scout",
    target: 1,
    comingSoon: false,
  },
  {
    id: "curve_native",
    kind: "trade",
    titleEn: "Curve Native",
    titleVi: "Người curve",
    descEn: "Accumulate ≥ 10 GNOT of curve Buys in Season 0.",
    descVi: "Tích lũy ≥ 10 GNOT Buy trên curve trong Season 0.",
    action: "link",
    href: "/",
    badgeId: null,
    target: 10,
    bonusPts: 50,
    comingSoon: false,
  },
  {
    id: "loop_scribe",
    kind: "content",
    titleEn: "Loop Explainer",
    titleVi: "Giải thích vòng đời",
    descEn: "Write a short fair-launch walkthrough (create → curve → graduate → locked LP). No price calls.",
    descVi: "Viết walkthrough ngắn (create → curve → graduate → LP lock). Không gọi giá.",
    action: "coming",
    badgeId: "loop_scribe",
    target: 1,
    comingSoon: true,
  },
  {
    id: "adena_clip",
    kind: "content",
    titleEn: "Adena Clip",
    titleVi: "Clip Adena",
    descEn: "30–90s screen recording: Adena on Sapphire + a curve Buy.",
    descVi: "Clip 30–90s: Adena trên Sapphire + Buy trên curve.",
    action: "coming",
    badgeId: "sign_cap",
    target: 1,
    comingSoon: true,
  },
  {
    id: "lock_artist",
    kind: "content",
    titleEn: "Lock Lore",
    titleVi: "Truyện lock LP",
    descEn: "Meme / comic / 1-pager on graduate → locked LP. Funny OK. Financial promises not OK.",
    descVi: "Meme / comic / 1-pager về graduate → LP khóa. Vui được; hứa lời thì không.",
    action: "coming",
    badgeId: "lock_artist",
    target: 1,
    comingSoon: true,
  },
];

export const BADGES = [
  {
    id: "curve_camper",
    titleEn: "Curve Camper",
    titleVi: "Người trại curve",
    icon: "⛺",
    rule: "any_quest",
  },
  {
    id: "adena_awake",
    titleEn: "Adena Awake",
    titleVi: "Adena tỉnh",
    icon: "🔌",
    rule: "quest:wallet_wake",
  },
  {
    id: "curve_sip",
    titleEn: "Curve Sip",
    titleVi: "Nhấp curve",
    icon: "💧",
    rule: "quest:first_dip",
  },
  {
    id: "both_sides",
    titleEn: "Both Sides",
    titleVi: "Hai chiều",
    icon: "⇄",
    rule: "quest:two_way",
  },
  {
    id: "market_hopper",
    titleEn: "Market Hopper",
    titleVi: "Nhảy market",
    icon: "🦘",
    rule: "quest:first_5_markets",
  },
  {
    id: "streaker",
    titleEn: "Streaker",
    titleVi: "Chuỗi check-in",
    icon: "🔥",
    rule: "quest:streak_7",
  },
  {
    id: "scout",
    titleEn: "Scout",
    titleVi: "Scout",
    icon: "🧭",
    rule: "quest:set_referrer",
  },
  {
    id: "loop_scribe",
    titleEn: "Loop Scribe",
    titleVi: "Người chép loop",
    icon: "✍️",
    rule: "quest:loop_scribe",
  },
  {
    id: "sign_cap",
    titleEn: "Sign Cap",
    titleVi: "Nón ký",
    icon: "🎥",
    rule: "quest:adena_clip",
  },
  {
    id: "lock_artist",
    titleEn: "Lock Artist",
    titleVi: "Họa sĩ lock",
    icon: "🎨",
    rule: "quest:lock_artist",
  },
  {
    id: "s0_top20",
    titleEn: "Season 0 Top 20",
    titleVi: "Top 20 Season 0",
    icon: "🏆",
    rule: "rank_le_20",
  },
];

export function rulesBlocks(vi) {
  if (vi) {
    return {
      nature: {
        title: "Bản chất Points",
        items: [
          "Points Season 0 do Gnomi Labs quyết định tùy ý: có thể đổi, tạm dừng, hoặc không chuyển thành gì cả.",
          "Points không phải tiền, không phải sản phẩm đầu tư, không phải lời hứa trả thưởng.",
          "Tham gia = dùng sản phẩm / làm quest; không mua quyền nhận Points.",
        ],
      },
      scoring: {
        title: "Cách chấm điểm",
        items: [
          "Điểm on-chain từ pointsv2: CheckIn, Referral, Create, Buy/Sell trên bonding curve (pad).",
          "Season Score ưu tiên trade trên curve. ExactIn Gnoswap sau list = 0 điểm Season.",
          "Anti-spam: tối đa 200 trade/create pts mỗi địa chỉ mỗi height. Buy nặng điểm hơn Sell.",
          "Quest bonus (unique markets, streak…) tính vào Season Score khi API xác nhận tiến độ.",
        ],
      },
      networks: {
        title: "Testnet vs Mainnet",
        items: [
          "Hoạt động trên Sapphire testnet không tự động mang sang mainnet.",
          "Token / số dư testnet không có giá trị mainnet.",
          "Snapshot hoặc quy đổi sau Season (nếu có) sẽ công bố riêng — có thể bằng 0.",
        ],
      },
      abuse: {
        title: "Chống lạm dụng",
        items: [
          "Cấm sybil / farm nhiều ví, bot spam, wash trade, giả referral, giả engagement.",
          "Gnomi có thể trừ / khóa / hủy Points và loại khỏi Season nếu nghi gian lận.",
        ],
      },
      fairness: {
        title: "Content creator ≠ Token creator",
        items: [
          "Quest nội dung (nếu mở) thưởng tiến độ / amplify — không cấp quyền mint token.",
          "Launch trên gnomi.fun là permissionless: Gnomi không phát hành / bảo chứng mọi meme.",
        ],
      },
      cash: {
        title: "Không bảo đảm tiền mặt",
        items: [
          "Không đảm bảo cash, USDC, GNOT, airdrop hay bất kỳ khoản trả nào từ Points.",
          "Không gắn Points với APR, FDV, hay “sẽ pump”.",
        ],
      },
    };
  }
  return {
    nature: {
      title: "What Points are",
      items: [
        "Season 0 Points are discretionary: Gnomi Labs may change, pause, or cancel them — or convert them into nothing.",
        "Points are not money, not an investment product, and not a promise of payout.",
        "You earn them by using the product / completing quests — you do not buy Points.",
      ],
    },
    scoring: {
      title: "How scoring works",
      items: [
        "On-chain pointsv2 awards: CheckIn, Referral, Create, Buy/Sell on the bonding curve (pad).",
        "Season Score prioritizes curve trades. Post-list Gnoswap ExactIn earns 0 Season points.",
        "Anti-spam: max 200 trade/create pts per address per height. Buys weigh more than sells.",
        "Quest bonuses (unique markets, streak, …) count toward Season Score when progress is verified.",
      ],
    },
    networks: {
      title: "Testnet vs Mainnet",
      items: [
        "Sapphire testnet activity does not automatically carry to mainnet.",
        "Testnet tokens / balances have no mainnet value.",
        "Any post-season snapshot or conversion (if any) will be announced separately — it may be zero.",
      ],
    },
    abuse: {
      title: "Anti-abuse",
      items: [
        "No sybil farms, bots, wash trading, fake referrals, or fake engagement.",
        "Gnomi may deduct, freeze, or cancel Points and remove Season eligibility if abuse is suspected.",
      ],
    },
    fairness: {
      title: "Content creator ≠ Token creator",
      items: [
        "Content quests (if open) reward progress / amplify — they do not grant mint rights.",
        "Launches on gnomi.fun are permissionless: Gnomi does not issue or vouch for every meme.",
      ],
    },
    cash: {
      title: "No cash guarantees",
      items: [
        "No guaranteed cash, USDC, GNOT, airdrop, or any payout from Points.",
        "Points are not APR, FDV, or “will pump” language.",
      ],
    },
  };
}
