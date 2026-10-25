"""Database models for Sentinel."""

import os
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


def _utc_isoformat(dt: datetime) -> str:
    """Serialize a datetime to an ISO 8601 string with an explicit UTC marker.

    SQLite's DATETIME column type stores timestamps as plain text without
    timezone information.  SQLAlchemy reads them back as *naive* ``datetime``
    objects (``tzinfo=None``) even when the value was written via
    ``datetime.now(timezone.utc)``.

    Python’s ``datetime.isoformat()`` on a naive object omits the timezone
    suffix, producing e.g. ``"2026-10-19T09:48:16.063731"``.
    JavaScript’s ``new Date()`` treats such strings as *local* time rather
    than UTC — on IST (UTC+5:30) this shifts the parsed epoch 330 minutes
    into the past, inflating every elapsed-time calculation by exactly that
    amount.

    This helper appends ``"Z"`` when the datetime is naive (all Sentinel
    timestamps are always written as UTC), and delegates to the standard
    ``isoformat()`` when the datetime already carries timezone information
    (e.g. a timezone-aware value read from PostgreSQL or constructed in
    tests), avoiding a double-suffix bug.
    """
    if dt.tzinfo is None:
        # Naive datetime — known to be UTC; append the explicit marker.
        return dt.isoformat() + "Z"
    # Timezone-aware — isoformat() already includes the offset.
    return dt.isoformat()


class User(db.Model):
    """User account model."""
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=True)  # Null for DigiLocker-only users
    full_name = db.Column(db.String(255), nullable=False)
    aadhaar_last4 = db.Column(db.String(4), nullable=True)
    digilocker_id = db.Column(db.String(255), nullable=True, unique=True)
    google_id = db.Column(db.String(255), nullable=True, unique=True)
    is_verified = db.Column(db.Boolean, default=False)
    role = db.Column(db.String(50), default="user")  # user, admin, analyst
    token_version = db.Column(db.Integer, default=0, nullable=False)
    failed_login_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime, nullable=True)
    totp_secret = db.Column(db.String(255), nullable=True)
    max_scans_per_day = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = db.Column(db.DateTime, nullable=True)

    scans = db.relationship("Scan", backref="user", lazy="dynamic")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        if not self.password_hash:
            return False
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "aadhaar_last4": self.aadhaar_last4,
            "is_verified": self.is_verified,
            "role": self.role,
            "capabilities": {
                "manage_catalog": self.role in {"admin", "analyst"},
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Scan(db.Model):
    """OSINT scan record."""
    __tablename__ = "scans"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    target_name = db.Column(db.String(255), nullable=False)
    target_email = db.Column(db.String(255), nullable=True)
    target_username = db.Column(db.String(255), nullable=True)
    target_phone = db.Column(db.String(50), nullable=True)
    mode = db.Column(db.String(20), default="quick")  # quick or full
    status = db.Column(db.String(20), default="pending", index=True)  # pending, running, completed, failed
    progress = db.Column(db.Integer, default=0)  # 0-100
    current_stage = db.Column(db.String(100), default="Initializing")
    risk_score = db.Column(db.Float, nullable=True)  # 0.0 - 10.0
    platforms_found = db.Column(db.Integer, default=0)
    entities_found = db.Column(db.Integer, default=0)
    task_id = db.Column(db.String(255), nullable=True)
    execution_backend = db.Column(db.String(50), nullable=True)
    # Scheduled-scan dispatch recovery.  NULL for manual scans and for all
    # scans created before this feature: recovery ignores those rows.
    # 'pending' = created but publication not confirmed; 'published' = the
    # broker call returned successfully.  dispatch_attempted_at is the lease
    # timestamp (naive UTC) of the most recent publish attempt/claim.
    dispatch_state = db.Column(db.String(20), nullable=True)
    dispatch_attempted_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    completed_at = db.Column(db.DateTime, nullable=True)

    results = db.relationship("ScanResult", backref="scan", lazy="dynamic", cascade="all, delete-orphan")
    nodes = db.relationship("IdentityNode", backref="scan", lazy="dynamic", cascade="all, delete-orphan")
    edges = db.relationship("IdentityEdge", backref="scan", lazy="dynamic", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "target_name": self.target_name,
            "target_email": self.target_email,
            "target_username": self.target_username,
            "target_phone": self.target_phone,
            "mode": self.mode,
            "status": self.status,
            "progress": self.progress,
            "current_stage": self.current_stage,
            "risk_score": self.risk_score,
            "platforms_found": self.platforms_found,
            "entities_found": self.entities_found,
            "task_id": self.task_id,
            "execution_backend": self.execution_backend,
            "created_at": _utc_isoformat(self.created_at) if self.created_at else None,
            "completed_at": _utc_isoformat(self.completed_at) if self.completed_at else None,
        }


class ScanResult(db.Model):
    """Individual result from a scan (a discovered profile/page)."""
    __tablename__ = "scan_results"

    id = db.Column(db.Integer, primary_key=True)
    scan_id = db.Column(db.Integer, db.ForeignKey("scans.id"), nullable=False, index=True)
    platform = db.Column(db.String(100), nullable=False)
    url = db.Column(db.String(1024), nullable=False)
    username = db.Column(db.String(255), nullable=True)
    display_name = db.Column(db.String(255), nullable=True)
    bio = db.Column(db.Text, nullable=True)
    confidence = db.Column(db.Float, default=0.5)  # 0.0 - 1.0
    risk_level = db.Column(db.String(20), default="low")  # critical, high, medium, low
    category = db.Column(db.String(50), default="social")  # social, dev, professional, forum, other
    emails_found = db.Column(db.Text, nullable=True)  # JSON list
    phones_found = db.Column(db.Text, nullable=True)  # JSON list
    raw_text = db.Column(db.Text, nullable=True)
    match_score = db.Column(db.Float, nullable=True)
    match_reasons = db.Column(db.Text, nullable=True)
    metadata_json = db.Column(db.Text, nullable=True)
    evidence_path = db.Column(db.String(1024), nullable=True)
    last_seen_at = db.Column(db.DateTime, nullable=True)
    discovered_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        import json
        evidence_filename = os.path.basename(self.evidence_path) if self.evidence_path else None
        return {
            "id": self.id,
            "platform": self.platform,
            "url": self.url,
            "username": self.username,
            "display_name": self.display_name,
            "bio": self.bio,
            "confidence": self.confidence,
            "risk_level": self.risk_level,
            "category": self.category,
            "match_score": self.match_score,
            "match_reasons": json.loads(self.match_reasons) if self.match_reasons else [],
            "metadata": json.loads(self.metadata_json) if self.metadata_json else {},
            "evidence_available": bool(self.evidence_path),
            "evidence_filename": evidence_filename,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "emails_found": json.loads(self.emails_found) if self.emails_found else [],
            "phones_found": json.loads(self.phones_found) if self.phones_found else [],
            "discovered_at": self.discovered_at.isoformat() if self.discovered_at else None,
        }


class IdentityNode(db.Model):
    """Node in the identity graph."""
    __tablename__ = "identity_nodes"

    id = db.Column(db.Integer, primary_key=True)
    scan_id = db.Column(db.Integer, db.ForeignKey("scans.id"), nullable=False)
    node_id = db.Column(db.String(255), nullable=False)  # Unique within scan
    node_type = db.Column(db.String(50), nullable=False)  # email, username, name, phone, url, platform
    label = db.Column(db.String(255), nullable=False)
    risk_level = db.Column(db.String(20), default="low")
    metadata_json = db.Column(db.Text, nullable=True)

    def to_dict(self):
        import json
        base = {
            "id": self.node_id,
            "type": self.node_type,
            "label": self.label,
            "risk_level": self.risk_level,
        }
        # Flatten metadata into top-level data so Cytoscape.js can access them
        if self.metadata_json:
            try:
                meta = json.loads(self.metadata_json)
                base.update(meta)
            except (json.JSONDecodeError, TypeError):
                pass
        return base


class IdentityEdge(db.Model):
    """Edge in the identity graph."""
    __tablename__ = "identity_edges"

    id = db.Column(db.Integer, primary_key=True)
    scan_id = db.Column(db.Integer, db.ForeignKey("scans.id"), nullable=False)
    source_id = db.Column(db.String(255), nullable=False)
    target_id = db.Column(db.String(255), nullable=False)
    relationship = db.Column(db.String(100), nullable=False)  # found_on, linked_to, associated_with
    confidence = db.Column(db.Float, default=0.5)

    def to_dict(self):
        return {
            "source": self.source_id,
            "target": self.target_id,
            "relationship": self.relationship,
            "confidence": self.confidence,
        }


class Dataset(db.Model):
    """User-uploaded dataset for analytics."""
    __tablename__ = "datasets"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    row_count = db.Column(db.Integer, default=0)
    column_count = db.Column(db.Integer, default=0)
    columns_json = db.Column(db.Text, nullable=True)
    summary_json = db.Column(db.Text, nullable=True)
    data_json = db.Column(db.Text, nullable=True)
    file_size_bytes = db.Column(db.Integer, default=0)
    upload_status = db.Column(db.String(20), default="processing")
    # True only when ALL chunks have been successfully committed for this dataset.
    # Pagination and chat consumers use chunks iff this flag is True, otherwise
    # fall back to data_json for backward compatibility.
    chunks_migrated = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    chunks = db.relationship(
        "DatasetChunk",
        backref="dataset",
        lazy="dynamic",
        cascade="all, delete-orphan",
        order_by="DatasetChunk.chunk_index",
    )
    chat_messages = db.relationship("ChatMessage", backref="dataset", lazy="dynamic",
                                    cascade="all, delete-orphan")

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "name": self.name,
            "original_filename": self.original_filename,
            "description": self.description,
            "row_count": self.row_count,
            "column_count": self.column_count,
            "columns": json.loads(self.columns_json) if self.columns_json else [],
            "summary": json.loads(self.summary_json) if self.summary_json else {},
            "file_size_bytes": self.file_size_bytes,
            "upload_status": self.upload_status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ── Dataset chunk storage (F7-BE-04) ─────────────────────────────────────────

CHUNK_SIZE: int = 500  # Rows per chunk. Max page_size=200 → ≤2 chunk reads per page.


class DatasetChunk(db.Model):
    """Ordered chunk of up to CHUNK_SIZE dataset rows stored as a JSON array.

    Rows are indexed from 0.  chunk_index 0 contains rows 0..(CHUNK_SIZE-1),
    chunk_index 1 contains rows CHUNK_SIZE..(2*CHUNK_SIZE-1), and so on.
    The last chunk may hold fewer than CHUNK_SIZE rows.

    ``Dataset.chunks_migrated`` is set to True only after ALL chunks for a
    dataset have been committed in a single transaction, guaranteeing that
    partial chunk sets are never served to callers.

    The unique constraint on (dataset_id, chunk_index) makes backfill
    idempotent: a repeated INSERT on the same (dataset_id, chunk_index) raises
    an IntegrityError which the backfill script catches and skips.
    """
    __tablename__ = "dataset_chunks"
    __table_args__ = (
        db.UniqueConstraint("dataset_id", "chunk_index", name="uq_dataset_chunk"),
    )

    id = db.Column(db.Integer, primary_key=True)
    dataset_id = db.Column(
        db.Integer,
        db.ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index = db.Column(db.Integer, nullable=False)
    # JSON array of row dicts, length ≤ CHUNK_SIZE.
    rows_json = db.Column(db.Text, nullable=False)


class ChatMessage(db.Model):
    """AI chat conversation message."""
    __tablename__ = "chat_messages"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    dataset_id = db.Column(db.Integer, db.ForeignKey("datasets.id"), nullable=True)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    chart_config_json = db.Column(db.Text, nullable=True)
    query_generated = db.Column(db.Text, nullable=True)
    data_result_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "role": self.role,
            "content": self.content,
            "chart_config": json.loads(self.chart_config_json) if self.chart_config_json else None,
            "query_generated": self.query_generated,
            "data_result": json.loads(self.data_result_json) if self.data_result_json else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# ── Phase 4: New Models ─────────────────────────────────────────────


class ScanRiskHistory(db.Model):
    """Tracks risk scores over time for trend analysis."""
    __tablename__ = "scan_risk_history"

    id = db.Column(db.Integer, primary_key=True)
    scan_id = db.Column(db.Integer, db.ForeignKey("scans.id"), nullable=False)
    target_username = db.Column(db.String(255), nullable=True, index=True)
    risk_score = db.Column(db.Float, nullable=True)
    node_count = db.Column(db.Integer, default=0)
    edge_count = db.Column(db.Integer, default=0)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "scan_id": self.scan_id,
            "target_username": self.target_username,
            "risk_score": self.risk_score,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class ScheduledScan(db.Model):
    """User-defined recurring scan schedules."""
    __tablename__ = "scheduled_scans"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    target_username = db.Column(db.String(255), nullable=False)
    frequency = db.Column(db.String(20), default="weekly")  # daily, weekly, monthly
    last_run = db.Column(db.DateTime, nullable=True)
    next_run = db.Column(db.DateTime, nullable=True)
    notify_on_change = db.Column(db.Boolean, default=True)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "target_username": self.target_username,
            "frequency": self.frequency,
            "last_run": _utc_isoformat(self.last_run) if self.last_run else None,
            "next_run": _utc_isoformat(self.next_run) if self.next_run else None,
            "notify_on_change": self.notify_on_change,
            "active": self.active,
            "created_at": _utc_isoformat(self.created_at) if self.created_at else None,
        }


class Webhook(db.Model):
    """User-configured webhook endpoints for scan events."""
    __tablename__ = "webhooks"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    url = db.Column(db.String(1024), nullable=False)
    secret = db.Column(db.String(255), nullable=True)
    events_json = db.Column(db.Text, nullable=True)  # JSON list of event types
    active = db.Column(db.Boolean, default=True)
    last_triggered = db.Column(db.DateTime, nullable=True)
    last_status_code = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "url": self.url,
            "events": json.loads(self.events_json) if self.events_json else [],
            "active": self.active,
            "last_triggered": self.last_triggered.isoformat() if self.last_triggered else None,
            "last_status_code": self.last_status_code,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class AuditLog(db.Model):
    """System-wide audit trail."""
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    event_type = db.Column(db.String(100), nullable=False, index=True)
    target = db.Column(db.String(255), nullable=True)
    details_json = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    user_agent = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "user_id": self.user_id,
            "event_type": self.event_type,
            "target": self.target,
            "details": json.loads(self.details_json) if self.details_json else None,
            "ip_address": self.ip_address,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def ensure_runtime_migrations():
    """Add newly introduced columns when running against an existing SQLite DB."""
    column_specs = {
        "scans": {
            "task_id": "TEXT",
            "execution_backend": "TEXT",
        },
        "users": {
            "token_version": "INTEGER NOT NULL DEFAULT 0",
            "failed_login_attempts": "INTEGER NOT NULL DEFAULT 0",
            "locked_until": "DATETIME",
            "google_id": "TEXT",
            "totp_secret": "TEXT",
            "max_scans_per_day": "INTEGER",
        },
        "scan_results": {
            "match_score": "FLOAT",
            "match_reasons": "TEXT",
            "metadata_json": "TEXT",
            "evidence_path": "TEXT",
            "last_seen_at": "DATETIME",
        },
    }

    with db.engine.begin() as connection:
        # Detect dialect
        dialect = db.engine.dialect.name

        if dialect == "sqlite":
            for table_name, columns in column_specs.items():
                existing_columns = {
                    row[1]
                    for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
                }

                for column_name, column_type in columns.items():
                    if column_name not in existing_columns:
                        connection.exec_driver_sql(
                            f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
                        )

            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id)"
            )
        else:
            # PostgreSQL — use information_schema
            for table_name, columns in column_specs.items():
                existing = {
                    row[0]
                    for row in connection.exec_driver_sql(
                        "SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name = '{table_name}'"
                    ).fetchall()
                }
                for column_name, column_type in columns.items():
                    if column_name not in existing:
                        pg_type = column_type.replace("TEXT", "VARCHAR")
                        if "NOT NULL" in pg_type and "DEFAULT" not in pg_type:
                            pg_type = pg_type.replace("NOT NULL", "")
                        connection.exec_driver_sql(
                            f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {pg_type}"
                        )
