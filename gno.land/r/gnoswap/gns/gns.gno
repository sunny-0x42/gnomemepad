// Local stub of gno.land/r/gnoswap/gns for gnodev E2E (Create/Buy/Sell).
// Not a full GNS token — BalanceOf/Transfer/Mint only for pad list-fee escrow.
package gns

import (
	"gno.land/p/nt/avl/v0"
)

var balances avl.Tree // address string -> int64

func BalanceOf(owner address) int64 {
	v := balances.Get(owner.String())
	if v == nil {
		return 0
	}
	return v.(int64)
}

func Transfer(cur realm, to address, amount int64) {
	if amount <= 0 {
		panic("gns: amount must be positive")
	}
	from := cur.Previous().Address()
	have := BalanceOf(from)
	if have < amount {
		panic("gns: insufficient balance")
	}
	setBal(from, have-amount)
	setBal(to, BalanceOf(to)+amount)
}

// Mint is local-only so E2E can fund list-fee paths when needed.
func Mint(cur realm, to address, amount int64) {
	if !cur.Previous().IsUserCall() {
		panic("gns: EOA only")
	}
	if amount <= 0 {
		panic("gns: amount must be positive")
	}
	if !to.IsValid() {
		panic("gns: invalid to")
	}
	setBal(to, BalanceOf(to)+amount)
}

func setBal(addr address, next int64) {
	if next <= 0 {
		balances.Remove(addr.String())
		return
	}
	balances.Set(addr.String(), next)
}

func Render(_ string) string {
	return "# gns (local stub)\n\nBalanceOf / Transfer / Mint only.\n"
}
