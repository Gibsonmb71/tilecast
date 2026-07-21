package forms

import (
	"errors"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

// insertChartWidget inserts a chart Widget whose configuration references a form's dataset (view
// key), so view-usage detection has something to find.
func (e formTestEnv) insertChartWidget(t *testing.T, name string, formID uuid.UUID, dataset string) uuid.UUID {
	t.Helper()
	var org uuid.UUID
	if err := e.pool.QueryRow(e.ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	assetID := uuid.New()
	if _, err := e.pool.Exec(e.ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,processing_status,origin,created_by)
		VALUES($1,$2,$3,'widget','','application/json',$4,0,'ready','library',$5)`, assetID, org, name, []byte("0123456789012345678901234567890a"), e.owner); err != nil {
		t.Fatal(err)
	}
	config := fmt.Sprintf(`{"dataSourceId":%q,"dataset":%q}`, formID.String(), dataset)
	if _, err := e.pool.Exec(e.ctx, `INSERT INTO widgets(asset_id,provider,config_version,configuration) VALUES($1,'chart',1,$2::jsonb)`, assetID, config); err != nil {
		t.Fatal(err)
	}
	return assetID
}

// TestWorkflowStateUsageMetadata verifies GetForm decorates states with record counts and a
// removable flag, and that ConfigureWorkflow refuses to remove/rename a used state.
func TestWorkflowStateUsageMetadata(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "WF", DraftSchema: announcementSchema()})
	if _, err := e.service.CreateRecord(e.ctx, form.ID, e.owner, RecordInput{Values: map[string]any{"title": "A"}}); err != nil {
		t.Fatal(err)
	}
	detail, err := e.service.GetForm(e.ctx, form.ID, e.owner)
	if err != nil {
		t.Fatal(err)
	}
	var draft, approved *WorkflowState
	for i := range detail.Workflow.States {
		switch detail.Workflow.States[i].Key {
		case "draft":
			draft = &detail.Workflow.States[i]
		case "approved":
			approved = &detail.Workflow.States[i]
		}
	}
	if draft == nil || draft.RecordCount != 1 || draft.Removable {
		t.Fatalf("draft state should have 1 record and be non-removable, got %#v", draft)
	}
	if approved == nil || approved.RecordCount != 0 || !approved.Removable {
		t.Fatalf("approved state should be removable with 0 records, got %#v", approved)
	}

	// Renaming/removing the used draft state is rejected by reconciliation.
	wf := defaultWorkflow()
	renamed := []WorkflowState{}
	for _, st := range wf.States {
		if st.Key == "draft" {
			st.Key = "intake" // rename → removes 'draft'
		}
		renamed = append(renamed, st)
	}
	wf.States = renamed
	if err := e.service.ConfigureWorkflow(e.ctx, form.ID, e.owner, WorkflowInput{Workflow: wf}); !errors.Is(err, ErrValidation) {
		t.Fatalf("renaming a used state should be rejected, got %v", err)
	}
}

// TestWorkflowValidationAndReconciliation verifies invalid workflows are rejected and a valid
// reconciliation (label/eligibility change on an unused state) succeeds.
func TestWorkflowValidationAndReconciliation(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "WF", DraftSchema: announcementSchema()})

	// No output-eligible state is invalid.
	wf := defaultWorkflow()
	for i := range wf.States {
		wf.States[i].EligibleForOutput = false
	}
	if err := e.service.ConfigureWorkflow(e.ctx, form.ID, e.owner, WorkflowInput{Workflow: wf}); !errors.Is(err, ErrValidation) {
		t.Fatalf("workflow with no eligible state should be rejected, got %v", err)
	}

	// A valid change (rename a label) reconciles successfully.
	wf = defaultWorkflow()
	for i := range wf.States {
		if wf.States[i].Key == "approved" {
			wf.States[i].Label = "Published"
		}
	}
	if err := e.service.ConfigureWorkflow(e.ctx, form.ID, e.owner, WorkflowInput{Workflow: wf}); err != nil {
		t.Fatalf("valid reconciliation failed: %v", err)
	}
	detail, _ := e.service.GetForm(e.ctx, form.ID, e.owner)
	for _, st := range detail.Workflow.States {
		if st.Key == "approved" && st.Label != "Published" {
			t.Fatalf("label change not applied: %q", st.Label)
		}
	}
}

// TestViewPreviewDoesNotPersist verifies PreviewView returns eligible records without saving a view
// or altering the cached projection.
func TestViewPreviewDoesNotPersist(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Views", DraftSchema: announcementSchema()})
	// One approved (eligible) record and one draft (ineligible).
	approvedRec, _ := e.service.CreateRecord(e.ctx, form.ID, e.owner, RecordInput{Values: map[string]any{"title": "Live"}})
	approvedRec, _ = e.service.Transition(e.ctx, form.ID, approvedRec.ID, e.owner, "submitted", "", approvedRec.Version)
	if _, err := e.service.Transition(e.ctx, form.ID, approvedRec.ID, e.owner, "approved", "", approvedRec.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := e.service.CreateRecord(e.ctx, form.ID, e.owner, RecordInput{Values: map[string]any{"title": "Draft"}}); err != nil {
		t.Fatal(err)
	}

	beforeViews, _ := e.service.listViews(e.ctx, e.pool, form.ID)
	beforePayload := e.readPayload(t, form.ID)

	dataset, err := e.service.PreviewView(e.ctx, form.ID, ViewInput{
		Key: "proposed", Name: "Proposed", IncludedStates: []string{"approved"}, OutputFields: []string{"title", "state"}, RecordLimit: 100,
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	// Only the eligible (approved) record appears — the draft never leaks.
	if len(dataset.Records) != 1 || dataset.Records[0].Values["title"] != "Live" {
		t.Fatalf("preview should contain only the approved record, got %#v", dataset.Records)
	}

	// Nothing was persisted: no new view, unchanged cached payload.
	afterViews, _ := e.service.listViews(e.ctx, e.pool, form.ID)
	if len(afterViews) != len(beforeViews) {
		t.Fatalf("preview must not create a view: before=%d after=%d", len(beforeViews), len(afterViews))
	}
	afterPayload := e.readPayload(t, form.ID)
	if len(afterPayload.Datasets) != len(beforePayload.Datasets) {
		t.Fatalf("preview must not change the cached projection")
	}
	for _, ds := range afterPayload.Datasets {
		if ds.ID == "proposed" {
			t.Fatal("preview must not add its dataset to the cached projection")
		}
	}
}

// TestViewLifecycleAndSafeDeletion covers create, duplicate, and deletion blocked by downstream use.
func TestViewLifecycleAndSafeDeletion(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Views", DraftSchema: announcementSchema()})

	original, err := e.service.UpsertView(e.ctx, form.ID, e.owner, ViewInput{
		Key: "highlights", Name: "Highlights", IncludedStates: []string{"approved"}, OutputFields: []string{"title"}, RecordLimit: 50,
	})
	if err != nil {
		t.Fatalf("create view: %v", err)
	}
	// Duplicate = save under a new key.
	if _, err := e.service.UpsertView(e.ctx, form.ID, e.owner, ViewInput{
		Key: "highlights_copy", Name: "Highlights (copy)", IncludedStates: original.IncludedStates, OutputFields: original.OutputFields, RecordLimit: original.RecordLimit,
	}); err != nil {
		t.Fatalf("duplicate view: %v", err)
	}
	views, _ := e.service.listViews(e.ctx, e.pool, form.ID)
	if len(views) < 2 {
		t.Fatalf("expected at least 2 views after duplicate, got %d", len(views))
	}

	// A widget referencing the dataset blocks deletion.
	e.insertChartWidget(t, "Board", form.ID, "highlights")
	if err := e.service.DeleteView(e.ctx, form.ID, original.ID, e.owner); !errors.Is(err, ErrInUse) {
		t.Fatalf("deleting a referenced view should be blocked, got %v", err)
	}
	// The unreferenced copy deletes fine.
	var copyID uuid.UUID
	for _, v := range views {
		if v.Key == "highlights_copy" {
			copyID = v.ID
		}
	}
	if err := e.service.DeleteView(e.ctx, form.ID, copyID, e.owner); err != nil {
		t.Fatalf("deleting an unreferenced view should succeed: %v", err)
	}
}

// TestOutputsEligibleOnlyAndRebuild verifies Outputs previews contain only eligible records and that
// a manual rebuild refreshes status and invalidates manifests.
func TestOutputsEligibleOnlyAndRebuild(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Out", DraftSchema: announcementSchema()})
	rec, _ := e.service.CreateRecord(e.ctx, form.ID, e.owner, RecordInput{Values: map[string]any{"title": "Approved one"}})
	rec, _ = e.service.Transition(e.ctx, form.ID, rec.ID, e.owner, "submitted", "", rec.Version)
	if _, err := e.service.Transition(e.ctx, form.ID, rec.ID, e.owner, "approved", "", rec.Version); err != nil {
		t.Fatal(err)
	}
	// A draft that must never appear in outputs.
	if _, err := e.service.CreateRecord(e.ctx, form.ID, e.owner, RecordInput{Values: map[string]any{"title": "Hidden draft"}}); err != nil {
		t.Fatal(err)
	}

	outputs, err := e.service.GetOutputs(e.ctx, form.ID)
	if err != nil {
		t.Fatalf("outputs: %v", err)
	}
	var approvedView *OutputView
	for i := range outputs.Views {
		if outputs.Views[i].Key == "approved" {
			approvedView = &outputs.Views[i]
		}
	}
	if approvedView == nil {
		t.Fatal("expected the default approved view in outputs")
	}
	if approvedView.RecordCount != 1 {
		t.Fatalf("approved output should have 1 eligible record, got %d", approvedView.RecordCount)
	}
	for _, record := range approvedView.PreviewRecords {
		if record.Values["title"] == "Hidden draft" {
			t.Fatal("outputs preview must not contain unapproved records")
		}
	}
	if outputs.LastSuccessAt == nil {
		t.Fatal("outputs should report a last successful projection time")
	}

	// A manual rebuild invalidates the affected manifest (records an invalidator call).
	before := len(e.invalidator.dataSourceCalls)
	if _, err := e.service.RebuildOutputs(e.ctx, form.ID, e.owner); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	if len(e.invalidator.dataSourceCalls) <= before {
		t.Fatal("rebuild should invalidate affected manifests")
	}
}

// TestGrantReplacementCollapseAndCreatorLock covers atomic replacement, implied-capability collapse,
// the always-manager creator, and the self-management guard.
func TestGrantReplacementCollapseAndCreatorLock(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Access", DraftSchema: announcementSchema()})
	alice := e.insertUser(t, "Alice", "alice", "viewer")

	// Redundant implied capabilities collapse to the minimal generating set.
	entries, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, alice, []Capability{CapApprove, CapReview, CapViewAll, CapSubmit})
	if err != nil {
		t.Fatalf("replace grants: %v", err)
	}
	aliceEntry := findEntry(entries, alice)
	if aliceEntry == nil {
		t.Fatal("alice should appear in access list")
	}
	if !sameCaps(aliceEntry.Capabilities, []Capability{CapApprove, CapSubmit}) {
		t.Fatalf("capabilities should collapse to [approve submit], got %#v", aliceEntry.Capabilities)
	}

	// Replacement is atomic: a new set fully replaces the old one.
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, alice, []Capability{CapViewOwn}); err != nil {
		t.Fatal(err)
	}
	grants, _ := e.service.ListGrants(e.ctx, form.ID)
	count := 0
	for _, g := range grants {
		if g.UserID == alice {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("replacement should leave exactly one grant for alice, got %d", count)
	}

	// The creator always shows as manager and cannot be edited via grants.
	access, _ := e.service.ListAccess(e.ctx, form.ID)
	creator := findEntry(access, e.owner)
	if creator == nil || !creator.IsCreator || !sameCaps(creator.Capabilities, []Capability{CapManage}) {
		t.Fatalf("creator must appear as an implicit manager, got %#v", creator)
	}
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, e.owner, []Capability{CapSubmit}); !errors.Is(err, ErrValidation) {
		t.Fatalf("editing the creator's grants should be rejected, got %v", err)
	}

	// A non-creator manager cannot remove their own management path.
	bob := e.insertUser(t, "Bob", "bob", "viewer")
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, bob, []Capability{CapManage}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, bob, bob, []Capability{CapSubmit}); !errors.Is(err, ErrValidation) {
		t.Fatalf("a manager removing their own management access should be rejected, got %v", err)
	}
}

// TestGrantReplacementRejectsInvalidWithoutChange verifies an invalid capability leaves grants intact.
func TestGrantReplacementRejectsInvalidWithoutChange(t *testing.T) {
	e := setupForms(t)
	form, _ := e.service.CreateForm(e.ctx, e.owner, FormInput{Name: "Access", DraftSchema: announcementSchema()})
	alice := e.insertUser(t, "Alice", "alice", "viewer")
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, alice, []Capability{CapReview}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.service.ReplaceGrants(e.ctx, form.ID, e.owner, alice, []Capability{Capability("bogus")}); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid capability should be rejected, got %v", err)
	}
	// The previous grant is unchanged.
	access, _ := e.service.ListAccess(e.ctx, form.ID)
	aliceEntry := findEntry(access, alice)
	if aliceEntry == nil || !sameCaps(aliceEntry.Capabilities, []Capability{CapReview}) {
		t.Fatalf("a rejected replacement must not change existing grants, got %#v", aliceEntry)
	}
}

// TestUserDirectoryLimitedFields verifies the manager directory returns only the safe fields.
func TestUserDirectoryLimitedFields(t *testing.T) {
	e := setupForms(t)
	_ = e.insertUser(t, "Zoe Directory", "zoe", "editor")
	users, err := e.service.SearchUsers(e.ctx, "zoe", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 || users[0].Username != "zoe" || users[0].Role != "editor" || users[0].Name != "Zoe Directory" {
		t.Fatalf("directory should return the matching user with limited fields, got %#v", users)
	}
}

func findEntry(entries []AccessEntry, userID uuid.UUID) *AccessEntry {
	for i := range entries {
		if entries[i].UserID == userID {
			return &entries[i]
		}
	}
	return nil
}

func sameCaps(got, want []Capability) bool {
	if len(got) != len(want) {
		return false
	}
	set := map[Capability]bool{}
	for _, c := range got {
		set[c] = true
	}
	for _, c := range want {
		if !set[c] {
			return false
		}
	}
	return true
}
