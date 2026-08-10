package pad

import (
	"chain"
	"testing"
)

func TestInitAndCreateBuy(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	if !inited {
		t.Fatal("not inited")
	}

	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Test Cat", "TCAT", "https://example.com/tcat")
	if id == "" {
		t.Fatal("empty id")
	}
	if ResolveSymbol("TCAT") != id {
		t.Fatal("symbol map")
	}
	if GetStatus(id) != StatusCurve {
		t.Fatal("status")
	}

	buyer := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 100000}})
	tok := Buy(cross(cur), id, 0)
	if tok <= 0 {
		t.Fatalf("tokens=%d", tok)
	}
	if BalanceOf(id, buyer) != tok {
		t.Fatalf("bal=%d want %d", BalanceOf(id, buyer), tok)
	}
	if GetRaised(id) <= 0 {
		t.Fatal("raised")
	}
}

func TestSellCurve(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))

	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Dog", "DOG", "")
	testing.SkipHeights(21)

	buyer := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 500000}})
	// Test env: ensure realm has ugnot to pay sells (OriginSend may not fund banker balance).
	testing.IssueCoins(cur.Address(), chain.Coins{{Denom: "ugnot", Amount: 2000000}})
	tok := Buy(cross(cur), id, 0)
	half := tok / 2
	if half <= 0 {
		t.Fatal("half")
	}
	ug := Sell(cross(cur), id, half, 0)
	if ug <= 0 {
		t.Fatalf("ugnot out=%d", ug)
	}
	if BalanceOf(id, buyer) != tok-half {
		t.Fatal("balance after sell")
	}
}

func TestGraduateAndSwap(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))

	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Moon", "MOON", "")

	// Past anti-snipe window
	testing.SkipHeights(21)

	// Fund realm for pool swap-outs later.
	testing.IssueCoins(cur.Address(), chain.Coins{{Denom: "ugnot", Amount: 100000000}})
	// Several mid-size buys to reach graduation without exhausting float in one hit
	for i := 0; i < 6; i++ {
		if GetStatus(id) == StatusGraduated {
			break
		}
		testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 10000000}}) // 10 GNOT each
		Buy(cross(cur), id, 0)
	}
	if GetStatus(id) != StatusGraduated {
		t.Fatalf("status=%d raised=%d", GetStatus(id), GetRaised(id))
	}
	pu, pt := GetPool(id)
	if pu <= 0 || pt != PoolSeed {
		t.Fatalf("pool u=%d t=%d", pu, pt)
	}

	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 1000000}})
	t2 := SwapBuy(cross(cur), id, 0)
	if t2 <= 0 {
		t.Fatal("swap buy")
	}

	sellAmt := t2 / 2
	if sellAmt <= 0 {
		sellAmt = 1
	}
	u2 := SwapSell(cross(cur), id, sellAmt, 0)
	if u2 <= 0 {
		t.Fatalf("swap sell %d", u2)
	}
}

func TestClaimCreator(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))

	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Fee", "FEE", "")
	testing.SkipHeights(21)

	buyer := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 1000000}})
	testing.IssueCoins(cur.Address(), chain.Coins{{Denom: "ugnot", Amount: 2000000}})
	Buy(cross(cur), id, 0)

	if GetCreatorFees(id) <= 0 {
		t.Fatal("expected creator fees")
	}
	testing.SetRealm(testing.NewUserRealm(creator))
	got := ClaimCreatorFees(cross(cur), id)
	if got <= 0 {
		t.Fatal("claim")
	}
	if GetCreatorFees(id) != 0 {
		t.Fatal("fees not cleared")
	}
}

func TestRender(t *testing.T) {
	resetForTest()
	s := Render("")
	if s == "" {
		t.Fatal("empty render")
	}
	s2 := Render("help")
	if s2 == "" {
		t.Fatal("help")
	}
}

func TestListAndInfo(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "UI Coin", "UIC", "uri")
	ids := ListIDs()
	if ids != id {
		t.Fatalf("ListIDs=%q want %q", ids, id)
	}
	info := LaunchInfo(id)
	if info == "" || len(info) < 10 {
		t.Fatal("LaunchInfo empty")
	}
	p := ParamsInfo()
	if p == "" {
		t.Fatal("ParamsInfo")
	}
}

func TestTradeHistoryChart(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Chart", "CHT", "")
	if TradeCount(id) < 1 {
		t.Fatal("open mark missing")
	}
	testing.SkipHeights(21)
	buyer := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 300000}})
	Buy(cross(cur), id, 0)
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 400000}})
	Buy(cross(cur), id, 0)
	if TradeCount(id) < 3 {
		t.Fatalf("trade count=%d want >=3", TradeCount(id))
	}
	hist := TradeHistory(id)
	if hist == "" {
		t.Fatal("empty history")
	}
}

func TestSlippageMinOutOk(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	creator := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	testing.SetRealm(testing.NewUserRealm(creator))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: CreateBondUgnot}})
	id := Create(cross(cur), "Slip", "SLP", "")
	testing.SkipHeights(21)

	buyer := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")
	testing.SetRealm(testing.NewUserRealm(buyer))
	testing.SetOriginSend(chain.Coins{{Denom: "ugnot", Amount: 100000}})
	// minTokensOut=1 should pass for a normal small buy
	tok := Buy(cross(cur), id, 1)
	if tok < 1 {
		t.Fatalf("tokens=%d", tok)
	}
}

func TestTransferProtocol(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	if ProtocolAddress() != admin.String() {
		t.Fatal("protocol addr")
	}
	newP := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	TransferProtocol(cross(cur), newP)
	if ProtocolAddress() != newP.String() {
		t.Fatal("not rotated")
	}
}
