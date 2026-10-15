package ammmath

import "testing"

func TestApplyFee(t *testing.T) {
	f := ApplyFee(10000, 120, 4000, 4000)
	if f.Fee != 120 {
		t.Fatalf("fee=%d want 120", f.Fee)
	}
	if f.Net != 9880 {
		t.Fatalf("net=%d want 9880", f.Net)
	}
	if f.Creator != 48 {
		t.Fatalf("creator=%d want 48", f.Creator)
	}
	if f.Protocol != 48 {
		t.Fatalf("protocol=%d want 48", f.Protocol)
	}
	if f.Remainder != 24 {
		t.Fatalf("remainder=%d want 24", f.Remainder)
	}
}

func TestBuySellRoundtripApprox(t *testing.T) {
	vu := int64(30000000)
	vt := int64(1073000191)
	tokens, vu2, vt2 := BuyTokens(vu, vt, 1000000)
	if tokens <= 0 {
		t.Fatal("expected tokens out")
	}
	if vu2 != vu+1000000 {
		t.Fatalf("vu2=%d", vu2)
	}
	half := tokens / 2
	if half <= 0 {
		t.Fatal("half")
	}
	ugnotOut, vu3, vt3 := SellTokens(vu2, vt2, half)
	if ugnotOut <= 0 {
		t.Fatal("expected ugnot out")
	}
	if vu3 >= vu2 || vt3 <= vt2 {
		t.Fatalf("reserves did not move correctly vu3=%d vt3=%d", vu3, vt3)
	}
}

func TestPoolSwap(t *testing.T) {
	pu, pt := int64(85000000), int64(200000000)
	tokOut, pu2, pt2 := PoolSwapUgnotForToken(pu, pt, 1000000, 0)
	if tokOut <= 0 {
		t.Fatal("tokens")
	}
	if pu2 != pu+1000000 {
		t.Fatalf("pu2=%d", pu2)
	}
	if pt2 != pt-tokOut {
		t.Fatalf("pt2=%d", pt2)
	}
	ugOut, pu3, pt3 := PoolSwapTokenForUgnot(pu2, pt2, tokOut/2)
	if ugOut <= 0 {
		t.Fatal("ugnot")
	}
	if pu3 >= pu2 || pt3 <= pt2 {
		t.Fatal("pool direction")
	}
}

func TestCanGraduate(t *testing.T) {
	if CanGraduate(84, 85) {
		t.Fatal("should not graduate")
	}
	if !CanGraduate(85, 85) {
		t.Fatal("should graduate")
	}
}

func TestSpotPrice(t *testing.T) {
	// 30e6 ugnot / 1e9 tokens * 1e6 scale = 30000
	p := SpotPriceUgnotPerToken(30000000, 1000000000)
	if p != 30000 {
		t.Fatalf("spot=%d want 30000", p)
	}
}

func TestMulDivBasic(t *testing.T) {
	if got := MulDiv(6, 7, 4); got != 10 {
		t.Fatalf("MulDiv(6,7,4)=%d want 10", got)
	}
	if got := MulDiv(0, 7, 4); got != 0 {
		t.Fatalf("MulDiv zero=%d", got)
	}
	// Exact former k path: floor((30e6 * 1.073e9) / 31e6)
	vu, vt, in := int64(30_000_000), int64(1_073_000_191), int64(1_000_000)
	wantVT := (vu * vt) / (vu + in) // fits in int64 at Pearl scale
	gotVT := MulDiv(vu, vt, vu+in)
	if gotVT != wantVT {
		t.Fatalf("MulDiv vs Mul64 path got=%d want=%d", gotVT, wantVT)
	}
}

func TestMainnetScaleBuySellMaxNet(t *testing.T) {
	// Live mainnet VirtualUgnot0 × VirtualToken0 overflows int64 k via Mul64.
	vu := int64(102_375_071_625)
	vt := int64(1_073_000_191)
	in := int64(1_000_000) // 1 GNOT net

	tokens, vu2, vt2 := BuyTokens(vu, vt, in)
	if tokens <= 0 {
		t.Fatal("mainnet BuyTokens: expected tokens out (must not panic k overflow)")
	}
	if vu2 != vu+in {
		t.Fatalf("vu2=%d want %d", vu2, vu+in)
	}
	if vt2 >= vt {
		t.Fatalf("vt2=%d must decrease", vt2)
	}
	// Cross-check: newVT = floor(VU*VT/newVU) via MulDiv identity
	wantVT := MulDiv(vu, vt, vu2)
	if vt2 != wantVT {
		t.Fatalf("vt2=%d want MulDiv %d", vt2, wantVT)
	}
	if tokens != vt-vt2 {
		t.Fatalf("tokens=%d want %d", tokens, vt-vt2)
	}

	half := tokens / 2
	if half <= 0 {
		t.Fatal("half tokens")
	}
	ugOut, vu3, vt3 := SellTokens(vu2, vt2, half)
	if ugOut <= 0 {
		t.Fatal("mainnet SellTokens: expected ugnot out")
	}
	if vu3 >= vu2 || vt3 <= vt2 {
		t.Fatalf("sell reserves vu3=%d vt3=%d", vu3, vt3)
	}

	maxNet := MaxNetInForTokenOut(vu, vt, 1_000_000)
	if maxNet <= 0 {
		t.Fatal("MaxNetInForTokenOut must be positive at mainnet scale")
	}
	// Buying with maxNet must not exceed ~1e6 tokens out
	tokCap, _, _ := BuyTokens(vu, vt, maxNet)
	if tokCap > 1_000_000 {
		t.Fatalf("tokCap=%d exceeds maxTokensOut=1e6", tokCap)
	}
}

func TestMainnetScalePoolSwap(t *testing.T) {
	// Graduated-scale pool: raised ~300k GNOT + large token side.
	pu := int64(300_000_000_000)
	pt := int64(200_000_000)
	tokOut, pu2, pt2 := PoolSwapUgnotForToken(pu, pt, 1_000_000, 0)
	if tokOut <= 0 {
		t.Fatal("pool buy tokens")
	}
	if pu2 != pu+1_000_000 {
		t.Fatalf("pu2=%d", pu2)
	}
	ugOut, _, _ := PoolSwapTokenForUgnot(pu2, pt2, tokOut)
	if ugOut <= 0 {
		t.Fatal("pool sell ugnot")
	}
}

func TestMulDivAbuse(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on d=0")
		}
	}()
	_ = MulDiv(1, 1, 0)
}

func TestBuyTokensAbuseZeroIn(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on ugnotIn=0")
		}
	}()
	_ , _, _ = BuyTokens(102_375_071_625, 1_073_000_191, 0)
}

func TestSellTokensAbuseBadReserves(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on invalid reserves")
		}
	}()
	_, _, _ = SellTokens(0, 1_073_000_191, 1)
}

func TestPoolSwapAbuseBadReserves(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on invalid pool reserves")
		}
	}()
	_, _, _ = PoolSwapUgnotForToken(0, 200_000_000, 1_000_000, 0)
}

func TestPoolSwapAbuseNegativeRemainder(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on negative remainder")
		}
	}()
	_, _, _ = PoolSwapUgnotForToken(85_000_000, 200_000_000, 1_000_000, -1)
}
