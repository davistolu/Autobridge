"""
WireBridge Python SDK
Stack-agnostic capability registration for Python backends.
Works with Flask, FastAPI, Django, Bottle, or plain Python.
"""

from __future__ import annotations

import uuid
import threading
import time
import json
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional, TypeVar, overload
from dataclasses import dataclass, field, asdict
from functools import wraps

try:
    import requests
except ImportError:
    requests = None  # type: ignore

logger = logging.getLogger("wirebridge")

F = TypeVar("F", bound=Callable[..., Any])


# ─── SCHEMA HELPERS ───────────────────────────────────────────────────────────

def field_schema(
    type: str,
    required: bool = True,
    description: str = "",
    example: Any = None,
) -> dict:
    s: dict = {"type": type, "required": required}
    if description:
        s["description"] = description
    if example is not None:
        s["example"] = example
    return s


def string_field(**kw) -> dict:
    return field_schema("string", **kw)


def number_field(**kw) -> dict:
    return field_schema("number", **kw)


def bool_field(**kw) -> dict:
    return field_schema("boolean", **kw)


def object_field(properties: dict[str, dict], **kw) -> dict:
    s = field_schema("object", **kw)
    s["properties"] = properties
    return s


def array_field(items: dict, **kw) -> dict:
    s = field_schema("array", **kw)
    s["items"] = items
    return s


# ─── CAPABILITY REGISTRY ──────────────────────────────────────────────────────

@dataclass
class Capability:
    id: str
    name: str
    handler: str
    output: dict[str, dict]
    description: str = ""
    tags: list[str] = field(default_factory=list)
    input: dict[str, dict] = field(default_factory=dict)
    method: str = "GET"
    stack: str = "python"


@dataclass
class BridgeConfig:
    bridge_url: str = "http://localhost:7331"
    service_id: str = field(default_factory=lambda: f"svc-{uuid.uuid4().hex[:8]}")
    service_name: str = "python-service"
    version: str = "1.0.0"
    base_url: str = "http://localhost:8000"
    stack: str = "python"
    api_key: Optional[str] = None
    heartbeat_interval: int = 30  # seconds
    auto_register: bool = True


class BridgeClient:
    """
    The main WireBridge client for Python backends.

    Usage:
        bridge = BridgeClient(BridgeConfig(
            service_name="my-api",
            base_url="http://localhost:5000",
        ))

        @bridge.capability("list users", output={"users": array_field(object_field(...))})
        def get_users():
            return {"users": [...]}
    """

    def __init__(self, config: Optional[BridgeConfig] = None):
        self.config = config or BridgeConfig()
        self._capabilities: list[Capability] = []
        self._registered = False
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._stop_heartbeat = threading.Event()

        if requests is None:
            raise ImportError(
                "WireBridge requires the 'requests' library. "
                "Install it with: pip install requests"
            )

    def capability(
        self,
        name: str,
        *,
        output: dict[str, dict],
        description: str = "",
        tags: Optional[list[str]] = None,
        input: Optional[dict[str, dict]] = None,
        method: str = "GET",
        handler: Optional[str] = None,
        api_key: Optional[str] = None,
    ) -> Callable[[F], F]:
        """
        Decorator that registers a function as a backend capability.

        @bridge.capability(
            "list users",
            output={"users": array_field(object_field({"name": string_field(), "email": string_field()}))},
            tags=["users", "read"],
        )
        def get_users():
            return {"users": db.query_all_users()}
        """
        def decorator(fn: F) -> F:
            cap_id = f"{self.config.service_id}.{fn.__name__}"
            cap_handler = handler or f"/{fn.__name__.replace('_', '-')}"

            cap = Capability(
                id=cap_id,
                name=name,
                handler=cap_handler,
                output=output,
                description=description or (fn.__doc__ or "").strip(),
                tags=tags or [],
                input=input or {},
                method=method.upper(),
                stack=self.config.stack,
            )
            self._capabilities.append(cap)
            logger.debug(f"[WireBridge] Capability registered: {name}")

            @wraps(fn)
            def wrapper(*args, **kwargs):
                return fn(*args, **kwargs)

            # Attach metadata to the function for introspection
            wrapper._wirebridge_capability = cap  # type: ignore
            return wrapper  # type: ignore

        return decorator

    def register(self, api_key: Optional[str] = None) -> bool:
        """Push the manifest to the WireBridge bridge server."""
        key = api_key or self.config.api_key
        manifest = self._build_manifest()

        try:
            resp = requests.post(
                f"{self.config.bridge_url}/registry/backend",
                json={"manifest": manifest, "apiKey": key},
                timeout=10,
            )
            resp.raise_for_status()
            self._registered = True
            logger.info(
                f"[WireBridge] Registered {len(self._capabilities)} capabilities "
                f"for service '{self.config.service_name}'"
            )
            self._start_heartbeat()
            return True
        except Exception as e:
            logger.error(f"[WireBridge] Registration failed: {e}")
            return False

    def _build_manifest(self) -> dict:
        return {
            "serviceId": self.config.service_id,
            "serviceName": self.config.service_name,
            "version": self.config.version,
            "baseUrl": self.config.base_url,
            "stack": self.config.stack,
            "capabilities": [
                {
                    "id": c.id,
                    "name": c.name,
                    "handler": c.handler,
                    "output": c.output,
                    "description": c.description,
                    "tags": c.tags,
                    "input": c.input,
                    "method": c.method,
                    "stack": c.stack,
                }
                for c in self._capabilities
            ],
            "registeredAt": datetime.now(timezone.utc).isoformat(),
        }

    def _start_heartbeat(self):
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return

        def heartbeat_loop():
            while not self._stop_heartbeat.wait(self.config.heartbeat_interval):
                try:
                    requests.post(
                        f"{self.config.bridge_url}/registry/heartbeat",
                        json={"serviceId": self.config.service_id},
                        timeout=5,
                    )
                except Exception:
                    pass  # Heartbeat failures are silent

        self._heartbeat_thread = threading.Thread(
            target=heartbeat_loop, daemon=True, name="wirebridge-heartbeat"
        )
        self._heartbeat_thread.start()

    def stop(self):
        self._stop_heartbeat.set()


# ─── FLASK INTEGRATION ────────────────────────────────────────────────────────

def flask_integration(app, bridge: BridgeClient):
    """
    Auto-register Flask routes as capabilities and
    automatically call bridge.register() on app startup.

    Usage:
        from wirebridge import BridgeClient, flask_integration
        bridge = BridgeClient(...)
        flask_integration(app, bridge)
    """
    try:
        from flask import Flask
    except ImportError:
        raise ImportError("Flask is required for flask_integration")

    @app.before_request
    def _wirebridge_init():
        # Only runs once
        if not bridge._registered:
            bridge.register()

    return bridge


# ─── FASTAPI INTEGRATION ──────────────────────────────────────────────────────

def fastapi_integration(app, bridge: BridgeClient):
    """
    Auto-register with WireBridge on FastAPI startup.

    Usage:
        from wirebridge import BridgeClient, fastapi_integration
        bridge = BridgeClient(...)
        fastapi_integration(app, bridge)
    """
    try:
        from fastapi import FastAPI
    except ImportError:
        raise ImportError("FastAPI is required for fastapi_integration")

    @app.on_event("startup")
    async def _wirebridge_startup():
        bridge.register()

    @app.on_event("shutdown")
    async def _wirebridge_shutdown():
        bridge.stop()

    return bridge
