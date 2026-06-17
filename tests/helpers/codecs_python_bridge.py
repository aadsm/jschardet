"""JSON-line codec bridge used by tests/helpers/codecs.ts.

Reads one request per line on stdin, writes one response per line on stdout.

Request:  {"op": "encode"|"decode"|"lookup", "encoding": str, "data": str}
            - "data" is base64 for "encode" output / "decode" input,
              and a UTF-8 string for "encode" input. Unused for "lookup".
Response: {"ok": true, "data": str} on success
            - For "encode": base64 of the resulting bytes.
            - For "decode": the resulting text (passed through JSON, so
              any string).
            - For "lookup": the canonical codec name.
          {"ok": false, "error": "<class>", "message": str} on failure
            - "error" is one of "UnicodeDecodeError", "UnicodeEncodeError",
              "LookupError" (or the actual exception class for unexpected
              errors).
"""

from __future__ import annotations

import base64
import codecs
import json
import sys


def _handle(req: dict) -> dict:
    op = req["op"]
    encoding = req["encoding"]
    try:
        if op == "encode":
            text: str = req["data"]
            out = text.encode(encoding)
            return {"ok": True, "data": base64.b64encode(out).decode("ascii")}
        if op == "decode":
            data = base64.b64decode(req["data"])
            return {"ok": True, "data": data.decode(encoding)}
        if op == "lookup":
            return {"ok": True, "data": codecs.lookup(encoding).name}
        return {"ok": False, "error": "ValueError", "message": f"unknown op: {op!r}"}
    except UnicodeDecodeError as exc:
        return {"ok": False, "error": "UnicodeDecodeError", "message": str(exc)}
    except UnicodeEncodeError as exc:
        return {"ok": False, "error": "UnicodeEncodeError", "message": str(exc)}
    except LookupError as exc:
        return {"ok": False, "error": "LookupError", "message": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": type(exc).__name__, "message": str(exc)}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        resp = _handle(req)
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
