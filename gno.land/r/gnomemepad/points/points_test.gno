package points

import "testing"

func TestReferralAndCheckIn(cur realm, t *testing.T) {
	resetForTest()
	admin := address("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5")
	testing.SetRealm(testing.NewUserRealm(admin))
	Init(cross(cur))

	ref := address("g1us8428u2a5satrlxzagqqa5m6vmuze025anjlj")
	user := address("g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq")

	testing.SetRealm(testing.NewUserRealm(user))
	SetReferrer(cross(cur), ref)
	if GetReferrer(user.String()) != ref.String() {
		t.Fatal("referrer")
	}
	if GetPoints(ref.String()) != PointsReferrerBonus {
		t.Fatalf("ref pts %d", GetPoints(ref.String()))
	}
	if GetPoints(user.String()) != PointsRefereeBonus {
		t.Fatalf("user pts %d", GetPoints(user.String()))
	}

	CheckIn(cross(cur))
	want := PointsRefereeBonus + PointsCheckIn
	if GetPoints(user.String()) != want {
		t.Fatalf("after checkin %d want %d", GetPoints(user.String()), want)
	}

	lb := Leaderboard(5)
	if lb == "" {
		t.Fatal("leaderboard empty")
	}
	p := ParamsInfo()
	if p == "" {
		t.Fatal("params")
	}
}
