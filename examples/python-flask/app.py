"""
Example: Python Flask backend with AutoBridge
Run: python app.py
"""

from flask import Flask, jsonify
from autobridge import BridgeClient, BridgeConfig, string_field, array_field, object_field, number_field

app = Flask(__name__)

# ─── Configure AutoBridge ───────────────────────────────────────────────────
bridge = BridgeClient(BridgeConfig(
    service_name="user-service",
    base_url="http://localhost:5000",
    stack="python-flask",
    # api_key="sk-ant-..."  # Optional: or set ANTHROPIC_API_KEY env var
))


# ─── Declare Capabilities ───────────────────────────────────────────────────

@bridge.capability(
    "list users",
    output={
        "users": array_field(
            object_field({
                "id": number_field(description="User ID"),
                "name": string_field(description="Full name"),
                "email": string_field(description="Email address"),
                "role": string_field(description="User role"),
            })
        )
    },
    tags=["users", "read", "list"],
    method="GET",
    handler="/api/users",
)
def list_users():
    """Returns all users"""
    # Your real DB logic here
    return jsonify({
        "users": [
            {"id": 1, "name": "Alice Chen", "email": "alice@example.com", "role": "admin"},
            {"id": 2, "name": "Bob Santos", "email": "bob@example.com", "role": "member"},
        ]
    })


@bridge.capability(
    "get user profile",
    output={
        "user": object_field({
            "id": number_field(),
            "name": string_field(),
            "email": string_field(),
            "avatar": string_field(required=False),
            "joinedAt": string_field(),
        })
    },
    input={"id": number_field(description="User ID")},
    tags=["users", "read", "profile"],
    method="GET",
    handler="/api/users/{id}",
)
def get_user(user_id: int):
    return jsonify({
        "user": {"id": user_id, "name": "Alice Chen", "email": "alice@example.com", "joinedAt": "2024-01-01"}
    })


@bridge.capability(
    "create user",
    output={"user": object_field({"id": number_field(), "name": string_field(), "email": string_field()})},
    input={
        "name": string_field(description="Full name"),
        "email": string_field(description="Email address"),
        "role": string_field(required=False),
    },
    tags=["users", "create", "write"],
    method="POST",
    handler="/api/users",
)
def create_user():
    return jsonify({"user": {"id": 3, "name": "New User", "email": "new@example.com"}})


# ─── Flask Routes (the actual endpoints) ────────────────────────────────────

@app.route("/api/users", methods=["GET"])
def _list_users():
    return list_users()

@app.route("/api/users/<int:user_id>", methods=["GET"])
def _get_user(user_id):
    return get_user(user_id)

@app.route("/api/users", methods=["POST"])
def _create_user():
    return create_user()


if __name__ == "__main__":
    # Register with AutoBridge before starting Flask
    bridge.register()
    app.run(port=5000, debug=True)
