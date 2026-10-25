"""Bootstrap script — create or promote the initial admin account.

Usage
-----
Option A (recommended for Docker/CI):
    Set ADMIN_INITIAL_PASSWORD in your environment before running:
        ADMIN_EMAIL=admin@example.com ADMIN_INITIAL_PASSWORD=... python create_admin.py

Option B (interactive):
    Run the script without ADMIN_INITIAL_PASSWORD and it will prompt securely
    (the password is never echoed to the terminal via getpass).

Never hardcode or commit a password in this file.
"""

import getpass
import os
import sys

from app import create_app
from database import db, User

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@sentinel.local")
ADMIN_FULL_NAME = os.environ.get("ADMIN_FULL_NAME", "System Admin")


def _get_password() -> str:
    """Return the admin password from env var or interactive prompt.

    The password is NEVER printed or logged.
    """
    password = os.environ.get("ADMIN_INITIAL_PASSWORD", "").strip()
    if password:
        return password

    # Interactive fallback: prompt twice for confirmation.
    while True:
        pw1 = getpass.getpass("Enter admin password (not echoed): ")
        if not pw1:
            print("Password cannot be empty. Please try again.", file=sys.stderr)
            continue
        pw2 = getpass.getpass("Confirm admin password: ")
        if pw1 != pw2:
            print("Passwords do not match. Please try again.", file=sys.stderr)
            continue
        return pw1


app = create_app()
with app.app_context():
    password = _get_password()

    user = User.query.filter_by(email=ADMIN_EMAIL).first()
    if not user:
        user = User(email=ADMIN_EMAIL, full_name=ADMIN_FULL_NAME, role="admin")
        db.session.add(user)
        action = "created"
    else:
        user.role = "admin"
        action = "promoted to admin"

    user.set_password(password)
    db.session.commit()

    # Print confirmation WITHOUT the password.
    print(f"\u2705 Admin account {action}: {ADMIN_EMAIL}")
