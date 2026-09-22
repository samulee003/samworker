# -*- coding: utf-8 -*-
import json

p = "eval/eval_dataset.json"
d = json.load(open(p, encoding="utf-8"))
d["layers"] = ["smoke", "golden", "security", "edge", "integration", "mouse"]
d["passing_policy"]["mouse"] = "8/8 required"

def write_plan(content):
    return {
        "goal": "g",
        "steps": [
            {
                "id": 1,
                "tool": "fs.writeFile",
                "args": {"path": "REPORT.md", "content": content, "reason": "mvp"},
                "done_when": "w",
            }
        ],
        "definition_of_done": "r",
    }

cases = [
    {
        "id": "mouse-01",
        "name": "POST /task accepts voice goal",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "整理桌面截圖",
        "http_body": {
            "goal": "整理桌面截圖",
            "source": "mouse",
            "voice": {"keyId": 203, "ts": 1, "transcript": "整理桌面截圖"},
            "client": "MouseOptions",
            "idempotencyKey": "m01",
            "plan": write_plan("# ok\n"),
        },
        "expect": {"type": "http_status", "value": "202"},
    },
    {
        "id": "mouse-02",
        "name": "audit has source=mouse",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "讀筆記",
        "http_body": {
            "goal": "讀筆記",
            "source": "mouse",
            "voice": {"keyId": 203, "ts": 1, "transcript": "SECRET_TRANSCRIPT_XYZ"},
            "client": "MouseOptions",
            "idempotencyKey": "m02",
            "plan": write_plan("# b\n"),
        },
        "expect": {"type": "audit_log_has", "value": '"source":"mouse"'},
    },
    {
        "id": "mouse-03",
        "name": "transcript not in audit",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "x",
        "http_body": {
            "goal": "x",
            "source": "mouse",
            "voice": {"keyId": 203, "ts": 1, "transcript": "SECRET_TRANSCRIPT_XYZ"},
            "client": "MouseOptions",
            "idempotencyKey": "m03",
            "plan": write_plan("# c\n"),
        },
        "expect": {"type": "audit_log_missing", "value": "SECRET_TRANSCRIPT_XYZ"},
    },
    {
        "id": "mouse-04",
        "name": "approval approve_once then write",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "寫報告",
        "resolve": {"approval": "1", "answer": "approve_once"},
        "http_body": {
            "goal": "寫報告",
            "source": "mouse",
            "voice": {"keyId": 203, "ts": 1, "transcript": "寫報告"},
            "client": "MouseOptions",
            "idempotencyKey": "m04",
            "plan": write_plan("# approved\n"),
        },
        "expect": {"type": "file_contains", "value": "REPORT.md:# approved"},
    },
    {
        "id": "mouse-05",
        "name": "approval deny no write",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "寫報告2",
        "resolve": {"approval": "1", "answer": "deny"},
        "http_body": {
            "goal": "寫報告2",
            "source": "mouse",
            "voice": {"keyId": 203, "ts": 1, "transcript": "寫報告2"},
            "client": "MouseOptions",
            "idempotencyKey": "m05",
            "plan": write_plan("# no\n"),
        },
        "expect": {"type": "audit_log_has", "value": '"result":"deny"'},
    },
    {
        "id": "mouse-06",
        "name": "invalid body 400",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "bad",
        "http_body": {"source": "mouse", "idempotencyKey": "m06"},
        "expect": {"type": "http_status", "value": "400"},
    },
    {
        "id": "mouse-07",
        "name": "duplicate idempotencyKey 409",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "dup",
        "http_double_post": True,
        "idempotencyKey": "m07-fixed",
        "http_body": {
            "goal": "dup",
            "source": "mouse",
            "client": "MouseOptions",
            "idempotencyKey": "m07-fixed",
            "plan": {"goal": "dup", "steps": [], "definition_of_done": "n"},
        },
        "expect": {"type": "http_status", "value": "409"},
    },
    {
        "id": "mouse-08",
        "name": "startTask cli source default",
        "layer": "mouse",
        "timeout_sec": 30,
        "setup": "mkdir -p work",
        "task": "cli path",
        "plan_inject": write_plan("# cli\n"),
        "expect": {"type": "audit_log_has", "value": '"source":"cli"'},
    },
]

# replace any previous mouse-*
d["cases"] = [c for c in d["cases"] if not str(c.get("id", "")).startswith("mouse-")] + cases
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("cases", len(d["cases"]), "layers", d["layers"])
