"""SemIf MLX 的可选 choice 桥接；大候选集保留所有选项并分组评分。"""
import argparse
import hmac
import json
import math
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = "Qwen/Qwen3.5-4B"
REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"


class SlotProjection:
    """只投影评分器实际读取的位置；保留 Qwen 原生词表权重。"""
    def __init__(self, hidden, text_model):
        self.hidden, self.text_model = hidden, text_model
    def __getitem__(self, index):
        row, position, slots = index
        hidden = self.hidden[row, position]
        model = self.text_model
        logits = model.model.embed_tokens.as_linear(hidden) if model.args.tie_word_embeddings else model.lm_head(hidden)
        return logits[slots]


class DecisionModel:
    def __init__(self, model): self.native = model
    def __getattr__(self, name): return getattr(self.native, name)
    def __call__(self, inputs, cache=None):
        text_model = self.native.language_model
        return SlotProjection(text_model.model(inputs, cache=cache), text_model)


def describe(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, allow_nan=False)


def prepare(payload):
    state, questions = payload.get("state"), payload.get("questions")
    if not state or not isinstance(questions, dict) or not 1 <= len(questions) <= 32:
        raise ValueError("需要非空状态与 1–32 个问题")
    rows, plans = [], {}
    def add(instructions, options):
        key = str(len(rows))
        rows.append({"id": key, "state": state, "question": instructions, "options": options})
        return key
    for name, question in questions.items():
        criteria = question.get("criteria")
        if question.get("type") != "choice" or not isinstance(criteria, dict) or not 1 <= len(criteria) <= 256:
            raise ValueError("仅支持 1–256 个已声明候选的 choice")
        options = [{"id": key, "description": describe(value)} for key, value in criteria.items()]
        instruction = describe(question.get("instructions", "Choose the best offered option"))
        if len(options) <= 16:
            plans[name] = {"direct": add(instruction, options) if len(options) > 1 else None, "options": options}
        else:
            buckets = [options[i:i + 16] for i in range(0, len(options), 16)]
            root = add(instruction + " Select the group containing the best matching option.",
                       [{"id": str(i), "description": describe(bucket)} for i, bucket in enumerate(buckets)])
            children = [add(instruction, b) if len(b) > 1 else None for b in buckets]
            plans[name] = {"root": root, "children": children, "buckets": buckets, "options": options}
    return rows, plans


def combine(plans, results):
    distributions = {r["id"]: dict(zip(r["option_ids"], r["probabilities"], strict=True)) for r in results}
    answers = {}
    for name, plan in plans.items():
        if "root" in plan:
            root, probs = distributions[plan["root"]], {}
            for i, (child, bucket) in enumerate(zip(plan["children"], plan["buckets"])):
                conditional = distributions[child] if child else {bucket[0]["id"]: 1.0}
                if set(conditional) != {o["id"] for o in bucket}:
                    raise ValueError("候选覆盖不足")
                probs.update({key: root[str(i)] * p for key, p in conditional.items()})
        else:
            probs = distributions[plan["direct"]] if plan["direct"] else {plan["options"][0]["id"]: 1.0}
        if set(probs) != {o["id"] for o in plan["options"]} or any(not math.isfinite(p) or p < 0 or p > 1 for p in probs.values()) or abs(sum(probs.values()) - 1) > .001:
            raise ValueError("概率或候选覆盖无效")
        choice = max(probs, key=probs.get)
        answers[name] = {"choice": choice, "confidence": probs[choice], "probabilities": probs}
    return answers


def main():
    from semif_phase1.mlx_backend import load_model, score_shared
    parser = argparse.ArgumentParser(description="InspireJev 可选 SemIf MLX 服务")
    parser.add_argument("--port", type=int, default=8772)
    parser.add_argument("--max-tokens", type=int, default=16384)
    args = parser.parse_args()
    started = time.perf_counter()
    model, tokenizer, metadata = load_model(MODEL, REVISION)
    model = DecisionModel(model)
    identity = f"semif/{MODEL}@{REVISION}"
    ready = {"model": identity, "backend": "mlx", "load_seconds": time.perf_counter() - started,
             "max_tokens": args.max_tokens, "max_candidates": 256}
    secret = os.environ.get("LOCAL_JEV_API_KEY", "")
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def reply(self, status, data):
            body = json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass
        def authorized(self):
            return not secret or hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + secret)
        def do_GET(self):
            self.reply(200 if self.authorized() else 401, ready if self.authorized() else {"error": "unauthorized"})
        def do_POST(self):
            if not self.authorized(): return self.reply(401, {"error": "unauthorized"})
            if self.path != "/v1/systemone": return self.reply(404, {"error": "not_found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4 * 1024 * 1024: raise ValueError("请求大小无效")
                payload = json.loads(self.rfile.read(size))
                if payload.get("model") not in ("semif-local", identity): raise ValueError("模型未加载")
                rows, plans = prepare(payload)
                results, timing = score_shared(model, tokenizer, rows, metadata, max_tokens=args.max_tokens) if rows else ([], {})
                self.reply(200, {"model": identity, "answers": combine(plans, results),
                    "usage": {"input_tokens": sum(r["input_tokens"] for r in results), "decision_heads": len(rows)},
                    "readout": "native logits; >16 options: group probability × conditional option probability",
                    "probability_status": "uncalibrated conditional scores", "timing": timing})
            except (ValueError, KeyError, TypeError): self.reply(422, {"error": "invalid_or_unsupported_request"})
            except Exception: self.reply(500, {"error": "inference_failed"})
    print(json.dumps({"event": "ready", **ready}), flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__": main()
