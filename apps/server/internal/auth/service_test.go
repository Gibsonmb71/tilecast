package auth

import "testing"

func TestValidateSetup(t *testing.T) {
	valid := SetupInput{OrganizationName: "North Library", OwnerName: "Taylor", Username: "owner@example.org", Password: "correct horse battery staple"}
	if err := validateSetup(valid); err != nil {
		t.Fatalf("valid setup rejected: %v", err)
	}

	cases := []SetupInput{
		{OrganizationName: "", OwnerName: valid.OwnerName, Username: valid.Username, Password: valid.Password},
		{OrganizationName: valid.OrganizationName, OwnerName: "", Username: valid.Username, Password: valid.Password},
		{OrganizationName: valid.OrganizationName, OwnerName: valid.OwnerName, Username: "bad username", Password: valid.Password},
		{OrganizationName: valid.OrganizationName, OwnerName: valid.OwnerName, Username: valid.Username, Password: "short"},
	}
	for _, input := range cases {
		if err := validateSetup(input); err == nil {
			t.Fatalf("invalid setup accepted: %#v", input)
		}
	}
}

func TestRandomTokenIsUnique(t *testing.T) {
	a, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	b, err := randomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) < 40 {
		t.Fatalf("unexpected tokens: %q %q", a, b)
	}
}
