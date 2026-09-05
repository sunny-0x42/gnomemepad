package pad

import "strconv"

// listFund tracks WUGNOT/GNS pulled from the listing caller so we can reimburse/refund.
// Full Sapphire build populates this via TransferFrom; stub leaves zeros.
type listFund struct {
	ok              bool
	caller          address
	pulledLpWugnot  int64 // reimbursed as ugnot after successful list
	pulledFeeWugnot int64 // leftover refunded as WUGNOT after list; full refund on fail
	pulledGns       int64 // CreatePool fee; not reimbursed on success
}

// tryListOnGnoswap is a stub for local unit tests (no Sapphire Gnoswap deps).
// Sapphire deploy prepare overwrites this file with gnoswap_list_full.gno which
// CreatePool + ExactOut GNS fee + position.Mint using remaining tokens + WUGNOT inventory.
// testForceGnoswapList lives in memepad.gno (must survive full-list overwrite on deploy).
func tryListOnGnoswap(cur realm, l *Launch, raisedUgnot, remainingTokens int64) bool {
	_ = cur
	if testForceGnoswapList && l != nil {
		l.GnoswapListed = true
		l.GnoswapPoolPath = "test/wugnot:token:3000"
		l.GnoswapPositionID = 1
		l.LiqWugnotUsed = raisedUgnot
		l.FeeWugnotSpent = 0
		l.GnoswapNote = "listed (test force)"
		_ = remainingTokens
		return true
	}
	_ = raisedUgnot
	_ = remainingTokens
	if l != nil && l.GnoswapNote == "" {
		l.GnoswapNote = "gnoswap auto-list not linked (local/stub build)"
	}
	return false
}

// prepareCallerListFunding: stub - no chain inventory; always ok for test force path.
func prepareCallerListFunding(cur realm, l *Launch, raisedUgnot int64) listFund {
	_ = raisedUgnot
	f := listFund{ok: true, caller: cur.Previous().Address()}
	if testSkipBanker && !testForceGnoswapList && l != nil {
		// Soft-fail like production missing inventory when not forcing.
		l.GnoswapNote = "list skip: stub build (no WUGNOT pull)"
		f.ok = false
	}
	return f
}

func refundCallerListFunding(cur realm, fund listFund) {
	_ = cur
	_ = fund
}

func settleCallerListFunding(cur realm, fund listFund) {
	// Stub: reimburse ugnot for LP pull if any (tests rarely set pulls).
	if fund.pulledLpWugnot > 0 {
		sendUgnot(cur, fund.caller, fund.pulledLpWugnot)
	}
}

// listOnGnoswapWithFunding pulls missing inventory from caller (full build), lists, settles.
func listOnGnoswapWithFunding(cur realm, l *Launch, raisedUgnot, remainingTokens int64) bool {
	fund := prepareCallerListFunding(cur, l, raisedUgnot)
	if !fund.ok {
		return false
	}
	ok := tryListOnGnoswap(cur, l, raisedUgnot, remainingTokens)
	if ok {
		settleCallerListFunding(cur, fund)
		return true
	}
	refundCallerListFunding(cur, fund)
	return false
}

// listNeedOf returns pipe snapshot for UI funding wizard (stub: no live WUGNOT/GNS).
// poolU|wHave|wNeedLp|gnsHave|gnsNeed|feeGns|feeWugnotBudget|padAddr
func listNeedOf(l *Launch) string {
	poolU := int64(0)
	if l != nil && l.Status == StatusGraduated && !l.GnoswapListed {
		poolU = l.PoolUgnot
	}
	feeGns := int64(100_000_000)
	feeBud := GnoswapMaxFeeWugnot
	return strconv.FormatInt(poolU, 10) + "|0|" +
		strconv.FormatInt(poolU, 10) + "|0|" +
		strconv.FormatInt(feeGns, 10) + "|" +
		strconv.FormatInt(feeGns, 10) + "|" +
		strconv.FormatInt(feeBud, 10) + "|" +
		padAddr.String()
}

// ListNeed is the public query for the Token "list on Gnoswap" wizard.
func ListNeed(id string) string {
	return listNeedOf(mustLaunch(id))
}

// GnoswapListedOf reports whether a launch was auto-listed on Gnoswap.
func GnoswapListedOf(id string) bool {
	return mustLaunch(id).GnoswapListed
}

// GnoswapPoolPathOf returns the Gnoswap pool path after listing (or empty).
func GnoswapPoolPathOf(id string) string {
	return mustLaunch(id).GnoswapPoolPath
}

// GnoswapNoteOf returns the listing status note.
func GnoswapNoteOf(id string) string {
	return mustLaunch(id).GnoswapNote
}
