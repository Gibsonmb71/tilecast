package scheduling

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("schedule resource not found")
	ErrConflict = errors.New("schedule conflict")
	ErrLimit    = errors.New("schedule limit exceeded")
)

type Notifier interface{ ManifestChanged(uuid.UUID, int64) }
type Limits struct{ MaxSchedules, MaxTargetsPerSchedule, MaxGroupsPerScreen, PrefetchDays, ActivationGraceSeconds, ClockSkewWarningSeconds int }
type Service struct {
	db       *pgxpool.Pool
	notifier Notifier
	limits   Limits
}

func NewService(db *pgxpool.Pool, n Notifier, l Limits) *Service {
	return &Service{db: db, notifier: n, limits: l}
}

type Group struct {
	ID              uuid.UUID     `json:"id"`
	Name            string        `json:"name"`
	Description     string        `json:"description"`
	MembershipCount int           `json:"membershipCount"`
	Screens         []GroupScreen `json:"screens"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}
type GroupScreen struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	Location string    `json:"location"`
}
type GroupList struct {
	Items    []Group `json:"items"`
	Total    int     `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
}
type Target struct {
	Type string    `json:"type"`
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name,omitempty"`
}
type Record struct {
	Schedule
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	PlaylistName string    `json:"playlistName"`
	Targets      []Target  `json:"targets"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
type List struct {
	Items           []Record `json:"items"`
	Total           int      `json:"total"`
	Page            int      `json:"page"`
	PageSize        int      `json:"pageSize"`
	DefaultTimezone string   `json:"defaultTimezone"`
}
type Input struct {
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	PlaylistID   uuid.UUID  `json:"playlistId"`
	Type         Kind       `json:"type"`
	Timezone     string     `json:"timezone"`
	Priority     int        `json:"priority"`
	Enabled      bool       `json:"enabled"`
	StartDate    *string    `json:"startDate"`
	EndDate      *string    `json:"endDate"`
	OneTimeStart *time.Time `json:"oneTimeStart"`
	OneTimeEnd   *time.Time `json:"oneTimeEnd"`
	DailyStart   *string    `json:"dailyStart"`
	DailyEnd     *string    `json:"dailyEnd"`
	DaysOfWeek   []int      `json:"daysOfWeek"`
	Targets      []Target   `json:"targets"`
}

func (s *Service) ListGroups(ctx context.Context, search string, page, size int) (GroupList, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 50
	}
	var out GroupList
	out.Page, out.PageSize = page, size
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM screen_groups WHERE deleted_at IS NULL AND ($1='' OR name ILIKE '%'||$1||'%')`, strings.TrimSpace(search)).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.db.Query(ctx, `SELECT g.id,g.name,g.description,g.created_at,g.updated_at,count(m.screen_id) FROM screen_groups g LEFT JOIN screen_group_memberships m ON m.screen_group_id=g.id WHERE g.deleted_at IS NULL AND ($1='' OR g.name ILIKE '%'||$1||'%') GROUP BY g.id ORDER BY lower(g.name),g.id LIMIT $2 OFFSET $3`, strings.TrimSpace(search), size, (page-1)*size)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.Items = []Group{}
	for rows.Next() {
		var g Group
		if err = rows.Scan(&g.ID, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt, &g.MembershipCount); err != nil {
			return out, err
		}
		g.Screens = []GroupScreen{}
		out.Items = append(out.Items, g)
	}
	return out, rows.Err()
}
func validateGroup(name, description string) error {
	if n := len(strings.TrimSpace(name)); n < 1 || n > 180 {
		return errors.New("group name must be between 1 and 180 characters")
	}
	if len(description) > 2000 {
		return errors.New("group description must be at most 2000 characters")
	}
	return nil
}
func (s *Service) CreateGroup(ctx context.Context, user uuid.UUID, name, description string) (Group, error) {
	if err := validateGroup(name, description); err != nil {
		return Group{}, err
	}
	id := uuid.New()
	_, err := s.db.Exec(ctx, `INSERT INTO screen_groups(id,organization_id,name,description,created_by)SELECT $1,id,$2,$3,$4 FROM organization_settings WHERE singleton`, id, strings.TrimSpace(name), description, user)
	if err != nil {
		return Group{}, err
	}
	_ = s.audit(ctx, user, "screen_group.created", "screen_group", id)
	return s.GetGroup(ctx, id)
}
func (s *Service) GetGroup(ctx context.Context, id uuid.UUID) (Group, error) {
	var g Group
	err := s.db.QueryRow(ctx, `SELECT g.id,g.name,g.description,g.created_at,g.updated_at,count(m.screen_id) FROM screen_groups g LEFT JOIN screen_group_memberships m ON m.screen_group_id=g.id WHERE g.id=$1 AND g.deleted_at IS NULL GROUP BY g.id`, id).Scan(&g.ID, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt, &g.MembershipCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	if err != nil {
		return g, err
	}
	rows, err := s.db.Query(ctx, `SELECT sc.id,sc.name,sc.location FROM screen_group_memberships m JOIN screens sc ON sc.id=m.screen_id WHERE m.screen_group_id=$1 ORDER BY lower(sc.name),sc.id`, id)
	if err != nil {
		return g, err
	}
	defer rows.Close()
	g.Screens = []GroupScreen{}
	for rows.Next() {
		var x GroupScreen
		if err = rows.Scan(&x.ID, &x.Name, &x.Location); err != nil {
			return g, err
		}
		g.Screens = append(g.Screens, x)
	}
	return g, rows.Err()
}
func (s *Service) UpdateGroup(ctx context.Context, id, user uuid.UUID, name, description string) (Group, error) {
	if err := validateGroup(name, description); err != nil {
		return Group{}, err
	}
	tag, err := s.db.Exec(ctx, `UPDATE screen_groups SET name=$2,description=$3,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, strings.TrimSpace(name), description)
	if err != nil {
		return Group{}, err
	}
	if tag.RowsAffected() == 0 {
		return Group{}, ErrNotFound
	}
	_ = s.audit(ctx, user, "screen_group.updated", "screen_group", id)
	return s.GetGroup(ctx, id)
}
func (s *Service) DeleteGroup(ctx context.Context, id, user uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	notes, err := bumpGroupScreens(ctx, tx, id, "screen_group.deleted")
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE screen_groups SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err = tx.Exec(ctx, `DELETE FROM screen_group_memberships WHERE screen_group_id=$1`, id); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	_ = s.audit(ctx, user, "screen_group.deleted", "screen_group", id)
	return nil
}
func (s *Service) AddScreen(ctx context.Context, group, screen, user uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM screen_group_memberships WHERE screen_id=$1`, screen).Scan(&count); err != nil {
		return err
	}
	if count >= s.limits.MaxGroupsPerScreen {
		return ErrLimit
	}
	tag, err := tx.Exec(ctx, `INSERT INTO screen_group_memberships(screen_group_id,screen_id,added_by) SELECT g.id,sc.id,$3 FROM screen_groups g JOIN screens sc ON sc.organization_id=g.organization_id WHERE g.id=$1 AND sc.id=$2 AND g.deleted_at IS NULL ON CONFLICT DO NOTHING`, group, screen, user)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	notes, err := bumpScreens(ctx, tx, []uuid.UUID{screen}, "screen_group.membership_changed")
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	_ = s.audit(ctx, user, "screen_group.screen_added", "screen_group", group)
	return nil
}
func (s *Service) RemoveScreen(ctx context.Context, group, screen, user uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM screen_group_memberships WHERE screen_group_id=$1 AND screen_id=$2`, group, screen)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	notes, err := bumpScreens(ctx, tx, []uuid.UUID{screen}, "screen_group.membership_changed")
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	_ = s.audit(ctx, user, "screen_group.screen_removed", "screen_group", group)
	return nil
}

func (s *Service) validateInput(ctx context.Context, in Input) error {
	if len(strings.TrimSpace(in.Name)) < 1 || len(in.Name) > 180 {
		return errors.New("schedule name must be between 1 and 180 characters")
	}
	if len(in.Description) > 2000 {
		return errors.New("schedule description must be at most 2000 characters")
	}
	if len(in.Targets) < 1 {
		return errors.New("schedule must have at least one target")
	}
	if len(in.Targets) > s.limits.MaxTargetsPerSchedule {
		return ErrLimit
	}
	if err := Validate(Schedule{PlaylistID: in.PlaylistID, Type: in.Type, Timezone: in.Timezone, Priority: in.Priority, Enabled: in.Enabled, StartDate: in.StartDate, EndDate: in.EndDate, OneTimeStart: in.OneTimeStart, OneTimeEnd: in.OneTimeEnd, DailyStart: in.DailyStart, DailyEnd: in.DailyEnd, DaysOfWeek: in.DaysOfWeek}); err != nil {
		return err
	}
	var ok bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlists WHERE id=$1 AND deleted_at IS NULL)`, in.PlaylistID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return errors.New("playlist is deleted or invalid")
	}
	seen := map[string]bool{}
	for _, t := range in.Targets {
		if t.Type != "screen" && t.Type != "group" {
			return errors.New("target type is invalid")
		}
		k := t.Type + t.ID.String()
		if seen[k] {
			return errors.New("duplicate schedule target")
		}
		seen[k] = true
		var targetOK bool
		var targetErr error
		if t.Type == "screen" {
			targetErr = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM screens sc JOIN organization_settings o ON o.id=sc.organization_id AND o.singleton WHERE sc.id=$1)`, t.ID).Scan(&targetOK)
		} else {
			targetErr = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM screen_groups g JOIN organization_settings o ON o.id=g.organization_id AND o.singleton WHERE g.id=$1 AND g.deleted_at IS NULL)`, t.ID).Scan(&targetOK)
		}
		if targetErr != nil {
			return targetErr
		}
		if !targetOK {
			return errors.New("schedule target is invalid or belongs to another organization")
		}
	}
	return nil
}
func (s *Service) withDefaultTimezone(ctx context.Context, in Input) (Input, error) {
	if strings.TrimSpace(in.Timezone) != "" {
		return in, nil
	}
	err := s.db.QueryRow(ctx, `SELECT default_timezone FROM organization_settings WHERE singleton`).Scan(&in.Timezone)
	return in, err
}
func (s *Service) Create(ctx context.Context, user uuid.UUID, in Input) (Record, error) {
	var err error
	in, err = s.withDefaultTimezone(ctx, in)
	if err != nil {
		return Record{}, err
	}
	if err := s.validateInput(ctx, in); err != nil {
		return Record{}, err
	}
	var count int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM schedules WHERE deleted_at IS NULL`).Scan(&count); err != nil {
		return Record{}, err
	}
	if count >= s.limits.MaxSchedules {
		return Record{}, ErrLimit
	}
	id := uuid.New()
	if err := s.write(ctx, id, user, in, true); err != nil {
		return Record{}, err
	}
	return s.Get(ctx, id)
}
func (s *Service) Update(ctx context.Context, id, user uuid.UUID, in Input) (Record, error) {
	previous, previousErr := s.Get(ctx, id)
	if previousErr != nil {
		return Record{}, previousErr
	}
	var err error
	in, err = s.withDefaultTimezone(ctx, in)
	if err != nil {
		return Record{}, err
	}
	if err := s.validateInput(ctx, in); err != nil {
		return Record{}, err
	}
	if err := s.write(ctx, id, user, in, false); err != nil {
		return Record{}, err
	}
	if previous.Priority != in.Priority {
		_ = s.audit(ctx, user, "schedule.priority_changed", "schedule", id)
	}
	if previous.Enabled != in.Enabled {
		action := "schedule.disabled"
		if in.Enabled {
			action = "schedule.enabled"
		}
		_ = s.audit(ctx, user, action, "schedule", id)
	}
	if !sameTargets(previous.Targets, in.Targets) {
		_ = s.audit(ctx, user, "schedule.targets_changed", "schedule", id)
	}
	return s.Get(ctx, id)
}
func sameTargets(a, b []Target) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]bool{}
	for _, x := range a {
		m[x.Type+x.ID.String()] = true
	}
	for _, x := range b {
		if !m[x.Type+x.ID.String()] {
			return false
		}
	}
	return true
}
func (s *Service) write(ctx context.Context, id, user uuid.UUID, in Input, create bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	old, err := affectedForSchedule(ctx, tx, id)
	if err != nil {
		return err
	}
	if create {
		_, err = tx.Exec(ctx, `INSERT INTO schedules(id,organization_id,name,description,playlist_id,type,timezone,priority,enabled,start_date,end_date,one_time_start,one_time_end,daily_start,daily_end,days_of_week,created_by)SELECT $1,id,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11,$12,$13::time,$14::time,COALESCE($15::smallint[],'{}'::smallint[]),$16 FROM organization_settings WHERE singleton`, id, strings.TrimSpace(in.Name), in.Description, in.PlaylistID, in.Type, in.Timezone, in.Priority, in.Enabled, in.StartDate, in.EndDate, in.OneTimeStart, in.OneTimeEnd, in.DailyStart, in.DailyEnd, in.DaysOfWeek, user)
	} else {
		tag, e := tx.Exec(ctx, `UPDATE schedules SET name=$2,description=$3,playlist_id=$4,type=$5,timezone=$6,priority=$7,enabled=$8,start_date=$9::date,end_date=$10::date,one_time_start=$11,one_time_end=$12,daily_start=$13::time,daily_end=$14::time,days_of_week=COALESCE($15::smallint[],'{}'::smallint[]),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, strings.TrimSpace(in.Name), in.Description, in.PlaylistID, in.Type, in.Timezone, in.Priority, in.Enabled, in.StartDate, in.EndDate, in.OneTimeStart, in.OneTimeEnd, in.DailyStart, in.DailyEnd, in.DaysOfWeek)
		err = e
		if err == nil && tag.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM schedule_targets WHERE schedule_id=$1`, id); err != nil {
		return err
	}
	for _, t := range in.Targets {
		var tag pgconn.CommandTag
		if t.Type == "screen" {
			tag, err = tx.Exec(ctx, `INSERT INTO schedule_targets(schedule_id,target_type,screen_id)SELECT $1,'screen',sc.id FROM screens sc JOIN schedules s ON s.id=$1 AND s.organization_id=sc.organization_id WHERE sc.id=$2`, id, t.ID)
		} else {
			tag, err = tx.Exec(ctx, `INSERT INTO schedule_targets(schedule_id,target_type,screen_group_id)SELECT $1,'group',g.id FROM screen_groups g JOIN schedules s ON s.id=$1 AND s.organization_id=g.organization_id WHERE g.id=$2 AND g.deleted_at IS NULL`, id, t.ID)
		}
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errors.New("schedule target is invalid or belongs to another organization")
		}
	}
	now, err := affectedForSchedule(ctx, tx, id)
	if err != nil {
		return err
	}
	notes, err := bumpScreens(ctx, tx, union(old, now), "schedule.changed")
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	action := "schedule.updated"
	if create {
		action = "schedule.created"
	}
	_ = s.audit(ctx, user, action, "schedule", id)
	return nil
}
func (s *Service) Delete(ctx context.Context, id, user uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	ids, err := affectedForSchedule(ctx, tx, id)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE schedules SET deleted_at=now(),enabled=false,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	notes, err := bumpScreens(ctx, tx, ids, "schedule.deleted")
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	_ = s.audit(ctx, user, "schedule.deleted", "schedule", id)
	return nil
}
func (s *Service) SetEnabled(ctx context.Context, id, user uuid.UUID, enabled bool) (Record, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx)
	ids, err := affectedForSchedule(ctx, tx, id)
	if err != nil {
		return Record{}, err
	}
	tag, err := tx.Exec(ctx, `UPDATE schedules SET enabled=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, enabled)
	if err != nil {
		return Record{}, err
	}
	if tag.RowsAffected() == 0 {
		return Record{}, ErrNotFound
	}
	notes, err := bumpScreens(ctx, tx, ids, "schedule.enabled_changed")
	if err != nil {
		return Record{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	s.notify(notes)
	action := "schedule.disabled"
	if enabled {
		action = "schedule.enabled"
	}
	_ = s.audit(ctx, user, action, "schedule", id)
	return s.Get(ctx, id)
}

const recordSelect = `SELECT s.id,s.name,s.description,s.playlist_id,p.name,s.type,s.timezone,s.priority,s.enabled,to_char(s.start_date,'YYYY-MM-DD'),to_char(s.end_date,'YYYY-MM-DD'),s.one_time_start,s.one_time_end,to_char(s.daily_start,'HH24:MI'),to_char(s.daily_end,'HH24:MI'),s.days_of_week,s.created_at,s.updated_at FROM schedules s JOIN playlists p ON p.id=s.playlist_id`

func scanRecord(row pgx.Row) (Record, error) {
	var r Record
	err := row.Scan(&r.ID, &r.Name, &r.Description, &r.PlaylistID, &r.PlaylistName, &r.Type, &r.Timezone, &r.Priority, &r.Enabled, &r.StartDate, &r.EndDate, &r.OneTimeStart, &r.OneTimeEnd, &r.DailyStart, &r.DailyEnd, &r.DaysOfWeek, &r.CreatedAt, &r.UpdatedAt)
	r.Targets = []Target{}
	return r, err
}
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Record, error) {
	r, err := scanRecord(s.db.QueryRow(ctx, recordSelect+` WHERE s.id=$1 AND s.deleted_at IS NULL`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	if err != nil {
		return r, err
	}
	r.Targets, err = s.targets(ctx, id)
	return r, err
}
func (s *Service) List(ctx context.Context, search string, page, size int) (List, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 50
	}
	var out List
	out.Page, out.PageSize = page, size
	if err := s.db.QueryRow(ctx, `SELECT default_timezone FROM organization_settings WHERE singleton`).Scan(&out.DefaultTimezone); err != nil {
		return out, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM schedules WHERE deleted_at IS NULL AND ($1='' OR name ILIKE '%'||$1||'%')`, strings.TrimSpace(search)).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := s.db.Query(ctx, recordSelect+` WHERE s.deleted_at IS NULL AND ($1='' OR s.name ILIKE '%'||$1||'%') ORDER BY s.updated_at DESC,s.id LIMIT $2 OFFSET $3`, strings.TrimSpace(search), size, (page-1)*size)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	out.Items = []Record{}
	for rows.Next() {
		r, er := scanRecord(rows)
		if er != nil {
			return out, er
		}
		r.Targets, er = s.targets(ctx, r.ID)
		if er != nil {
			return out, er
		}
		out.Items = append(out.Items, r)
	}
	return out, rows.Err()
}
func (s *Service) targets(ctx context.Context, id uuid.UUID) ([]Target, error) {
	rows, err := s.db.Query(ctx, `SELECT t.target_type,COALESCE(t.screen_id,t.screen_group_id),COALESCE(sc.name,g.name) FROM schedule_targets t LEFT JOIN screens sc ON sc.id=t.screen_id LEFT JOIN screen_groups g ON g.id=t.screen_group_id WHERE t.schedule_id=$1 ORDER BY t.target_type,COALESCE(sc.name,g.name),COALESCE(t.screen_id,t.screen_group_id)`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Target{}
	for rows.Next() {
		var t Target
		if err = rows.Scan(&t.Type, &t.ID, &t.Name); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Service) Relevant(ctx context.Context, screen uuid.UUID) ([]Record, error) {
	rows, err := s.db.Query(ctx, recordSelect+` WHERE s.deleted_at IS NULL AND s.enabled AND EXISTS(SELECT 1 FROM schedule_targets t WHERE t.schedule_id=s.id AND (t.screen_id=$1 OR EXISTS(SELECT 1 FROM screen_group_memberships m WHERE m.screen_group_id=t.screen_group_id AND m.screen_id=$1))) ORDER BY s.id`, screen)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		r, er := scanRecord(rows)
		if er != nil {
			return nil, er
		}
		var direct bool
		if er = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schedule_targets WHERE schedule_id=$1 AND screen_id=$2)`, r.ID, screen).Scan(&direct); er != nil {
			return nil, er
		}
		if direct {
			r.Specificity = 1
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type Preview struct {
	ScreenID                 uuid.UUID  `json:"screenId"`
	At                       time.Time  `json:"at"`
	WinningSchedule          *Record    `json:"winningSchedule,omitempty"`
	WinningPlaylistID        *uuid.UUID `json:"winningPlaylistId,omitempty"`
	DirectFallbackPlaylistID *uuid.UUID `json:"directFallbackPlaylistId,omitempty"`
	Applicable               []Record   `json:"applicableSchedules"`
	NextTransition           *time.Time `json:"nextTransition,omitempty"`
	Conflicts                []string   `json:"conflicts"`
}

func (s *Service) Preview(ctx context.Context, screen uuid.UUID, at time.Time, proposed *Input) (Preview, error) {
	var screenOK bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM screens sc JOIN organization_settings o ON o.id=sc.organization_id AND o.singleton WHERE sc.id=$1)`, screen).Scan(&screenOK); err != nil {
		return Preview{}, err
	}
	if !screenOK {
		return Preview{}, ErrNotFound
	}
	records, err := s.Relevant(ctx, screen)
	if err != nil {
		return Preview{}, err
	}
	if proposed != nil {
		if err = s.validateInput(ctx, *proposed); err != nil {
			return Preview{}, err
		}
		specificity := -1
		for _, t := range proposed.Targets {
			if t.Type == "screen" && t.ID == screen {
				specificity = 1
			}
			if t.Type == "group" {
				var member bool
				_ = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM screen_group_memberships WHERE screen_group_id=$1 AND screen_id=$2)`, t.ID, screen).Scan(&member)
				if member && specificity < 0 {
					specificity = 0
				}
			}
		}
		if specificity >= 0 {
			records = append(records, Record{Schedule: Schedule{ID: uuid.Nil, PlaylistID: proposed.PlaylistID, Type: proposed.Type, Timezone: proposed.Timezone, Priority: proposed.Priority, Specificity: specificity, Enabled: proposed.Enabled, StartDate: proposed.StartDate, EndDate: proposed.EndDate, OneTimeStart: proposed.OneTimeStart, OneTimeEnd: proposed.OneTimeEnd, DailyStart: proposed.DailyStart, DailyEnd: proposed.DailyEnd, DaysOfWeek: proposed.DaysOfWeek}, Name: proposed.Name})
		}
	}
	base := make([]Schedule, len(records))
	for i := range records {
		base[i] = records[i].Schedule
	}
	resolved := Resolve(at, base)
	out := Preview{ScreenID: screen, At: at, Applicable: []Record{}, NextTransition: resolved.NextTransition, Conflicts: []string{}}
	var fallback uuid.UUID
	if e := s.db.QueryRow(ctx, `SELECT playlist_id FROM screen_playlist_assignments WHERE screen_id=$1`, screen).Scan(&fallback); e == nil {
		out.DirectFallbackPlaylistID = &fallback
		out.WinningPlaylistID = &fallback
	}
	for _, a := range resolved.Applicable {
		for _, r := range records {
			if r.ID == a.Schedule.ID {
				out.Applicable = append(out.Applicable, r)
				break
			}
		}
	}
	if resolved.Winner != nil {
		for _, r := range records {
			if r.ID == resolved.Winner.Schedule.ID {
				x := r
				out.WinningSchedule = &x
				out.WinningPlaylistID = &x.PlaylistID
				break
			}
		}
	}
	if len(out.Applicable) > 1 {
		out.Conflicts = append(out.Conflicts, fmt.Sprintf("%d active schedules overlap; precedence selects %s", len(out.Applicable), out.Applicable[0].Name))
	}
	return out, nil
}

type note struct {
	id      uuid.UUID
	version int64
}

func affectedForSchedule(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, id uuid.UUID) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT DISTINCT x.screen_id FROM (SELECT t.screen_id FROM schedule_targets t WHERE t.schedule_id=$1 AND t.screen_id IS NOT NULL UNION SELECT m.screen_id FROM schedule_targets t JOIN screen_group_memberships m ON m.screen_group_id=t.screen_group_id WHERE t.schedule_id=$1)x`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var x uuid.UUID
		if err = rows.Scan(&x); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func bumpGroupScreens(ctx context.Context, tx pgx.Tx, id uuid.UUID, reason string) ([]note, error) {
	rows, err := tx.Query(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason)SELECT screen_id,1,$2 FROM screen_group_memberships WHERE screen_group_id=$1 ON CONFLICT(screen_id)DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason=$2 RETURNING screen_id,manifest_version`, id, reason)
	return scanNotes(rows, err)
}
func bumpScreens(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, reason string) ([]note, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason)SELECT unnest($1::uuid[]),1,$2 ON CONFLICT(screen_id)DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason=$2 RETURNING screen_id,manifest_version`, ids, reason)
	return scanNotes(rows, err)
}
func scanNotes(rows pgx.Rows, err error) ([]note, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []note{}
	for rows.Next() {
		var n note
		if err = rows.Scan(&n.id, &n.version); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
func union(a, b []uuid.UUID) []uuid.UUID {
	m := map[uuid.UUID]bool{}
	for _, x := range append(a, b...) {
		m[x] = true
	}
	out := make([]uuid.UUID, 0, len(m))
	for x := range m {
		out = append(out, x)
	}
	return out
}
func (s *Service) notify(ns []note) {
	if s.notifier != nil {
		for _, n := range ns {
			s.notifier.ManifestChanged(n.id, n.version)
		}
	}
}
func (s *Service) audit(ctx context.Context, user uuid.UUID, action, resource string, id uuid.UUID) error {
	_, err := s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,$4,$5)`, uuid.New(), user, action, resource, id.String())
	return err
}
func (s *Service) Config() (int, int, int) {
	clock := s.limits.ClockSkewWarningSeconds
	if clock <= 0 {
		clock = 300
	}
	return s.limits.PrefetchDays, s.limits.ActivationGraceSeconds, clock
}
