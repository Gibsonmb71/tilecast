package httpapi

import "testing"

func TestValidateManagedUser(t *testing.T) {
	t.Parallel()
	valid := managedUserInput{
		Name: "Jamie Rivera", Username: "jamie.rivera", Password: "correct horse battery", Role: "editor",
	}
	if err := validateManagedUser(valid, true); err != nil {
		t.Fatalf("valid user rejected: %v", err)
	}
	cases := []struct {
		name  string
		input managedUserInput
	}{
		{"short name", managedUserInput{Name: "J", Username: "jamie", Password: "correct horse battery", Role: "editor"}},
		{"invalid username", managedUserInput{Name: "Jamie", Username: "not valid", Password: "correct horse battery", Role: "editor"}},
		{"short password", managedUserInput{Name: "Jamie", Username: "jamie", Password: "short", Role: "editor"}},
		{"invalid role", managedUserInput{Name: "Jamie", Username: "jamie", Password: "correct horse battery", Role: "superuser"}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if err := validateManagedUser(test.input, true); err == nil {
				t.Fatal("invalid user was accepted")
			}
		})
	}
}

func TestCanManageRole(t *testing.T) {
	t.Parallel()
	cases := []struct {
		actor, target string
		want          bool
	}{
		{"owner", "owner", true},
		{"owner", "administrator", true},
		{"administrator", "editor", true},
		{"administrator", "viewer", true},
		{"administrator", "administrator", false},
		{"administrator", "owner", false},
		{"editor", "viewer", false},
	}
	for _, test := range cases {
		if got := canManageRole(test.actor, test.target); got != test.want {
			t.Errorf("canManageRole(%q, %q) = %v, want %v", test.actor, test.target, got, test.want)
		}
	}
}
