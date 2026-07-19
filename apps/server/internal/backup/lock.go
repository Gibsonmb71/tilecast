package backup

// ServerAdvisoryLockID is the PostgreSQL session advisory lock a running
// Tilecast server holds. The CLI checks it before applying a restore so a
// live server is never restored underneath.
const ServerAdvisoryLockID int64 = 74211001
