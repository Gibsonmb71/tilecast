package forms

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// The workflow is a pure state+transition model: no scripts, expressions, SQL, or shell. The
// default matches the product brief; managers may rename labels and configure a bounded set of
// states and transitions.

const (
	maxWorkflowStates      = 16
	maxWorkflowTransitions = 48
)

var stateKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// defaultWorkflow is seeded when a form is created.
func defaultWorkflow() Workflow {
	return Workflow{
		States: []WorkflowState{
			{Key: "draft", Label: "Draft", Position: 0, Initial: true},
			{Key: "submitted", Label: "Submitted", Position: 1},
			{Key: "changes_requested", Label: "Changes requested", Position: 2},
			{Key: "approved", Label: "Approved", Position: 3, EligibleForOutput: true},
			{Key: "rejected", Label: "Rejected", Position: 4, Terminal: true},
			{Key: "expired", Label: "Expired", Position: 5, Terminal: true},
		},
		Transitions: []WorkflowTransition{
			{From: "draft", To: "submitted", Label: "Submit", RequiredCapability: CapSubmit, Position: 0},
			{From: "submitted", To: "approved", Label: "Approve", RequiredCapability: CapApprove, Position: 1},
			{From: "submitted", To: "rejected", Label: "Reject", RequiredCapability: CapApprove, Position: 2},
			{From: "submitted", To: "changes_requested", Label: "Request changes", RequiredCapability: CapReview, Position: 3},
			{From: "changes_requested", To: "submitted", Label: "Resubmit", RequiredCapability: CapSubmit, Position: 4},
			{From: "approved", To: "expired", Label: "Expire", RequiredCapability: CapManage, Position: 5},
		},
	}
}

// seedWorkflow writes the default workflow for a newly created form inside tx.
func seedWorkflow(ctx context.Context, tx pgx.Tx, formID uuid.UUID) error {
	return writeWorkflow(ctx, tx, formID, defaultWorkflow())
}

// writeWorkflow replaces the stored states and transitions with the given workflow. Callers
// must validate first.
func writeWorkflow(ctx context.Context, tx pgx.Tx, formID uuid.UUID, wf Workflow) error {
	if _, err := tx.Exec(ctx, `DELETE FROM form_workflow_transitions WHERE data_source_id=$1`, formID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM form_workflow_states WHERE data_source_id=$1`, formID); err != nil {
		return err
	}
	for _, state := range wf.States {
		if _, err := tx.Exec(ctx, `INSERT INTO form_workflow_states
			(id,data_source_id,state_key,label,position,eligible_for_output,is_initial,is_terminal)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
			uuid.New(), formID, state.Key, state.Label, state.Position, state.EligibleForOutput, state.Initial, state.Terminal); err != nil {
			return err
		}
	}
	for _, transition := range wf.Transitions {
		if _, err := tx.Exec(ctx, `INSERT INTO form_workflow_transitions
			(id,data_source_id,from_state,to_state,label,required_capability,position)
			VALUES($1,$2,$3,$4,$5,$6,$7)`,
			uuid.New(), formID, transition.From, transition.To, transition.Label, string(transition.RequiredCapability), transition.Position); err != nil {
			return err
		}
	}
	return nil
}

// loadWorkflow reads the configured workflow for a form.
func loadWorkflow(ctx context.Context, q rowQuerier, formID uuid.UUID) (Workflow, error) {
	wf := Workflow{States: []WorkflowState{}, Transitions: []WorkflowTransition{}}
	stateRows, err := q.Query(ctx, `SELECT state_key,label,position,eligible_for_output,is_initial,is_terminal
		FROM form_workflow_states WHERE data_source_id=$1 ORDER BY position,state_key`, formID)
	if err != nil {
		return Workflow{}, err
	}
	for stateRows.Next() {
		var state WorkflowState
		if err := stateRows.Scan(&state.Key, &state.Label, &state.Position, &state.EligibleForOutput, &state.Initial, &state.Terminal); err != nil {
			stateRows.Close()
			return Workflow{}, err
		}
		wf.States = append(wf.States, state)
	}
	stateRows.Close()
	if err := stateRows.Err(); err != nil {
		return Workflow{}, err
	}
	transitionRows, err := q.Query(ctx, `SELECT from_state,to_state,label,required_capability,position
		FROM form_workflow_transitions WHERE data_source_id=$1 ORDER BY position,from_state,to_state`, formID)
	if err != nil {
		return Workflow{}, err
	}
	defer transitionRows.Close()
	for transitionRows.Next() {
		var transition WorkflowTransition
		var capability string
		if err := transitionRows.Scan(&transition.From, &transition.To, &transition.Label, &capability, &transition.Position); err != nil {
			return Workflow{}, err
		}
		transition.RequiredCapability = Capability(capability)
		wf.Transitions = append(wf.Transitions, transition)
	}
	return wf, transitionRows.Err()
}

// validateWorkflow enforces the bounded, script-free workflow rules.
func validateWorkflow(wf Workflow) error {
	if len(wf.States) == 0 || len(wf.States) > maxWorkflowStates {
		return fmt.Errorf("%w: a workflow needs between 1 and %d states", ErrValidation, maxWorkflowStates)
	}
	if len(wf.Transitions) > maxWorkflowTransitions {
		return fmt.Errorf("%w: a workflow allows at most %d transitions", ErrValidation, maxWorkflowTransitions)
	}
	states := map[string]WorkflowState{}
	initialCount := 0
	eligibleCount := 0
	for _, state := range wf.States {
		if !stateKeyPattern.MatchString(state.Key) {
			return fmt.Errorf("%w: state key %q is invalid", ErrValidation, state.Key)
		}
		if _, exists := states[state.Key]; exists {
			return fmt.Errorf("%w: duplicate state key %q", ErrValidation, state.Key)
		}
		if strings.TrimSpace(state.Label) == "" {
			return fmt.Errorf("%w: state %q needs a label", ErrValidation, state.Key)
		}
		states[state.Key] = state
		if state.Initial {
			initialCount++
		}
		if state.EligibleForOutput {
			eligibleCount++
		}
	}
	if initialCount != 1 {
		return fmt.Errorf("%w: exactly one state must be the initial state", ErrValidation)
	}
	if eligibleCount == 0 {
		return fmt.Errorf("%w: at least one state must be eligible for signage output", ErrValidation)
	}
	seenTransitions := map[string]bool{}
	for _, transition := range wf.Transitions {
		if _, ok := states[transition.From]; !ok {
			return fmt.Errorf("%w: transition references unknown state %q", ErrValidation, transition.From)
		}
		if _, ok := states[transition.To]; !ok {
			return fmt.Errorf("%w: transition references unknown state %q", ErrValidation, transition.To)
		}
		if !validCapabilities[transition.RequiredCapability] {
			return fmt.Errorf("%w: transition uses an invalid capability", ErrValidation)
		}
		key := transition.From + "\x00" + transition.To
		if seenTransitions[key] {
			return fmt.Errorf("%w: duplicate transition %s -> %s", ErrValidation, transition.From, transition.To)
		}
		seenTransitions[key] = true
	}
	return nil
}

// WorkflowInput configures a form's workflow.
type WorkflowInput struct {
	Workflow Workflow
}

// ConfigureWorkflow validates and persists a new workflow for a form, then re-derives record
// output-eligibility and rebuilds the projection so signage reflects the change.
func (s *Service) ConfigureWorkflow(ctx context.Context, id, actor uuid.UUID, in WorkflowInput) error {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return err
	}
	if err := validateWorkflow(in.Workflow); err != nil {
		return err
	}
	eligible := map[string]bool{}
	for _, state := range in.Workflow.States {
		eligible[state.Key] = state.EligibleForOutput
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := writeWorkflow(ctx, tx, id, in.Workflow); err != nil {
		return err
	}
	// Re-derive eligibility for existing records: clear all, then set the records whose current
	// state is now output-eligible. A record whose state no longer exists stays ineligible.
	if _, err := tx.Exec(ctx, `UPDATE form_records SET eligible=FALSE,updated_at=now()
		WHERE data_source_id=$1 AND deleted_at IS NULL AND eligible`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE form_records r SET eligible=TRUE,updated_at=now()
		FROM form_workflow_states st
		WHERE r.data_source_id=$1 AND r.deleted_at IS NULL
		AND st.data_source_id=$1 AND st.state_key=r.state_key AND st.eligible_for_output`, id); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return s.RebuildProjection(ctx, id)
}
