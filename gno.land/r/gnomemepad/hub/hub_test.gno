package hub

import "testing"

func TestHubModules(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	if !Inited() {
		t.Fatal("not inited")
	}
	pad := "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/padv4"
	SetModule(cross(cur), "pad", pad)
	if GetModule("pad") != pad {
		t.Fatal("get pad")
	}
	prof := "gno.land/r/g1mv0052e7r6s09f5t9xsqf00nj3tqsgt9dg52jr/gnomemepad/profile"
	SetModule(cross(cur), "profile", prof)
	list := ListModules()
	if list == "" {
		t.Fatal("empty list")
	}
	if Admin() != admin.String() {
		t.Fatal("admin")
	}
	r := Render("")
	if r == "" {
		t.Fatal("render")
	}
}

func TestTransferAdmin(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))
	next := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	TransferAdmin(cross(cur), next)
	if Admin() != next.String() {
		t.Fatal("not rotated")
	}
}
