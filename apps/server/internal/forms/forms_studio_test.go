package forms

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// --- 5. Metadata update endpoint (service level) ---

func TestUpdateMetadata(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Original", Description: "d", DraftSchema: announcementSchema()})

	// Success: name and description are updated on the parent Data Source row.
	updated, err := e.service.UpdateMetadata(e.ctx, form.ID, e.owner, MetadataInput{Name: "Staff Announcements", Description: "By staff."})
	if err != nil {
		t.Fatalf("update metadata: %v", err)
	}
	if updated.Name != "Staff Announcements" || updated.Description != "By staff." {
		t.Fatalf("metadata not updated: %+v", updated)
	}

	// Validation: empty name is rejected.
	if _, err := e.service.UpdateMetadata(e.ctx, form.ID, e.owner, MetadataInput{Name: "   "}); !errors.Is(err, ErrValidation) {
		t.Fatalf("expected validation error for empty name, got %v", err)
	}

	// Authorization: a submitter-only user cannot update metadata (enforced by the HTTP layer via
	// Authorize; verify the capability check directly here).
	viewer := e.insertUser(t, "Val", "val", "viewer")
	if _, err := e.service.SetGrant(e.ctx, form.ID, e.owner, GrantInput{UserID: viewer, Capability: CapSubmit}); err != nil {
		t.Fatal(err)
	}
	allowed, err := e.service.Authorize(e.ctx, form.ID, viewer, CapManage)
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("submitter must not have manage capability")
	}
	// A viewer granted manage on this form may manage it even without a global editor role.
	manager := e.insertUser(t, "Man", "man", "viewer")
	if _, err := e.service.SetGrant(e.ctx, form.ID, e.owner, GrantInput{UserID: manager, Capability: CapManage}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.service.UpdateMetadata(e.ctx, form.ID, manager, MetadataInput{Name: "Managed", Description: ""}); err != nil {
		t.Fatalf("granted manager should update metadata: %v", err)
	}
}

// --- 6. Publish compatibility checks ---

func TestPublishCompatibility(t *testing.T) {
	e := setupForms(t)

	base := func() FormSchema {
		return FormSchema{Fields: []FormField{
			{Key: "title", Label: "Title", Control: ControlShortText, Required: true},
			{Key: "count", Label: "Count", Control: ControlInteger},
			{Key: "intro", Label: "Intro", Control: ControlSection},
		}}
	}
	newForm := func(name string) uuid.UUID {
		f, err := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: name, DraftSchema: base()})
		if err != nil {
			t.Fatal(err)
		}
		return f.ID
	}
	publishDraft := func(id uuid.UUID, schema FormSchema) error {
		if _, err := e.service.UpdateDraft(e.ctx, id, e.owner, DraftInput{Schema: schema}); err != nil {
			t.Fatal(err)
		}
		_, err := e.service.PublishRevision(e.ctx, id, e.owner)
		return err
	}

	// Removing a published output field is rejected.
	id := newForm("remove")
	removed := FormSchema{Fields: []FormField{{Key: "title", Label: "Title", Control: ControlShortText}}}
	if err := publishDraft(id, removed); !errors.Is(err, ErrValidation) {
		t.Fatalf("removing a published field must fail, got %v", err)
	}

	// Changing a published field from text to number is rejected.
	id = newForm("retype")
	retyped := base()
	retyped.Fields[0].Control = ControlNumber // title text -> number
	if err := publishDraft(id, retyped); !errors.Is(err, ErrValidation) {
		t.Fatalf("changing output type must fail, got %v", err)
	}

	// Reordering fields is allowed.
	id = newForm("reorder")
	reordered := FormSchema{Fields: []FormField{
		{Key: "count", Label: "Count", Control: ControlInteger},
		{Key: "title", Label: "Title", Control: ControlShortText, Required: true},
		{Key: "intro", Label: "Intro", Control: ControlSection},
	}}
	if err := publishDraft(id, reordered); err != nil {
		t.Fatalf("reordering must be allowed, got %v", err)
	}

	// Renaming a label while preserving the key is allowed.
	id = newForm("relabel")
	relabeled := base()
	relabeled.Fields[0].Label = "Headline"
	if err := publishDraft(id, relabeled); err != nil {
		t.Fatalf("relabeling must be allowed, got %v", err)
	}

	// Adding a new field is allowed.
	id = newForm("add")
	added := base()
	added.Fields = append(added.Fields, FormField{Key: "note", Label: "Note", Control: ControlLongText})
	if err := publishDraft(id, added); err != nil {
		t.Fatalf("adding a field must be allowed, got %v", err)
	}

	// Removing a presentation-only field is allowed.
	id = newForm("drop_section")
	withoutSection := FormSchema{Fields: []FormField{
		{Key: "title", Label: "Title", Control: ControlShortText, Required: true},
		{Key: "count", Label: "Count", Control: ControlInteger},
	}}
	if err := publishDraft(id, withoutSection); err != nil {
		t.Fatalf("removing a presentation-only field must be allowed, got %v", err)
	}
}

// --- 16. Non-manager response shaping ---

func TestNonManagerSeesPublishedSchemaOnly(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Shaped", DraftSchema: announcementSchema()})
	// Add an unpublished draft-only field.
	draft := announcementSchema()
	draft.Fields = append(draft.Fields, FormField{Key: "secret", Label: "Draft only", Control: ControlShortText})
	if _, err := e.service.UpdateDraft(e.ctx, form.ID, e.owner, DraftInput{Schema: draft}); err != nil {
		t.Fatal(err)
	}

	// A submitter (non-manager) must not receive the draft-only field.
	viewer := e.insertUser(t, "Vic", "vic", "viewer")
	if _, err := e.service.SetGrant(e.ctx, form.ID, e.owner, GrantInput{UserID: viewer, Capability: CapSubmit}); err != nil {
		t.Fatal(err)
	}
	// Grant view access so GetForm succeeds for the viewer.
	if _, err := e.service.SetGrant(e.ctx, form.ID, e.owner, GrantInput{UserID: viewer, Capability: CapViewOwn}); err != nil {
		t.Fatal(err)
	}
	asViewer, err := e.service.GetForm(e.ctx, form.ID, viewer)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range asViewer.DraftSchema.Fields {
		if field.Key == "secret" {
			t.Fatal("non-manager must not see draft-only fields in the visible schema")
		}
	}
	if containsCapability(asViewer.Capabilities, CapManage) {
		t.Fatal("viewer must not report manage capability")
	}

	// The manager still sees the full draft.
	asOwner, err := e.service.GetForm(e.ctx, form.ID, e.owner)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, field := range asOwner.DraftSchema.Fields {
		if field.Key == "secret" {
			found = true
		}
	}
	if !found {
		t.Fatal("manager should see the full draft schema")
	}
}
