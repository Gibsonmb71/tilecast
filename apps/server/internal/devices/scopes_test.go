package devices

import (
	"strings"
	"testing"
)

func TestInScopeSQLUsesTheCallersAlias(t *testing.T) {
	// The screens table is aliased `s` in one query and `sc` in another. A
	// hard-coded alias would silently compare the wrong row.
	withSC := InScopeSQL("sc", "$1")
	if !strings.Contains(withSC, "sc.location_id") || !strings.Contains(withSC, "sc.id") {
		t.Errorf("predicate did not use the alias:\n%s", withSC)
	}
	withS := InScopeSQL("s", "$3")
	if !strings.Contains(withS, "s.location_id") || !strings.Contains(withS, "us.user_id=$3") {
		t.Errorf("predicate did not use the alias or parameter:\n%s", withS)
	}
	if strings.Contains(withS, "$1") {
		t.Error("the user parameter must be the one the caller named")
	}
}

func TestInScopeSQLCoversBothGrantKinds(t *testing.T) {
	sql := InScopeSQL("sc", "$1")
	if !strings.Contains(sql, "scope_type='location'") {
		t.Error("a location grant must match")
	}
	if !strings.Contains(sql, "scope_type='group'") {
		t.Error("a sync group grant must match")
	}
	if !strings.Contains(sql, "screen_group_memberships") {
		t.Error("a group grant has to resolve through membership")
	}
}

func TestInScopeSQLIsSelfContained(t *testing.T) {
	// The fragment is pasted into a larger WHERE clause, so it has to be
	// parenthesised or an adjacent OR would change its meaning.
	sql := strings.TrimSpace(InScopeSQL("sc", "$1"))
	if !strings.HasPrefix(sql, "(") || !strings.HasSuffix(sql, ")") {
		t.Errorf("predicate must be wrapped in parentheses:\n%s", sql)
	}
}
